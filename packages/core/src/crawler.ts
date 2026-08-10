import pLimit from "p-limit"
import { URL } from "node:url"
import { fetchAndParseSitemap } from "./sitemap.js"
import { fetchAndParseRobots, type RobotsResult } from "./robots.js"
import { checkUrl, buildLastmodMap } from "./checker.js"
import type {
  CheckResult,
  CrawlConfig,
  CrawlProgress,
  SitemapEntry
} from "./types.js"

export interface CrawlRunOptions {
  config: CrawlConfig
  sitemaps: string[]
  onProgress?: (progress: CrawlProgress) => void
  onResult?: (result: CheckResult) => void
  onEntries?: (entries: SitemapEntry[]) => void
  knownHashes?: Map<string, string>
  checkSsl?: boolean
  abortSignal?: AbortSignal
  fetchImpl?: typeof fetch
  startedAt?: string
  crawlId: string
}

interface HostLimiter {
  limit: ReturnType<typeof pLimit>
  lastRequest: number
  delayMs: number
}

export async function runCrawl(opts: CrawlRunOptions): Promise<{
  entries: SitemapEntry[]
  errors: string[]
}> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const startedAt = opts.startedAt ?? new Date().toISOString()
  const errors: string[] = []
  const entries: SitemapEntry[] = []
  const seen = new Set<string>()
  const limiters = new Map<string, HostLimiter>()

  const origins = new Set<string>()
  for (const s of opts.sitemaps) {
    try {
      origins.add(new URL(s).origin)
    } catch {
      errors.push(`Invalid sitemap URL: ${s}`)
    }
  }

  let robotsByOrigin = new Map<string, RobotsResult>()
  if (opts.config.respectRobotsTxt) {
    for (const origin of origins) {
      const r = await fetchAndParseRobots(origin, fetchImpl)
      robotsByOrigin.set(origin, r)
    }
  }

  for (const sitemapUrl of opts.sitemaps) {
    try {
      const { urls, errors: sitemapErrors } = await fetchAndParseSitemap(sitemapUrl, {
        fetchImpl,
        signal: opts.abortSignal
      })
      for (const u of urls) {
        if (seen.has(u.loc)) continue
        seen.add(u.loc)
        if (entries.length < opts.config.maxUrls) entries.push(u)
      }
      errors.push(...sitemapErrors)
    } catch (err) {
      errors.push(`Sitemap ${sitemapUrl} failed: ${(err as Error).message}`)
    }
  }

  const total = entries.length
  opts.onEntries?.(entries)
  const lastmodMap = buildLastmodMap(entries)
  const knownHashes = opts.knownHashes ?? new Map<string, string>()
  const ctx = { config: opts.config, knownHashes, lastmodByUrl: lastmodMap }

  let checked = 0
  let changed = 0
  let broken = 0
  let skipped = 0

  const globalLimiter = pLimit(opts.config.maxGlobalConcurrency)

  function getLimiter(host: string): HostLimiter {
    let l = limiters.get(host)
    if (l) return l
    const baseDelay = opts.config.delayMs
    const origin = new URL(`https://${host}`).origin
    const robots = robotsByOrigin.get(origin)
    const robotsDelay = robots?.crawlDelay ? robots.crawlDelay * 1000 : 0
    const delayMs = Math.max(baseDelay, robotsDelay)
    l = {
      limit: pLimit(opts.config.maxConcurrency),
      lastRequest: 0,
      delayMs
    }
    limiters.set(host, l)
    return l
  }

  function reportProgress(currentUrl?: string): void {
    if (!opts.onProgress) return
    opts.onProgress({
      crawlId: opts.crawlId,
      total,
      checked,
      changed,
      broken,
      skipped,
      currentUrl,
      status: "running",
      startedAt
    })
  }

  reportProgress()

  // Feed entries to the limiter queue in a bounded sliding window so we never
  // hold the whole crawl (15000+ closures + promises) in memory at once.
  // Host limiters persist across the whole crawl, so per-host throttling
  // still applies. Awaiting the oldest task slides the window forward without
  // stalling the pipeline (other in-flight tasks keep running meanwhile).
  const maxQueued = Math.max(1, opts.config.maxGlobalConcurrency * 2)
  const pending: Promise<void>[] = []
  for (const entry of entries) {
    if (opts.abortSignal?.aborted) break
    let host: string
    try {
      host = new URL(entry.loc).host
    } catch {
      continue
    }

    const origin = new URL(entry.loc).origin
    const robots = opts.config.respectRobotsTxt ? robotsByOrigin.get(origin) : undefined
    if (robots && !robots.allowed(entry.loc)) {
      skipped++
      checked++
      reportProgress(entry.loc)
      continue
    }

    const limiter = getLimiter(host)
    const task = globalLimiter(() =>
      limiter.limit(async () => {
        if (opts.abortSignal?.aborted) return
        const now = Date.now()
        const wait = limiter.lastRequest + limiter.delayMs - now
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
        limiter.lastRequest = Date.now()
        if (opts.abortSignal?.aborted) return
        const res = await checkUrl(entry.loc, ctx, fetchImpl)
        if (res.statusCode !== null && res.statusCode >= 400) broken++
        if (res.contentChanged) changed++
        checked++
        opts.onResult?.(res)
        reportProgress(entry.loc)
      })
    )
    pending.push(task)
    if (pending.length >= maxQueued) {
      // Wait for the oldest task so the window slides forward.
      await pending.shift()
    }
  }
  await Promise.all(pending)

  if (opts.onProgress) {
    opts.onProgress({
      crawlId: opts.crawlId,
      total,
      checked,
      changed,
      broken,
      skipped,
      status: "completed",
      startedAt,
      finishedAt: new Date().toISOString()
    })
  }

  return { entries, errors }
}
