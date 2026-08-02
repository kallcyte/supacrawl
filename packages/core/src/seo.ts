import type { SeoInfo } from "./types.js"

const MAX_PARSE_BYTES = 5 * 1024 * 1024

function getTagAttrs(tag: string): Map<string, string> {
  const attrs = new Map<string, string>()
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(tag)) !== null) {
    attrs.set((m[1] ?? "").toLowerCase(), m[3] ?? m[4] ?? m[5] ?? "")
  }
  return attrs
}

function extractJsonLd(html: string): { types: string[]; datePublished: string | null } {
  const types = new Set<string>()
  const published: { value: string | null } = { value: null }
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    let data: unknown
    try {
      data = JSON.parse((m[1] ?? "").trim())
    } catch {
      continue
    }
    collectLdData(data, types, published)
  }
  return { types: [...types], datePublished: published.value }
}

function collectLdData(data: unknown, types: Set<string>, published: { value: string | null }): void {
  if (Array.isArray(data)) {
    for (const item of data) collectLdData(item, types, published)
    return
  }
  if (!data || typeof data !== "object") return
  const d = data as Record<string, unknown>
  const t = d["@type"]
  if (Array.isArray(t)) {
    for (const x of t) if (typeof x === "string") types.add(x)
  } else if (typeof t === "string") {
    types.add(t)
  }
  if (!published.value && typeof d["datePublished"] === "string") {
    published.value = d["datePublished"]
  }
  if (Array.isArray(d["@graph"])) {
    for (const item of d["@graph"]) collectLdData(item, types, published)
  }
}

function resolveCanonical(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString()
  } catch {
    return null
  }
}

export function extractSeoInfo(
  htmlBody: Uint8Array,
  finalUrl: string,
  pageWeightBytes?: number
): SeoInfo | null {
  if (htmlBody.length > MAX_PARSE_BYTES) return null
  const html = new TextDecoder("utf-8", { fatal: false }).decode(htmlBody)

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const title = titleMatch ? (titleMatch[1] ?? "").trim() : null

  let description: string | null = null
  let ogTitle: string | null = null
  let ogDescription: string | null = null
  let ogImage: string | null = null
  let publishedAt: string | null = null
  let canonical: string | null = null
  let noindex = false
  let nofollow = false

  const metaRe = /<meta[^>]*>/gi
  let metaMatch: RegExpExecArray | null
  while ((metaMatch = metaRe.exec(html)) !== null) {
    const attrs = getTagAttrs(metaMatch[0])
    const content = attrs.get("content")
    if (content === undefined) continue
    const name = attrs.get("name") ?? attrs.get("property")
    if (!name) continue
    const key = name.toLowerCase()
    if (key === "description") {
      description = content.trim()
    } else if (key === "og:title") {
      ogTitle = content.trim()
    } else if (key === "og:description") {
      ogDescription = content.trim()
    } else if (key === "og:image") {
      ogImage = resolveCanonical(content.trim(), finalUrl)
    } else if (key === "article:published_time") {
      publishedAt = content.trim()
    } else if (key === "robots") {
      const tokens = content.toLowerCase().split(",").map((t) => t.trim())
      if (tokens.includes("noindex")) noindex = true
      if (tokens.includes("nofollow")) nofollow = true
    }
  }

  const linkRe = /<link[^>]*>/gi
  let linkMatch: RegExpExecArray | null
  while ((linkMatch = linkRe.exec(html)) !== null) {
    const attrs = getTagAttrs(linkMatch[0])
    const rel = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/)
    if (rel.includes("canonical") && attrs.has("href")) {
      canonical = resolveCanonical(attrs.get("href")!, finalUrl)
      if (canonical) break
    }
  }

  let canonicalSelfReference: boolean | null = null
  if (canonical) {
    try {
      canonicalSelfReference = new URL(canonical).toString() === new URL(finalUrl).toString()
    } catch {
      canonicalSelfReference = false
    }
  }

  const h1Count = (html.match(/<h1[^>]*>/gi) ?? []).length

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
  const wordCount = text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0

  const { types: jsonLdTypes, datePublished } = extractJsonLd(html)

  return {
    title,
    titleLength: title?.length ?? 0,
    description,
    descriptionLength: description?.length ?? 0,
    canonical,
    canonicalSelfReference,
    noindex,
    nofollow,
    h1Count,
    wordCount,
    pageWeightBytes: pageWeightBytes ?? htmlBody.length,
    jsonLdTypes,
    ogTitle,
    ogDescription,
    ogImage,
    publishedAt: publishedAt ?? datePublished
  }
}
