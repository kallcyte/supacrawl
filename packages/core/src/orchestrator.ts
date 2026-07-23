import { randomUUID } from "node:crypto"
import { Storage } from "./storage.js"
import { runCrawl } from "./crawler.js"
import { Notifier } from "./notifier/index.js"
import type { CheckResult, Config, CrawlRecord } from "./types.js"

export interface OrchestratorOptions {
  config: Config
  storage: Storage
  notifier: Notifier
  crawlId?: string
  sitemaps?: string[]
  jobId?: string
  onProgress?: (progress: import("./types.js").CrawlProgress) => void
  onResult?: (result: CheckResult) => void
  fetchImpl?: typeof fetch
  abortSignal?: AbortSignal
}

export async function runCrawlWithPersistence(
  opts: OrchestratorOptions
): Promise<{ crawlId: string; record: CrawlRecord }> {
  const crawlId = opts.crawlId ?? randomUUID()
  const startedAt = new Date().toISOString()
  const initialRecord: CrawlRecord = {
    id: crawlId,
    jobId: opts.jobId ?? null,
    startedAt,
    finishedAt: null,
    status: "running",
    urlsTotal: 0,
    urlsChecked: 0,
    urlsChanged: 0,
    urlsBroken: 0,
    urlsSkipped: 0,
    errorMessage: null
  }
  opts.storage.createCrawl(initialRecord, opts.jobId)

  const knownHashes = new Map<string, string>()
  for (const s of opts.storage.getAllUrlStates()) {
    if (s.lastContentHash) knownHashes.set(s.url, s.lastContentHash)
    if (s.lastCheckedAt) knownHashes.set(`${s.url}#checked`, s.lastCheckedAt)
  }

  try {
    const knownHashesByUrl = new Map<string, string>()
    for (const s of opts.storage.getAllUrlStates()) {
      if (s.lastContentHash) knownHashesByUrl.set(s.url, s.lastContentHash)
    }

    const enabledSitemaps = opts.sitemaps ?? opts.config.sitemaps
      .filter((s) => s.enabled)
      .map((s) => s.url)

    let lastmodMap = new Map<string, string | undefined>()
    const sslResults: CheckResult[] = []

    const { errors: crawlErrors } = await runCrawl({
      crawlId,
      config: opts.config.crawl,
      sitemaps: enabledSitemaps,
      knownHashes: knownHashesByUrl,
      onProgress: (p) => {
        opts.storage.updateCrawl(crawlId, {
          urlsTotal: p.total,
          urlsChecked: p.checked,
          urlsChanged: p.changed,
          urlsBroken: p.broken,
          urlsSkipped: p.skipped
        })
        opts.onProgress?.(p)
      },
      onEntries: (entries) => {
        lastmodMap = new Map(entries.map((e) => [e.loc, e.lastmod]))
      },
      onResult: (r) => {
        opts.onResult?.(r)
        sslResults.push(r)
        const id = randomUUID()
        opts.storage.insertResult({
          id,
          crawlId,
          url: r.url,
          statusCode: r.statusCode,
          responseTimeMs: r.responseTimeMs,
          contentHash: r.contentHash,
          contentChanged: r.contentChanged,
          error: r.error,
          redirectChain: r.redirectChain.length ? JSON.stringify(r.redirectChain) : null,
          sslValidUntil: r.sslValidUntil,
          sitemapLastmod: lastmodMap.get(r.url) ?? null,
          checkedAt: new Date().toISOString(),
          checkMethod: r.checkMethod
        })

        const allStates = opts.storage.getAllUrlStates()
        const previous = allStates.find((s) => s.url === r.url)
        const consecutiveFailures =
          r.statusCode !== null && r.statusCode >= 400
            ? (previous?.consecutiveFailures ?? 0) + 1
            : 0

        opts.storage.upsertUrlState({
          url: r.url,
          lastStatusCode: r.statusCode,
          lastContentHash: r.contentHash,
          lastResponseTimeMs: r.responseTimeMs,
          sitemapLastmod: lastmodMap.get(r.url) ?? null,
          lastCheckedAt: new Date().toISOString(),
          consecutiveFailures
        })
      },
      abortSignal: opts.abortSignal,
      fetchImpl: opts.fetchImpl
    })

    const finalState = opts.storage.getCrawl(crawlId)
    if (!finalState) throw new Error("Crawl record vanished")

    opts.storage.updateCrawl(crawlId, {
      status: "completed",
      finishedAt: new Date().toISOString(),
      errorMessage: crawlErrors.length > 0 ? crawlErrors.join("; ") : null
    })

    if (finalState.urlsBroken > 0 && opts.notifier.isEventEnabled("onCrawlFailure")) {
      await opts.notifier.notify("onCrawlFailure", {
        event: "onCrawlFailure",
        title: `Crawl found ${finalState.urlsBroken} broken URL(s)`,
        message: `Crawl ${crawlId} completed with ${finalState.urlsBroken} broken links out of ${finalState.urlsChecked} checked.`,
        crawlId,
        meta: { broken: finalState.urlsBroken, checked: finalState.urlsChecked }
      })
    }

    if (finalState.urlsChanged > 0 && opts.notifier.isEventEnabled("onContentChange")) {
      await opts.notifier.notify("onContentChange", {
        event: "onContentChange",
        title: `Crawl detected ${finalState.urlsChanged} content change(s)`,
        message: `Crawl ${crawlId} detected ${finalState.urlsChanged} URLs with content changes.`,
        crawlId,
        meta: { changed: finalState.urlsChanged }
      })
    }

    const expiringSoon = sslResults
      .filter((r) => {
        if (!r.sslValidUntil) return false
        const days = Math.floor(
          (Date.parse(r.sslValidUntil) - Date.now()) / 86400000
        )
        return days >= 0 && days < opts.config.checks.ssl.warnDays
      })
      .map((r) => r.url)

    if (
      expiringSoon.length > 0 &&
      opts.notifier.isEventEnabled("onSslExpiring")
    ) {
      await opts.notifier.notify("onSslExpiring", {
        event: "onSslExpiring",
        title: `${expiringSoon.length} SSL cert(s) expiring soon`,
        message: `URLs with expiring certificates: ${expiringSoon.slice(0, 5).join(", ")}${expiringSoon.length > 5 ? "..." : ""}`,
        crawlId,
        meta: { count: expiringSoon.length }
      })
    }

    if (opts.notifier.isEventEnabled("onCrawlComplete")) {
      await opts.notifier.notify("onCrawlComplete", {
        event: "onCrawlComplete",
        title: "Crawl complete",
        message: `Checked ${finalState.urlsChecked} of ${finalState.urlsTotal} URLs in ${formatDuration(Date.now() - Date.parse(startedAt))}.`,
        crawlId
      })
    }

    return {
      crawlId,
      record: { ...finalState, status: "completed", finishedAt: new Date().toISOString() }
    }
  } catch (err) {
    opts.storage.updateCrawl(crawlId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      errorMessage: (err as Error).message
    })
    throw err
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  return `${m}m${rs}s`
}
