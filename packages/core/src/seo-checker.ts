import { gzipSync } from "node:zlib"
import { checkSsl } from "./ssl.js"
import { extractSeoInfo, getTagAttrs } from "./seo.js"
import type { SeoInfo } from "./types.js"

export interface SeoContentStats {
  wordCount: number
  imageCount: number
  imagesMissingAlt: number
  linkCount: number
  internalLinkCount: number
  h2Count: number
}

export interface SeoCheckResult {
  url: string
  finalUrl: string | null
  statusCode: number | null
  error: string | null
  responseTimeMs: number | null
  redirectChain: string[]
  sslValidUntil: string | null
  pageWeightBytes: number
  gzippedBytes: number
  seo: SeoInfo | null
  content: SeoContentStats | null
}

export interface SeoCheckOptions {
  userAgent?: string
  timeoutMs?: number
  maxBytes?: number
}

const DEFAULT_USER_AGENT = "supacrawl-seo/0.1"
const MAX_REDIRECTS = 5
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024

async function readBodyCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (!res.body) {
    return new Uint8Array(await res.arrayBuffer())
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      const remaining = maxBytes - total
      if (remaining <= 0) {
        await reader.cancel()
        break
      }
      if (value.length <= remaining) {
        chunks.push(value)
        total += value.length
      } else {
        chunks.push(value.subarray(0, remaining))
        total += remaining
        await reader.cancel()
        break
      }
    }
  } finally {
    reader.releaseLock()
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

export function analyzeContent(body: Uint8Array, baseUrl: string): SeoContentStats {
  const html = new TextDecoder("utf-8", { fatal: false }).decode(body)
  const noScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
  const text = noScripts.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ")
  const wordCount = text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0

  let imageCount = 0
  let imagesMissingAlt = 0
  const imgRe = /<img[^>]*>/gi
  let img: RegExpExecArray | null
  while ((img = imgRe.exec(html)) !== null) {
    imageCount++
    const alt = getTagAttrs(img[0]).get("alt")
    if (alt === undefined || alt.trim() === "") imagesMissingAlt++
  }

  let linkCount = 0
  let internalLinkCount = 0
  let base: URL | null = null
  try {
    base = new URL(baseUrl)
  } catch {
    base = null
  }
  const aRe = /<a\b[^>]*>/gi
  let aTag: RegExpExecArray | null
  while ((aTag = aRe.exec(html)) !== null) {
    const href = getTagAttrs(aTag[0]).get("href")
    if (href === undefined) continue
    linkCount++
    if (!base) continue
    try {
      const target = new URL(href, base)
      if (target.hostname === base.hostname) internalLinkCount++
    } catch {
      /* ignore malformed hrefs */
    }
  }

  const h2Count = (html.match(/<h2[^>]*>/gi) ?? []).length

  return { wordCount, imageCount, imagesMissingAlt, linkCount, internalLinkCount, h2Count }
}

export async function checkSeo(
  url: string,
  opts: SeoCheckOptions = {}
): Promise<SeoCheckResult> {
  const result: SeoCheckResult = {
    url,
    finalUrl: null,
    statusCode: null,
    error: null,
    responseTimeMs: null,
    redirectChain: [],
    sslValidUntil: null,
    pageWeightBytes: 0,
    gzippedBytes: 0,
    seo: null,
    content: null
  }
  const timeoutMs = opts.timeoutMs ?? 30000
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const start = performance.now()
  try {
    let currentUrl = url
    const chain: string[] = []
    let res: Response
    for (let i = 0; i < MAX_REDIRECTS; i++) {
      res = await fetch(currentUrl, {
        redirect: "manual",
        headers: {
          "User-Agent": opts.userAgent ?? DEFAULT_USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        },
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        const next = new URL(res.headers.get("location")!, currentUrl).toString()
        if (chain.includes(next)) {
          result.statusCode = res.status
          result.error = "Redirect loop"
          result.finalUrl = next
          result.redirectChain = chain
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
    result.redirectChain = chain
    result.finalUrl = currentUrl
    result.responseTimeMs = Math.round(performance.now() - start)

    if (finalRes.status >= 200 && finalRes.status < 300) {
      const body = await readBodyCapped(finalRes, maxBytes)
      result.pageWeightBytes = body.length
      result.gzippedBytes = body.length > 0 ? gzipSync(body).length : 0
      result.seo = extractSeoInfo(body, currentUrl, body.length)
      result.content = analyzeContent(body, currentUrl)
    }

    try {
      const u = new URL(currentUrl)
      if (u.protocol === "https:") {
        const ssl = await checkSsl(u.hostname, Math.min(5000, timeoutMs))
        if (ssl) result.sslValidUntil = ssl.validUntil
      }
    } catch {
      /* ignore SSL errors */
    }
    return result
  } catch (err) {
    result.error = (err as Error).message
    result.responseTimeMs = Math.round(performance.now() - start)
    return result
  }
}
