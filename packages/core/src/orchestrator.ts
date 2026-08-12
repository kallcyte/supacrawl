import { randomUUID } from "node:crypto"
import { Storage } from "./storage.js"
import { runCrawl } from "./crawler.js"
import { Notifier } from "./notifier/index.js"
import { buildCrawlReportHtml, buildCrawlSummaryText } from "./report.js"
import type { CheckResult, Config, CrawlRecord } from "./types.js"

export interface OrchestratorOptions {
  config: Config
  storage: Storage
  notifier: Notifier
  crawlId?: string
  sitemaps?: string[]
  jobId?: string
  jobName?: string
  onProgress?: (progress: import("./types.js").CrawlProgress) => void
  onResult?: (result: CheckResult) => void
  fetchImpl?: typeof fetch
  abortSignal?: AbortSignal
  /** Public base URL of the app (e.g. BETTER_AUTH_URL). Used to build crawl detail links in notifications. */
  baseUrl?: string
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

  const knownHashesByUrl = new Map<string, string>()
  for (const s of opts.storage.getAllUrlStates()) {
    if (s.lastContentHash) knownHashesByUrl.set(s.url, s.lastContentHash)
    if (s.hasSeo) knownHashesByUrl.set(`${s.url}#seo`, "1")
    if (s.lastCheckedAt) knownHashesByUrl.set(`${s.url}#checked`, s.lastCheckedAt)
  }

  try {
    const crawlUrl = opts.baseUrl
      ? `${opts.baseUrl.replace(/\/$/, "")}/crawls/${crawlId}`
      : undefined
    const enabledSitemaps = opts.sitemaps ?? opts.config.sitemaps
      .filter((s) => s.enabled)
      .map((s) => s.url)

    let lastmodMap = new Map<string, string | undefined>()
    // Keep only what the completion report needs (bounded), instead of retaining
    // every result in memory for the whole crawl.
    const BROKEN_CAP = 30
    const CHANGED_CAP = 30
    const SSL_CAP = 30
    const brokenResults: CheckResult[] = []
    const changedResults: CheckResult[] = []
    // Sample lists capped at SSL_CAP; counts kept separately so memory stays
    // bounded regardless of how many URLs are flagged.
    const expiringSslUrls: string[] = []
    const mojibakeFlaggedUrls: string[] = []
    const llmGarbageFlaggedUrls: string[] = []
    let expiringSslCount = 0
    let mojibakeCount = 0
    let llmGarbageCount = 0

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
        if (r.statusCode !== null && r.statusCode >= 400) {
          if (brokenResults.length < BROKEN_CAP) brokenResults.push(r)
        }
        if (r.contentChanged && changedResults.length < CHANGED_CAP) {
          changedResults.push(r)
        }
        if (r.sslValidUntil) {
          const days = Math.floor(
            (Date.parse(r.sslValidUntil) - Date.now()) / 86400000
          )
          if (days >= 0 && days < opts.config.checks.ssl.warnDays) {
            expiringSslCount++
            if (expiringSslUrls.length < SSL_CAP) expiringSslUrls.push(r.url)
          }
        }
        if (r.mojibakeFlagged) {
          mojibakeCount++
          if (mojibakeFlaggedUrls.length < SSL_CAP) mojibakeFlaggedUrls.push(r.url)
        }
        if (r.llmGarbageFlagged) {
          llmGarbageCount++
          if (llmGarbageFlaggedUrls.length < SSL_CAP) llmGarbageFlaggedUrls.push(r.url)
        }
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
          finalUrl: r.finalUrl,
          sslValidUntil: r.sslValidUntil,
          sitemapLastmod: lastmodMap.get(r.url) ?? null,
          checkedAt: new Date().toISOString(),
          checkMethod: r.checkMethod,
          mojibakeScore: r.mojibakeScore,
          mojibakeFlagged: r.mojibakeFlagged,
          llmGarbageScore: r.llmGarbageScore,
          llmGarbageFlagged: r.llmGarbageFlagged,
          seo: r.seo
        })

        const previous = opts.storage.getUrlState(r.url)
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
          consecutiveFailures,
          hasSeo: r.seo !== null
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
        crawlName: opts.jobName,
        crawlUrl,
        meta: { broken: finalState.urlsBroken, checked: finalState.urlsChecked }
      })
    }

    if (finalState.urlsChanged > 0 && opts.notifier.isEventEnabled("onContentChange")) {
      await opts.notifier.notify("onContentChange", {
        event: "onContentChange",
        title: `Crawl detected ${finalState.urlsChanged} content change(s)`,
        message: `Crawl ${crawlId} detected ${finalState.urlsChanged} URLs with content changes.`,
        crawlId,
        crawlName: opts.jobName,
        crawlUrl,
        meta: { changed: finalState.urlsChanged }
      })
    }

    const expiringSoon = expiringSslUrls
    const mojibakeFlagged = mojibakeFlaggedUrls
    const llmGarbageFlagged = llmGarbageFlaggedUrls

    if (
      expiringSslCount > 0 &&
      opts.notifier.isEventEnabled("onSslExpiring")
    ) {
      await opts.notifier.notify("onSslExpiring", {
        event: "onSslExpiring",
        title: `${expiringSslCount} SSL cert(s) expiring soon`,
        message: `URLs with expiring certificates: ${expiringSoon.slice(0, 5).join(", ")}${expiringSslCount > 5 ? "..." : ""}`,
        crawlId,
        crawlName: opts.jobName,
        crawlUrl,
        meta: { count: expiringSslCount }
      })
    }

    if (opts.notifier.isEventEnabled("onCrawlComplete")) {
      const healthScore =
        finalState.urlsChecked > 0
          ? Math.round(((finalState.urlsChecked - finalState.urlsBroken) / finalState.urlsChecked) * 100)
          : 100
      const brokenUrls = brokenResults
      const changedUrls = changedResults
      await opts.notifier.notify("onCrawlComplete", {
        event: "onCrawlComplete",
        title: `Crawl complete — ${healthScore}% health score`,
        message: buildCrawlSummaryText({
          totalChecked: finalState.urlsChecked,
          totalFound: finalState.urlsTotal,
          broken: finalState.urlsBroken,
          changed: finalState.urlsChanged,
          skipped: finalState.urlsSkipped,
          healthScore,
          durationMs: Date.now() - Date.parse(startedAt)
        }),
        htmlBody: buildCrawlReportHtml({
          crawlId,
          healthScore,
          totalChecked: finalState.urlsChecked,
          totalFound: finalState.urlsTotal,
          brokenCount: finalState.urlsBroken,
          changedCount: finalState.urlsChanged,
          sslCount: expiringSslCount,
          mojibakeCount,
          llmGarbageCount,
          brokenUrls: brokenUrls.map((r) => ({ url: r.url, detail: r.error ?? `HTTP ${r.statusCode}` })),
          changedUrls: changedUrls.map((r) => ({ url: r.url })),
          sslUrls: expiringSoon.slice(0, 30)
        }),
        crawlId,
        crawlName: opts.jobName,
        crawlUrl,
        meta: { healthScore, broken: finalState.urlsBroken, changed: finalState.urlsChanged, skipped: finalState.urlsSkipped }
      })
    }

    if (opts.config.crawl.detectMojibake !== false) {
      if (
        mojibakeCount > 0 &&
        opts.notifier.isEventEnabled("onMojibakeDetected")
      ) {
        await opts.notifier.notify("onMojibakeDetected", {
          event: "onMojibakeDetected",
          title: `${mojibakeCount} URL(s) with mojibake detected`,
          message: `Crawl ${crawlId} found ${mojibakeCount} URLs with garbled text: ${mojibakeFlagged.slice(0, 5).join(", ")}${mojibakeCount > 5 ? "..." : ""}`,
          crawlId,
          crawlName: opts.jobName,
          crawlUrl,
          meta: { mojibakeCount }
        })
      }
    }

    if (opts.config.crawl.detectLlmGarbage !== false) {
      if (
        llmGarbageCount > 0 &&
        opts.notifier.isEventEnabled("onLlmGarbageDetected")
      ) {
        await opts.notifier.notify("onLlmGarbageDetected", {
          event: "onLlmGarbageDetected",
          title: `${llmGarbageCount} URL(s) with LLM garbage detected`,
          message: `Crawl ${crawlId} found ${llmGarbageCount} URLs with AI-generated artifacts: ${llmGarbageFlagged.slice(0, 5).join(", ")}${llmGarbageCount > 5 ? "..." : ""}`,
          crawlId,
          crawlName: opts.jobName,
          crawlUrl,
          meta: { llmGarbageCount }
        })
      }
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
