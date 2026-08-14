import type { SeoInfo } from "./types.js"

const MAX_PARSE_BYTES = 5 * 1024 * 1024

export function getTagAttrs(tag: string): Map<string, string> {
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
  let ogSiteName: string | null = null
  let ogUrl: string | null = null
  let ogType: string | null = null
  let ogLocale: string | null = null
  let ogImageAlt: string | null = null
  let ogImageWidth: number | null = null
  let ogImageHeight: number | null = null
  let twitterCard: string | null = null
  let twitterTitle: string | null = null
  let twitterDescription: string | null = null
  let twitterImage: string | null = null
  let twitterImageAlt: string | null = null
  let twitterSite: string | null = null
  let twitterCreator: string | null = null
  let charset: string | null = null
  let viewport: string | null = null
  let themeColor: string | null = null
  let author: string | null = null
  let generator: string | null = null
  let publishedAt: string | null = null
  let canonical: string | null = null
  let noindex = false
  let nofollow = false
  let noarchive = false
  let maxImagePreview: string | null = null

  const langMatch = /<html[^>]*>/i.exec(html)
  const lang = langMatch ? getTagAttrs(langMatch[0]).get("lang") ?? null : null

  const metaRe = /<meta[^>]*>/gi
  let metaMatch: RegExpExecArray | null
  while ((metaMatch = metaRe.exec(html)) !== null) {
    const attrs = getTagAttrs(metaMatch[0])
    const content = attrs.get("content")
    // Prefer property over name: some pages declare e.g. og:image using
    // <meta name="image" property="og:image">, where the name attribute would
    // otherwise shadow the Open Graph property.
    const name = (attrs.get("property") ?? attrs.get("name") ?? "").toLowerCase()
    if (attrs.has("charset")) {
      charset = attrs.get("charset") ?? charset
      continue
    }
    if (name === "charset" && content !== undefined) {
      charset = content.trim()
      continue
    }
    if (content === undefined) continue
    if (!name) continue
    // Legacy alias: <meta name="image"> without a property means og:image.
    const key = name === "image" && !attrs.has("property") ? "og:image" : name
    const value = content.trim()
    if (key === "description") {
      description = value
    } else if (key === "og:title") {
      ogTitle = value
    } else if (key === "og:description") {
      ogDescription = value
    } else if (key === "og:image") {
      ogImage = resolveCanonical(value, finalUrl)
    } else if (key === "og:image:alt") {
      ogImageAlt = value
    } else if (key === "og:image:width") {
      ogImageWidth = parseInt(value, 10) || null
    } else if (key === "og:image:height") {
      ogImageHeight = parseInt(value, 10) || null
    } else if (key === "og:site_name") {
      ogSiteName = value
    } else if (key === "og:url") {
      ogUrl = resolveCanonical(value, finalUrl)
    } else if (key === "og:type") {
      ogType = value
    } else if (key === "og:locale") {
      ogLocale = value
    } else if (key === "twitter:card") {
      twitterCard = value
    } else if (key === "twitter:title") {
      twitterTitle = value
    } else if (key === "twitter:description") {
      twitterDescription = value
    } else if (key === "twitter:image") {
      twitterImage = resolveCanonical(value, finalUrl)
    } else if (key === "twitter:image:alt") {
      twitterImageAlt = value
    } else if (key === "twitter:site") {
      twitterSite = value
    } else if (key === "twitter:creator") {
      twitterCreator = value
    } else if (key === "viewport") {
      viewport = value
    } else if (key === "theme-color") {
      themeColor = value
    } else if (key === "author") {
      author = value
    } else if (key === "generator") {
      generator = value
    } else if (key === "article:published_time") {
      publishedAt = value
    } else if (key === "robots") {
      const tokens = value.toLowerCase().split(",").map((t) => t.trim())
      if (tokens.includes("noindex")) noindex = true
      if (tokens.includes("nofollow")) nofollow = true
      if (tokens.includes("noarchive")) noarchive = true
      const mip = tokens.find((t) => t.startsWith("max-image-preview:"))
      if (mip) maxImagePreview = mip.slice("max-image-preview:".length)
    }
  }

  const hreflangs: { href: string; hreflang: string }[] = []
  let favicon: string | null = null
  let manifest: string | null = null

  const linkRe = /<link[^>]*>/gi
  let linkMatch: RegExpExecArray | null
  while ((linkMatch = linkRe.exec(html)) !== null) {
    const attrs = getTagAttrs(linkMatch[0])
    const rel = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/)
    if (rel.includes("canonical") && attrs.has("href")) {
      canonical = resolveCanonical(attrs.get("href")!, finalUrl)
    } else if (rel.includes("alternate") && attrs.has("href") && attrs.get("hreflang")) {
      const href = resolveCanonical(attrs.get("href")!, finalUrl)
      if (href) hreflangs.push({ href, hreflang: attrs.get("hreflang")! })
    } else if (rel.includes("icon") && attrs.has("href") && !favicon) {
      favicon = resolveCanonical(attrs.get("href")!, finalUrl)
    } else if (rel.includes("manifest") && attrs.has("href") && !manifest) {
      manifest = resolveCanonical(attrs.get("href")!, finalUrl)
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
    publishedAt: publishedAt ?? datePublished,
    ogSiteName,
    ogUrl,
    ogType,
    ogLocale,
    ogImageAlt,
    ogImageWidth,
    ogImageHeight,
    twitterCard,
    twitterTitle,
    twitterDescription,
    twitterImage,
    twitterImageAlt,
    twitterSite,
    twitterCreator,
    charset,
    viewport,
    lang,
    hreflangs,
    favicon,
    themeColor,
    manifest,
    author,
    generator,
    robotsNoarchive: noarchive,
    robotsMaxImagePreview: maxImagePreview
  }
}
