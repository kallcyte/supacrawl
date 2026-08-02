import { XMLParser } from "fast-xml-parser"
import { gunzipSync } from "node:zlib"
import { fetchAndParseRobots } from "./robots.js"
import type { SitemapEntry, SitemapResult } from "./types.js"

const COMMON_SITEMAP_PATHS = [
  "/sitemap.xml",
  "/sitemap_index.xml",
  "/sitemap-index.xml",
  "/sitemapindex.xml",
  "/sitemap.xml.gz",
  "/sitemap_index.xml.gz",
  "/sitemap-index.xml.gz",
  "/sitemap/sitemap.xml",
  "/sitemap/sitemap_index.xml",
  "/sitemaps/sitemap.xml",
  "/sitemaps/sitemap_index.xml",
  "/wp-sitemap.xml"
]

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => name === "sitemap" || name === "url"
})

export async function fetchSitemapBytes(
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ body: Uint8Array; isGzipped: boolean }> {
  const res = await fetchImpl(url, {
    headers: { Accept: "application/xml, text/xml, */*" }
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch sitemap ${url}: HTTP ${res.status}`)
  }
  const buf = new Uint8Array(await res.arrayBuffer())
  const isGzipped =
    url.toLowerCase().endsWith(".gz") ||
    (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b)
  if (isGzipped) {
    const decompressed = gunzipSync(buf)
    return { body: new Uint8Array(decompressed), isGzipped: true }
  }
  return { body: buf, isGzipped: false }
}

export function isLikelySitemapUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url)
    return /\.xml(\.gz)?$/i.test(pathname) || /sitemap/i.test(pathname)
  } catch {
    return false
  }
}

export interface SitemapResolution {
  urls: string[]
  errors: string[]
}

export async function resolveSitemapUrls(
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<SitemapResolution> {
  const errors: string[] = []
  const normalized = new URL(url).toString()
  if (isLikelySitemapUrl(normalized)) return { urls: [normalized], errors }

  const origin = new URL(normalized).origin
  const urls: string[] = []
  const seen = new Set<string>()

  try {
    const robots = await fetchAndParseRobots(origin, fetchImpl)
    for (const s of robots.sitemaps) {
      if (!seen.has(s)) {
        seen.add(s)
        urls.push(s)
      }
    }
  } catch (err) {
    errors.push(`Failed to parse robots.txt: ${(err as Error).message}`)
  }

  const probes = await Promise.all(
    COMMON_SITEMAP_PATHS.map(async (path): Promise<string | null> => {
      const candidate = new URL(path, origin).toString()
      if (seen.has(candidate)) return null
      try {
        const res = await fetchImpl(candidate, {
          headers: { Accept: "application/xml, text/xml, */*" }
        })
        if (!res.ok) return null
        const ct = res.headers.get("content-type") ?? ""
        if (ct && !/xml/i.test(ct)) return null
        return candidate
      } catch {
        return null
      }
    })
  )

  for (const found of probes) {
    if (found && !seen.has(found)) {
      seen.add(found)
      urls.push(found)
    }
  }

  return { urls, errors }
}

function decodeXml(body: Uint8Array): string {
  return new TextDecoder("utf-8").decode(body)
}

function normalizeUrl(loc: unknown): string | null {
  if (typeof loc !== "string" || loc.length === 0) return null
  try {
    return new URL(loc).toString()
  } catch {
    return null
  }
}

interface ParsedSitemap {
  url?: SitemapEntry[]
  sitemap?: { loc: string; lastmod?: string }[]
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return []
  return Array.isArray(v) ? v : [v]
}

function parseSitemapXml(xml: string): Record<string, unknown> {
  const parsed = parser.parse(xml) as Record<string, unknown>
  return (parsed.urlset ?? parsed["sitemapindex"] ?? {}) as Record<string, unknown>
}

function extractUrlEntries(xml: string): SitemapEntry[] {
  const parsed = parseSitemapXml(xml)
  const urls = asArray((parsed as Record<string, unknown>).url)
  const out: SitemapEntry[] = []
  for (const u of urls) {
    if (!u || typeof u !== "object") continue
    const obj = u as unknown as Record<string, unknown>
    const loc = normalizeUrl(obj.loc)
    if (!loc) continue
    const entry: SitemapEntry = { loc }
    if (typeof obj.lastmod === "string") entry.lastmod = obj.lastmod
    if (typeof obj.changefreq === "string") entry.changefreq = obj.changefreq
    if (typeof obj.priority === "string" || typeof obj.priority === "number") {
      const p = Number(obj.priority)
      if (Number.isFinite(p)) entry.priority = p
    }
    out.push(entry)
  }
  return out
}

function extractIndexEntries(xml: string): string[] {
  const parsed = parseSitemapXml(xml)
  const sitemaps = asArray((parsed as Record<string, unknown>).sitemap)
  const out: string[] = []
  for (const s of sitemaps) {
    if (!s || typeof s !== "object") continue
    const loc = normalizeUrl((s as Record<string, unknown>).loc)
    if (loc) out.push(loc)
  }
  return out
}

export interface SitemapFetchOptions {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  maxDepth?: number
  onProgress?: (visited: number) => void
}

export interface SitemapTreeNode {
  url: string
  leafCount: number
  children: SitemapTreeNode[]
}

export async function discoverSitemapTree(
  rootUrl: string,
  fetchImpl: typeof fetch = fetch,
  maxDepth = 3
): Promise<SitemapTreeNode> {
  const seen = new Set<string>()
  const leafCounts = new Map<string, number>()

  async function build(url: string, depth: number): Promise<SitemapTreeNode> {
    if (seen.has(url) || depth > maxDepth) return { url, leafCount: 0, children: [] }
    seen.add(url)
    try {
      const { body } = await fetchSitemapBytes(url, fetchImpl)
      const xml = new TextDecoder("utf-8").decode(body)
      const childIndex = extractIndexEntries(xml)
      if (childIndex.length > 0) {
        const children = await Promise.all(childIndex.map((c) => build(c, depth + 1)))
        const sum = children.reduce((acc, c) => acc + c.leafCount, 0)
        leafCounts.set(url, sum)
        return { url, leafCount: sum, children }
      }
      const childUrls = extractUrlEntries(xml)
      const xmlChildren: SitemapTreeNode[] = []
      const directUrls: string[] = []
      for (const u of childUrls) {
        if (/\.xml(\.gz)?$/i.test(new URL(u.loc).pathname)) {
          xmlChildren.push(await build(u.loc, depth + 1))
        } else {
          directUrls.push(u.loc)
        }
      }
      const sum = xmlChildren.reduce((acc, c) => acc + c.leafCount, 0) + directUrls.length
      leafCounts.set(url, sum)
      return { url, leafCount: sum, children: xmlChildren }
    } catch {
      leafCounts.set(url, 0)
      return { url, leafCount: 0, children: [] }
    }
  }

  if (isLikelySitemapUrl(rootUrl)) return build(rootUrl, 0)

  const { urls } = await resolveSitemapUrls(rootUrl, fetchImpl)
  if (urls.length === 0) return { url: rootUrl, leafCount: 0, children: [] }
  const children = await Promise.all(urls.map((u) => build(u, 1)))
  const sum = children.reduce((acc, c) => acc + c.leafCount, 0)
  return { url: rootUrl, leafCount: sum, children }
}

export async function fetchAndParseSitemap(
  rootUrl: string,
  options: SitemapFetchOptions = {}
): Promise<SitemapResult> {
  const { fetchImpl = fetch, signal, maxDepth = 3, onProgress } = options
  const errors: string[] = []
  const seen = new Set<string>()
  const entries: SitemapEntry[] = []
  const queue: { url: string; depth: number }[] = []
  let visited = 0

  if (isLikelySitemapUrl(rootUrl)) {
    queue.push({ url: rootUrl, depth: 0 })
  } else {
    const resolved = await resolveSitemapUrls(rootUrl, fetchImpl)
    errors.push(...resolved.errors)
    for (const u of resolved.urls) queue.push({ url: u, depth: 0 })
    if (resolved.urls.length === 0) {
      errors.push(
        `No sitemaps found for ${rootUrl}. Try the sitemap URL directly or add one to robots.txt.`
      )
    }
  }

  while (queue.length > 0) {
    const item = queue.shift()
    if (!item) break
    if (seen.has(item.url)) continue
    seen.add(item.url)
    if (item.depth > maxDepth) {
      errors.push(`Max depth exceeded for ${item.url}`)
      continue
    }
    try {
      const { body } = await fetchSitemapBytes(item.url, fetchImpl)
      if (signal?.aborted) break
      const xml = decodeXml(body)
      const childIndex = extractIndexEntries(xml)
      if (childIndex.length > 0) {
        for (const child of childIndex) queue.push({ url: child, depth: item.depth + 1 })
      } else {
        const childUrls = extractUrlEntries(xml)
        for (const u of childUrls) {
          if (/\.xml(\.gz)?$/i.test(new URL(u.loc).pathname)) {
            queue.push({ url: u.loc, depth: item.depth + 1 })
          } else {
            entries.push(u)
          }
        }
      }
    } catch (err) {
      errors.push(`Failed to parse ${item.url}: ${(err as Error).message}`)
    }
    visited++
    onProgress?.(visited)
  }

  const dedup = new Map<string, SitemapEntry>()
  for (const e of entries) {
    const existing = dedup.get(e.loc)
    if (!existing) {
      dedup.set(e.loc, e)
    } else if (e.lastmod && (!existing.lastmod || e.lastmod > existing.lastmod)) {
      dedup.set(e.loc, { ...existing, lastmod: e.lastmod })
    }
  }

  return { urls: [...dedup.values()], errors }
}
