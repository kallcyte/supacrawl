import { URL } from "node:url"
import { createHash } from "node:crypto"
import { checkSsl } from "./ssl.js"
import { detectMojibake } from "./mojibake.js"
import { detectLlmGarbage } from "./llm-garbage.js"
import { extractSeoInfo } from "./seo.js"
import type { CheckMethod, CheckResult, CrawlConfig, SitemapEntry } from "./types.js"

export interface CheckerContext {
  config: CrawlConfig
  knownHashes: Map<string, string>
  lastmodByUrl: Map<string, string | undefined>
}

const MAX_REDIRECTS = 5

interface BodyRead {
  body: Uint8Array
  hash: string
  truncated: boolean
}

async function readBodyCapped(
  res: Response,
  maxBytes: number
): Promise<BodyRead> {
  const hash = createHash("sha256")
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false

  const pushChunk = (value: Uint8Array): void => {
    hash.update(value)
    const remaining = maxBytes - total
    if (remaining <= 0) {
      truncated = true
      return
    }
    if (value.length <= remaining) {
      chunks.push(value)
      total += value.length
    } else {
      chunks.push(value.subarray(0, remaining))
      total += remaining
      truncated = true
    }
  }

  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer())
    pushChunk(buf)
  } else {
    const reader = res.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        pushChunk(value)
        if (truncated) {
          await reader.cancel()
          break
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return { body: out, hash: hash.digest("hex"), truncated }
}

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
    llmGarbageScore: null,
    llmGarbageFlagged: false,
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
          res.body?.cancel().catch(() => {})
          continue
        }
        break
      }
      const finalRes = res!
      result.statusCode = finalRes.status
      result.responseTimeMs = Math.round(performance.now() - start)
      result.redirectChain = chain
      if (finalRes.status >= 200 && finalRes.status < 300 && method === "GET") {
        const { body, hash, truncated } = await readBodyCapped(
          finalRes,
          ctx.config.maxBodyBytes
        )
        const previous = ctx.knownHashes.get(url)
        result.contentHash = hash
        result.contentChanged = previous !== undefined && previous !== hash
        result.seo = extractSeoInfo(
          body,
          currentUrl,
          truncated ? ctx.config.maxBodyBytes : body.length
        )
        if (ctx.config.detectMojibake !== false || ctx.config.detectLlmGarbage !== false) {
          // Decode the body once and share it with both detectors instead of
          // each detector decoding a separate ~maxBodyBytes string per request.
          const html = new TextDecoder("utf-8", { fatal: false }).decode(body)
          if (ctx.config.detectMojibake !== false) {
            const mojibake = detectMojibake(body, html)
            result.mojibakeScore = mojibake.score
            result.mojibakeFlagged = mojibake.flagged
          }
          if (ctx.config.detectLlmGarbage !== false) {
            const llmGarbage = detectLlmGarbage(html)
            result.llmGarbageScore = llmGarbage.score
            result.llmGarbageFlagged = llmGarbage.flagged
          }
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
