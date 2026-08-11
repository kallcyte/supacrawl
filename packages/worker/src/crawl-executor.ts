import { runCrawl } from "@supacrawl/core"
import type { Storage } from "./storage-d1.js"
import type { Notifier, CrawlConfig, CrawlRecord, CheckResult } from "@supacrawl/core"

export interface CrawlExecutorOptions {
  crawlId: string
  storage: Storage
  notifier: Notifier
  config: CrawlConfig
  sitemaps: string[]
  jobId?: string
  fetchImpl?: typeof fetch
  abortSignal?: AbortSignal
}

/**
 * Worker-native async crawl executor.
 * Mirrors `runCrawlWithPersistence` from core but uses async D1 Storage.
 */
export async function runCrawlExecutor(opts: CrawlExecutorOptions): Promise<CrawlRecord> {
  const { crawlId, storage, notifier, config, sitemaps, jobId } = opts
  const startedAt = new Date().toISOString()

  // Init crawl record
  const initialRecord: CrawlRecord = {
    id: crawlId,
    jobId: jobId ?? null,
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
  await storage.createCrawl(initialRecord, jobId)

  // Load known hashes
  const knownHashesByUrl = new Map<string, string>()
  const states = await storage.getAllUrlStates()
  for (const s of states) {
    if (s.lastContentHash) knownHashesByUrl.set(s.url, s.lastContentHash)
    if (s.hasSeo) knownHashesByUrl.set(`${s.url}#seo`, "1")
    if (s.lastCheckedAt) knownHashesByUrl.set(`${s.url}#checked`, s.lastCheckedAt)
  }

  try {
    const BROKEN_CAP = 30
    const CHANGED_CAP = 30
    const SSL_CAP = 30
    let expiringSslCount = 0
    let mojibakeCount = 0
    let llmGarbageCount = 0

    let lastmodMap = new Map<string, string | undefined>()

    const { errors: crawlErrors } = await runCrawl({
      crawlId,
      config,
      sitemaps,
      knownHashes: knownHashesByUrl,
      onProgress: async (p) => {
        await storage.updateCrawl(crawlId, {
          urlsTotal: p.total,
          urlsChecked: p.checked,
          urlsChanged: p.changed,
          urlsBroken: p.broken,
          urlsSkipped: p.skipped
        })
      },
      onEntries: (entries) => {
        lastmodMap = new Map(entries.map(e => [e.loc, e.lastmod]))
      },
      onResult: async (r) => {
        const id = crypto.randomUUID()
        await storage.insertResult({
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
          checkMethod: r.checkMethod,
          mojibakeScore: r.mojibakeScore,
          mojibakeFlagged: r.mojibakeFlagged,
          llmGarbageScore: r.llmGarbageScore,
          llmGarbageFlagged: r.llmGarbageFlagged,
          seo: r.seo
        })

        const previous = await storage.getUrlState(r.url)
        const consecutiveFailures =
          r.statusCode !== null && r.statusCode >= 400
            ? (previous?.consecutiveFailures ?? 0) + 1
            : 0

        await storage.upsertUrlState({
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

    const finalState = await storage.getCrawl(crawlId)
    if (!finalState) throw new Error("Crawl record vanished")

    await storage.updateCrawl(crawlId, {
      status: "completed",
      finishedAt: new Date().toISOString(),
      errorMessage: crawlErrors.length > 0 ? crawlErrors.join("; ") : null
    })

    // Notifications
    if (finalState.urlsBroken > 0 && notifier.isEventEnabled("onCrawlFailure")) {
      await notifier.notify("onCrawlFailure", {
        event: "onCrawlFailure",
        title: `Crawl found ${finalState.urlsBroken} broken URL(s)`,
        message: `Crawl ${crawlId} completed with ${finalState.urlsBroken} broken links out of ${finalState.urlsChecked} checked.`,
        crawlId,
        meta: { broken: finalState.urlsBroken, checked: finalState.urlsChecked }
      })
    }

    if (finalState.urlsChanged > 0 && notifier.isEventEnabled("onContentChange")) {
      await notifier.notify("onContentChange", {
        event: "onContentChange",
        title: `Crawl detected ${finalState.urlsChanged} content change(s)`,
        message: `Crawl ${crawlId} detected ${finalState.urlsChanged} URLs with content changes.`,
        crawlId,
        meta: { changed: finalState.urlsChanged }
      })
    }

    if (notifier.isEventEnabled("onCrawlComplete")) {
      const healthScore = finalState.urlsChecked > 0
        ? Math.round(((finalState.urlsChecked - finalState.urlsBroken) / finalState.urlsChecked) * 100)
        : 100
      await notifier.notify("onCrawlComplete", {
        event: "onCrawlComplete",
        title: `Crawl complete — ${healthScore}% health score`,
        message: `Checked ${finalState.urlsChecked} of ${finalState.urlsTotal} URLs. ${finalState.urlsBroken} broken, ${finalState.urlsChanged} changed.`,
        crawlId,
        meta: { healthScore, broken: finalState.urlsBroken, changed: finalState.urlsChanged, skipped: finalState.urlsSkipped }
      })
    }

    return { ...finalState, status: "completed", finishedAt: new Date().toISOString() }
  } catch (err) {
    await storage.updateCrawl(crawlId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      errorMessage: err instanceof Error ? err.message : String(err)
    })

    throw err
  }
}
