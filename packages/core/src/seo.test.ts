import { describe, expect, it } from "vitest"
import { extractSeoInfo } from "./seo.js"
import { analyzeContent } from "./seo-checker.js"
import { scoreSeo } from "./seo-score.js"
import type { SeoCheckResult } from "./seo-checker.js"

function toBody(html: string): Uint8Array {
  return new TextEncoder().encode(html)
}

const GOOD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="A well-optimized page about building fast, accessible websites.">
  <meta name="robots" content="index, follow">
  <meta name="theme-color" content="#0f172a">
  <meta name="author" content="Supacrawl">
  <meta name="generator" content="Test Generator">
  <meta property="og:title" content="Build Fast Websites">
  <meta property="og:description" content="Learn how to build fast, accessible websites.">
  <meta property="og:image" content="/og-image.png">
  <meta property="og:image:alt" content="Illustration of a fast website">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:url" content="https://example.com/blog/fast-websites">
  <meta property="og:site_name" content="Example Blog">
  <meta property="og:type" content="article">
  <meta property="og:locale" content="en_US">
  <meta property="article:published_time" content="2026-01-15T10:00:00Z">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Build Fast Websites">
  <meta name="twitter:description" content="Learn how to build fast, accessible websites.">
  <meta name="twitter:image" content="/twitter-image.png">
  <meta name="twitter:image:alt" content="Twitter card alt">
  <meta name="twitter:site" content="@supacrawl">
  <meta name="twitter:creator" content="@supacrawl">
  <title>Build Fast Websites | Example Blog</title>
  <link rel="canonical" href="https://example.com/blog/fast-websites">
  <link rel="alternate" hreflang="en" href="https://example.com/blog/fast-websites">
  <link rel="alternate" hreflang="es" href="https://example.com/es/blog/fast-websites">
  <link rel="icon" href="/favicon.ico" type="image/x-icon">
  <link rel="manifest" href="/manifest.webmanifest">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Build Fast Websites","datePublished":"2026-01-15T10:00:00Z"}</script>
</head>
<body>
  <h1>Build Fast Websites</h1>
  <h2>Why it matters</h2>
  <p>Fast websites rank better and convert more visitors. This guide explains the fundamentals in a practical way that you can apply today to improve your own projects and learn the tradeoffs involved. We cover page weight budgets, server response times, and transfer sizes, then look at how structured data helps search engines understand content, and finish with a checklist that a small team can review before every release to keep quality high. Along the way we share practical tips for writing concise titles and descriptions, choosing the right Open Graph image dimensions, and making sure your canonical tags stay consistent across staging and production environments, because all of these small details add up to a noticeably better experience for both visitors and search engines.</p>
  <img src="/a.png" alt="Fast site A">
  <img src="/b.png">
  <a href="https://example.com/related">Internal link</a>
  <a href="https://example.com/more">Another internal link</a>
  <a href="https://external.example.com">External link</a>
</body>
</html>`

describe("extractSeoInfo", () => {
  const seo = extractSeoInfo(toBody(GOOD_HTML), "https://example.com/blog/fast-websites", 5000)!

  it("extracts core tags", () => {
    expect(seo.title).toBe("Build Fast Websites | Example Blog")
    expect(seo.description).toContain("well-optimized")
    expect(seo.canonical).toBe("https://example.com/blog/fast-websites")
    expect(seo.canonicalSelfReference).toBe(true)
    expect(seo.lang).toBe("en")
    expect(seo.charset).toBe("utf-8")
    expect(seo.viewport).toContain("width=device-width")
    expect(seo.themeColor).toBe("#0f172a")
    expect(seo.author).toBe("Supacrawl")
    expect(seo.generator).toBe("Test Generator")
    expect(seo.publishedAt).toBe("2026-01-15T10:00:00Z")
  })

  it("extracts robots flags", () => {
    expect(seo.noindex).toBe(false)
    expect(seo.nofollow).toBe(false)
    expect(seo.robotsNoarchive).toBe(false)
  })

  it("resolves relative og:image against final URL", () => {
    expect(seo.ogImage).toBe("https://example.com/og-image.png")
    expect(seo.ogImageAlt).toBe("Illustration of a fast website")
    expect(seo.ogImageWidth).toBe(1200)
    expect(seo.ogImageHeight).toBe(630)
  })

  it("extracts full Open Graph + Twitter tags", () => {
    expect(seo.ogTitle).toBe("Build Fast Websites")
    expect(seo.ogUrl).toBe("https://example.com/blog/fast-websites")
    expect(seo.ogSiteName).toBe("Example Blog")
    expect(seo.ogType).toBe("article")
    expect(seo.ogLocale).toBe("en_US")
    expect(seo.twitterCard).toBe("summary_large_image")
    expect(seo.twitterTitle).toBe("Build Fast Websites")
    expect(seo.twitterImage).toBe("https://example.com/twitter-image.png")
    expect(seo.twitterSite).toBe("@supacrawl")
    expect(seo.twitterCreator).toBe("@supacrawl")
  })

  it("extracts hreflang, favicon and manifest", () => {
    expect(seo.hreflangs).toHaveLength(2)
    expect(seo.hreflangs[0]).toEqual({ href: "https://example.com/blog/fast-websites", hreflang: "en" })
    expect(seo.favicon).toBe("https://example.com/favicon.ico")
    expect(seo.manifest).toBe("https://example.com/manifest.webmanifest")
  })

  it("extracts JSON-LD types and datePublished fallback", () => {
    expect(seo.jsonLdTypes).toContain("Article")
    expect(seo.publishedAt).toBe("2026-01-15T10:00:00Z")
  })

  it("detects noindex from robots meta", () => {
    const blocked = extractSeoInfo(
      toBody(`<html><head><meta name="robots" content="noindex, noarchive, max-image-preview:standard"><title>Blocked</title></head><body></body></html>`),
      "https://example.com/"
    )!
    expect(blocked.noindex).toBe(true)
    expect(blocked.robotsNoarchive).toBe(true)
    expect(blocked.robotsMaxImagePreview).toBe("standard")
  })

  it("flags canonical pointing elsewhere", () => {
    const cross = extractSeoInfo(
      toBody(`<html><head><link rel="canonical" href="https://other.example/page"></head><body></body></html>`),
      "https://example.com/page"
    )!
    expect(cross.canonicalSelfReference).toBe(false)
  })

  it("detects og:image when declared with name=\"image\" property=\"og:image\"", () => {
    const seo = extractSeoInfo(
      toBody(
        `<html><head><meta name="image" property="og:image" content="https://example.com/og.png">` +
        `<meta property="og:title" content="T"></head><body></body></html>`
      ),
      "https://example.com/"
    )!
    expect(seo.ogImage).toBe("https://example.com/og.png")
    expect(seo.ogTitle).toBe("T")
  })

  it("treats a bare name=\"image\" meta as og:image", () => {
    const seo = extractSeoInfo(
      toBody(`<html><head><meta name="image" content="/legacy.png"></head><body></body></html>`),
      "https://example.com/page"
    )!
    expect(seo.ogImage).toBe("https://example.com/legacy.png")
  })
})

describe("analyzeContent", () => {
  const stats = analyzeContent(toBody(GOOD_HTML), "https://example.com/blog/fast-websites")

  it("counts words and headings", () => {
    expect(stats.wordCount).toBeGreaterThan(60)
    expect(stats.h2Count).toBe(1)
  })

  it("counts images and missing alt text", () => {
    expect(stats.imageCount).toBe(2)
    expect(stats.imagesMissingAlt).toBe(1)
  })

  it("counts internal vs external links", () => {
    expect(stats.linkCount).toBe(3)
    expect(stats.internalLinkCount).toBe(2)
  })
})

describe("scoreSeo", () => {
  function buildResult(partial: Partial<SeoCheckResult> = {}): SeoCheckResult {
    return {
      url: "https://example.com/blog/fast-websites",
      finalUrl: "https://example.com/blog/fast-websites",
      statusCode: 200,
      error: null,
      responseTimeMs: 800,
      redirectChain: [],
      sslValidUntil: new Date(Date.now() + 60 * 86400000).toISOString(),
      pageWeightBytes: 60 * 1024,
      gzippedBytes: 18 * 1024,
      seo: extractSeoInfo(toBody(GOOD_HTML), "https://example.com/blog/fast-websites", 60 * 1024),
      content: analyzeContent(toBody(GOOD_HTML), "https://example.com/blog/fast-websites"),
      ...partial
    }
  }

  it("scores an optimized page highly with passes", () => {
    const scored = scoreSeo(buildResult())
    expect(scored.score).toBeGreaterThanOrEqual(85)
    expect(scored.audits.filter((a) => a.severity === "fail")).toHaveLength(0)
    expect(scored.categories.map((c) => c.id)).toEqual(["content", "technical", "social", "structured", "performance"])
  })

  it("scores a stripped page low with actionable fails", () => {
    const bare = buildResult({
      seo: extractSeoInfo(
        toBody(`<html><head><title>t</title></head><body><h1>x</h1></body></html>`),
        "https://example.com/",
        400
      ),
      content: { wordCount: 5, imageCount: 0, imagesMissingAlt: 0, linkCount: 0, internalLinkCount: 0, h2Count: 0 },
      responseTimeMs: 9000,
      pageWeightBytes: 1024 * 1024,
      gzippedBytes: 300 * 1024,
      finalUrl: "http://example.com/"
    })
    const scored = scoreSeo(bare)
    expect(scored.score).toBeLessThan(45)
    expect(scored.audits.some((a) => a.id === "title-length")).toBe(true)
    expect(scored.audits.some((a) => a.id === "description-missing")).toBe(true)
    expect(scored.audits.some((a) => a.id === "https-missing")).toBe(true)
    expect(scored.audits.some((a) => a.id === "h1-missing")).toBe(false)
  })

  it("produces a recommendation for failed audits", () => {
    const scored = scoreSeo(buildResult())
    const withRecommendation = scored.audits.filter((a) => a.recommendation)
    expect(withRecommendation.length).toBeGreaterThan(0)
  })
})
