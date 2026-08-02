import { URL } from "node:url"
import { sha256 } from "./diff.js"
import { checkSsl } from "./ssl.js"
import { detectMojibake } from "./mojibake.js"
import { extractSeoInfo } from "./seo.js"
import type { CheckMethod, CheckResult, CrawlConfig, SitemapEntry } from "./types.js"

export interface CheckerContext {
  config: CrawlConfig
  knownHashes: Map<string, string>
  lastmodByUrl: Map<string, string | undefined>
}

const MAX_REDIRECTS = 5

function effectiveMethod(
  url: string,
  ctx: CheckerContext
): { method: CheckMethod; reason: string } {
  if (!ctx.config) return { method: "GET", reason: "no config" }
  const lastmod = ctx.lastmodByUrl.get(url)
  const known = ctx.knownHashes.get(url)
  if (!known) return { method: "GET", reason: "no prior data" }
  if (!lastmod) return { method: "GET", reason: "no lastmod" }
  if (!ctx.knownHashes.get(`${url}#seo`)) return { method: "GET", reason: "seo data missing" }
  const ts = Date.parse(lastmod)
  if (!Number.isFinite(ts)) return { method: "GET", reason: "invalid lastmod" }
  const lastChecked = ctx.knownHashes.get(`${url}#checked`)
  if (lastChecked && ts <= Date.parse(lastChecked)) {
    return { method: "HEAD", reason: "lastmod unchanged" }
  }
  return { method: "GET", reason: "lastmod newer" }
}

export async function checkUrl(
  url: string,
  ctx: CheckerContext,
  fetchImpl: typeof fetch = fetch
): Promise<CheckResult> {
  const { method } = effectiveMethod(url, ctx)
  const result: CheckResult = {
    url,
    statusCode: null,
    responseTimeMs: null,
    contentHash: null,
    contentChanged: false,
    error: null,
    redirectChain: [],
    sslValidUntil: null,
    checkMethod: method,
    mojibakeScore: null,
    mojibakeFlagged: false,
    seo: null
  }
  let attempt = 0
  const maxAttempts = ctx.config.retryOnTransientError ? ctx.config.maxRetries + 1 : 1
  let lastError: Error | null = null
  while (attempt < maxAttempts) {
    attempt++
    const start = performance.now()
    try {
      let currentUrl = url
      const chain: string[] = []
      let res: Response
      for (let i = 0; i < MAX_REDIRECTS; i++) {
        res = await fetchImpl(currentUrl, {
          method,
          redirect: "manual",
          headers: { "User-Agent": ctx.config.userAgent },
          signal: AbortSignal.timeout(ctx.config.timeoutMs)
        })
        if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
          const next = new URL(res.headers.get("location")!, currentUrl).toString()
          if (chain.includes(next)) {
            result.error = "Redirect loop"
            result.statusCode = res.status
            result.responseTimeMs = Math.round(performance.now() - start)
            return result
          }
          chain.push(currentUrl)
          currentUrl = next
          continue
        }
        break
      }
      const finalRes = res!
      result.statusCode = finalRes.status
      result.responseTimeMs = Math.round(performance.now() - start)
      result.redirectChain = chain
      if (finalRes.status >= 200 && finalRes.status < 300 && method === "GET") {
        const buf = new Uint8Array(await finalRes.arrayBuffer())
        const hash = sha256(buf)
        const previous = ctx.knownHashes.get(url)
        result.contentHash = hash
        result.contentChanged = previous !== undefined && previous !== hash
        result.seo = extractSeoInfo(buf, currentUrl)
        if (ctx.config.detectMojibake !== false) {
          const mojibake = detectMojibake(buf)
          result.mojibakeScore = mojibake.score
          result.mojibakeFlagged = mojibake.flagged
        }
      }
      try {
        const u = new URL(url)
        if (u.protocol === "https:") {
          const ssl = await checkSsl(u.hostname, Math.min(5000, ctx.config.timeoutMs))
          if (ssl) result.sslValidUntil = ssl.validUntil
        }
      } catch {
        /* ignore */
      }
      return result
    } catch (err) {
      lastError = err as Error
      if (!ctx.config.retryOnTransientError) break
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 500 * attempt))
      }
    }
  }
  result.error = lastError?.message ?? "Unknown error"
  result.responseTimeMs = null
  return result
}

export function buildLastmodMap(entries: SitemapEntry[]): Map<string, string | undefined> {
  const m = new Map<string, string | undefined>()
  for (const e of entries) m.set(e.loc, e.lastmod)
  return m
}
