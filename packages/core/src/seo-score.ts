import type { SeoCheckResult } from "./seo-checker.js"

export type AuditSeverity = "pass" | "warn" | "fail"

export interface SeoAudit {
  id: string
  title: string
  severity: AuditSeverity
  detail?: string
  recommendation?: string
}

export interface SeoCategoryScore {
  id: string
  label: string
  weight: number
  score: number // 0-100
  pass: number
  warn: number
  fail: number
}

export interface SeoScore {
  score: number
  categories: SeoCategoryScore[]
  audits: SeoAudit[]
}

interface CategoryBuilder {
  audits: SeoAudit[]
  pass: number
  warn: number
  fail: number
}

function makeCategory(): CategoryBuilder {
  return { audits: [], pass: 0, warn: 0, fail: 0 }
}

function audit(b: CategoryBuilder, a: SeoAudit): void {
  b.audits.push(a)
  if (a.severity === "pass") b.pass++
  else if (a.severity === "warn") b.warn++
  else b.fail++
}

const TITLE_MIN = 30
const TITLE_MAX = 60
const DESC_MIN = 70
const DESC_MAX = 160

export function scoreSeo(result: SeoCheckResult): SeoScore {
  const seo = result.seo
  const content = result.content

  const categories: { id: string; label: string; weight: number; build: (b: CategoryBuilder, r: SeoCheckResult) => void }[] = [
    { id: "content", label: "Content & meta", weight: 0.3, build: buildContent },
    { id: "technical", label: "Technical", weight: 0.25, build: buildTechnical },
    { id: "social", label: "Social", weight: 0.2, build: buildSocial },
    { id: "structured", label: "Structured data", weight: 0.1, build: buildStructured },
    { id: "performance", label: "Performance", weight: 0.15, build: buildPerformance }
  ]

  const categoryScores: SeoCategoryScore[] = []
  const allAudits: SeoAudit[] = []
  let weighted = 0

  for (const cat of categories) {
    const b = makeCategory()
    cat.build(b, result)
    const total = b.pass + b.warn + b.fail
    const catScore = total === 0 ? 0 : Math.round(((b.pass + b.warn * 0.5) / total) * 100)
    categoryScores.push({
      id: cat.id,
      label: cat.label,
      weight: cat.weight,
      score: catScore,
      pass: b.pass,
      warn: b.warn,
      fail: b.fail
    })
    allAudits.push(...b.audits)
    weighted += catScore * cat.weight
  }

  return {
    score: Math.round(weighted),
    categories: categoryScores,
    audits: allAudits
  }

  function buildContent(b: CategoryBuilder, r: SeoCheckResult): void {
    if (!seo) {
      audit(b, {
        id: "seo-unavailable",
        title: "SEO data unavailable",
        severity: "fail",
        recommendation: "The page did not return HTML content that could be parsed (non-HTML response, empty body, or too large)."
      })
      return
    }

    if (!seo.title) {
      audit(b, {
        id: "title-missing",
        title: "Page has no <title> tag",
        severity: "fail",
        detail: "Search engines have nothing to use as the page heading.",
        recommendation: "Add a unique <title> tag that clearly describes the page, 30-60 characters long."
      })
    } else if (seo.titleLength < TITLE_MIN || seo.titleLength > TITLE_MAX) {
      audit(b, {
        id: "title-length",
        title: `Title length ${seo.titleLength} chars (recommended ${TITLE_MIN}-${TITLE_MAX})`,
        severity: seo.titleLength > 65 ? "fail" : "warn",
        detail: seo.title,
        recommendation: "Keep the title between 30 and 60 characters so it isn't truncated in search results."
      })
    } else {
      audit(b, {
        id: "title-ok",
        title: "Title is present and well sized",
        severity: "pass",
        detail: `${seo.titleLength} chars`
      })
    }

    if (!seo.description) {
      audit(b, {
        id: "description-missing",
        title: "Missing meta description",
        severity: "fail",
        detail: "No description means search engines pick arbitrary text for the snippet.",
        recommendation: "Add a meta description of 70-160 characters that summarizes the page and includes a call to action."
      })
    } else if (seo.descriptionLength > DESC_MAX) {
      audit(b, {
        id: "description-long",
        title: `Description length ${seo.descriptionLength} chars (recommended ${DESC_MIN}-${DESC_MAX})`,
        severity: "warn",
        detail: seo.description,
        recommendation: "Trim the description to 160 characters or less so it isn't cut off in search results."
      })
    } else if (seo.descriptionLength < DESC_MIN) {
      audit(b, {
        id: "description-short",
        title: `Description length ${seo.descriptionLength} chars (recommended ${DESC_MIN}-${DESC_MAX})`,
        severity: "warn",
        detail: seo.description,
        recommendation: "Expand the description to at least 70 characters so search engines have enough context."
      })
    } else {
      audit(b, {
        id: "description-ok",
        title: "Description is present and well sized",
        severity: "pass",
        detail: `${seo.descriptionLength} chars`
      })
    }

    if (seo.h1Count === 0) {
      audit(b, {
        id: "h1-missing",
        title: "No H1 heading found",
        severity: "fail",
        recommendation: "Add exactly one H1 heading that describes the main topic of the page."
      })
    } else if (seo.h1Count > 1) {
      audit(b, {
        id: "h1-multiple",
        title: `${seo.h1Count} H1 headings found`,
        severity: "warn",
        recommendation: "Use a single H1 per page; break the rest into H2/H3 headings."
      })
    } else {
      audit(b, {
        id: "h1-ok",
        title: "Exactly one H1 heading",
        severity: "pass"
      })
    }

    const words = content?.wordCount ?? seo.wordCount
    if (words < 100) {
      audit(b, {
        id: "words-low",
        title: `Thin content (~${words} words)`,
        severity: "fail",
        recommendation: "Aim for at least 300 words of unique, useful content on the page."
      })
    } else if (words < 300) {
      audit(b, {
        id: "words-medium",
        title: `Moderate content (~${words} words)`,
        severity: "warn",
        recommendation: "Expand the content toward 300+ words for better topical coverage."
      })
    } else {
      audit(b, {
        id: "words-ok",
        title: `Good content depth (~${words} words)`,
        severity: "pass"
      })
    }
  }

  function buildTechnical(b: CategoryBuilder, r: SeoCheckResult): void {
    if (!seo) return
    const finalUrl = r.finalUrl ?? r.url

    if (seo.canonical) {
      if (seo.canonicalSelfReference === false) {
        audit(b, {
          id: "canonical-different",
          title: "Canonical points to a different URL",
          severity: "warn",
          detail: seo.canonical,
          recommendation: "Make the canonical self-referencing (or point to the preferred version) so crawlers don't treat this page as duplicate content."
        })
      } else {
        audit(b, {
          id: "canonical-ok",
          title: "Canonical is self-referencing",
          severity: "pass",
          detail: seo.canonical
        })
      }
    } else {
      audit(b, {
        id: "canonical-missing",
        title: "No canonical URL",
        severity: "warn",
        recommendation: "Add a self-referencing rel=\"canonical\" link to avoid duplicate-content ambiguity."
      })
    }

    if (seo.noindex) {
      audit(b, {
        id: "noindex",
        title: "Page is blocked with noindex",
        severity: "fail",
        detail: "Search engines are told not to index this page.",
        recommendation: "Remove noindex if this page should appear in search results."
      })
    } else {
      audit(b, {
        id: "indexable",
        title: "Page is indexable",
        severity: "pass"
      })
    }

    if (!seo.viewport) {
      audit(b, {
        id: "viewport-missing",
        title: "Missing viewport meta tag",
        severity: "fail",
        recommendation: "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> for proper mobile rendering."
      })
    } else {
      audit(b, {
        id: "viewport-ok",
        title: "Viewport meta tag present",
        severity: "pass",
        detail: seo.viewport
      })
    }

    if (!seo.charset) {
      audit(b, {
        id: "charset-missing",
        title: "Charset not declared",
        severity: "warn",
        recommendation: "Declare the character set (e.g. <meta charset=\"utf-8\">) early in the <head>."
      })
    } else {
      audit(b, {
        id: "charset-ok",
        title: "Charset declared",
        severity: "pass",
        detail: seo.charset
      })
    }

    if (!seo.lang) {
      audit(b, {
        id: "lang-missing",
        title: "No language attribute on <html>",
        severity: "warn",
        recommendation: "Add lang=\"...\" to the <html> element to help search engines and screen readers."
      })
    } else {
      audit(b, {
        id: "lang-ok",
        title: "Language attribute present",
        severity: "pass",
        detail: seo.lang
      })
    }

    const isHttps = finalUrl.toLowerCase().startsWith("https://")
    if (isHttps) {
      audit(b, {
        id: "https-ok",
        title: "Served over HTTPS",
        severity: "pass"
      })
    } else {
      audit(b, {
        id: "https-missing",
        title: "Not served over HTTPS",
        severity: "fail",
        recommendation: "Serve the site over HTTPS; it is a ranking factor and a browser trust signal."
      })
    }

    if (content && content.imagesMissingAlt > 0) {
      audit(b, {
        id: "img-alt",
        title: `${content.imagesMissingAlt} image(s) missing alt text`,
        severity: "warn",
        recommendation: "Add descriptive alt attributes to images for accessibility and image SEO."
      })
    } else if (content && content.imageCount > 0) {
      audit(b, {
        id: "img-alt-ok",
        title: "All images have alt text",
        severity: "pass"
      })
    }
  }

  function buildSocial(b: CategoryBuilder, r: SeoCheckResult): void {
    if (!seo) return
    const ogTitle = seo.ogTitle ?? seo.title
    const ogDescription = seo.ogDescription ?? seo.description

    if (!seo.ogTitle) {
      audit(b, {
        id: "og-title-missing",
        title: "Missing og:title",
        severity: "fail",
        recommendation: "Add an Open Graph title so social platforms show a meaningful link title."
      })
    } else {
      audit(b, {
        id: "og-title-ok",
        title: "og:title present",
        severity: "pass",
        detail: seo.ogTitle
      })
    }

    if (!seo.ogDescription) {
      audit(b, {
        id: "og-desc-missing",
        title: "Missing og:description",
        severity: "fail",
        recommendation: "Add an Open Graph description (2-4 sentences) that summarizes the page."
      })
    } else {
      audit(b, {
        id: "og-desc-ok",
        title: "og:description present",
        severity: "pass",
        detail: seo.ogDescription
      })
    }

    if (!seo.ogImage) {
      audit(b, {
        id: "og-image-missing",
        title: "Missing og:image",
        severity: "fail",
        recommendation: "Add an og:image (recommended 1200x630) so links render with a rich preview image."
      })
    } else {
      audit(b, {
        id: "og-image-ok",
        title: "og:image present",
        severity: "pass",
        detail: seo.ogImage
      })
    }

    if (!seo.ogImage && !seo.twitterImage && ogTitle && ogDescription) {
      audit(b, {
        id: "social-image-missing",
        title: "No image will appear in shared links",
        severity: "fail",
        recommendation: "Provide og:image (and optionally twitter:image) to control the thumbnail shown when links are shared."
      })
    }

    if (seo.twitterCard) {
      audit(b, {
        id: "twitter-card-ok",
        title: `twitter:card declared (${seo.twitterCard})`,
        severity: "pass"
      })
    } else {
      audit(b, {
        id: "twitter-card-missing",
        title: "No twitter:card declared",
        severity: "warn",
        detail: ogTitle && ogDescription ? "X/Twitter will fall back to Open Graph tags." : undefined,
        recommendation: "Add twitter:card=\"summary_large_image\" (with twitter:title/description/image) for a full X preview."
      })
    }

    if (ogTitle && ogDescription) {
      audit(b, {
        id: "social-text-ok",
        title: "Social fallbacks can use title + description",
        severity: "pass"
      })
    }
  }

  function buildStructured(b: CategoryBuilder, r: SeoCheckResult): void {
    if (!seo) return
    if (seo.jsonLdTypes.length > 0) {
      audit(b, {
        id: "jsonld-ok",
        title: `Structured data present (${seo.jsonLdTypes.join(", ")})`,
        severity: "pass",
        detail: `${seo.jsonLdTypes.length} type(s) detected`
      })
    } else {
      audit(b, {
        id: "jsonld-missing",
        title: "No structured data found",
        severity: "warn",
        recommendation: "Add JSON-LD structured data (Organization, WebPage, Article, etc.) to enable rich results."
      })
    }
  }

  function buildPerformance(b: CategoryBuilder, r: SeoCheckResult): void {
    if (!seo) return
    const rt = r.responseTimeMs
    if (rt !== null && rt !== undefined) {
      if (rt < 3000) {
        audit(b, {
          id: "rt-ok",
          title: `Fast response time (${rt}ms)`,
          severity: "pass"
        })
      } else if (rt < 8000) {
        audit(b, {
          id: "rt-slow",
          title: `Slow response time (${rt}ms)`,
          severity: "warn",
          recommendation: "Optimize server response time to under 3 seconds; consider caching and CDN."
        })
      } else {
        audit(b, {
          id: "rt-fail",
          title: `Very slow response time (${rt}ms)`,
          severity: "fail",
          recommendation: "The server response is very slow. Investigate backend latency, hosting, and caching."
        })
      }
    }

    const gzip = r.gzippedBytes
    if (gzip > 0) {
      if (gzip < 50 * 1024) {
        audit(b, {
          id: "gzip-ok",
          title: `Compact HTML payload (${formatKb(gzip)})`,
          severity: "pass"
        })
      } else if (gzip < 200 * 1024) {
        audit(b, {
          id: "gzip-medium",
          title: `Heavy HTML payload (${formatKb(gzip)})`,
          severity: "warn",
          recommendation: "Reduce HTML size: trim inline scripts/styles, remove unused markup, and minify."
        })
      } else {
        audit(b, {
          id: "gzip-fail",
          title: `Very heavy HTML payload (${formatKb(gzip)})`,
          severity: "fail",
          recommendation: "The HTML document is very large. Audit page weight, inline assets, and server-side rendering output."
        })
      }
    }

    const weight = r.pageWeightBytes
    if (weight < 100 * 1024) {
      audit(b, {
        id: "weight-ok",
        title: `Small page (${formatKb(weight)})`,
        severity: "pass"
      })
    } else if (weight < 500 * 1024) {
      audit(b, {
        id: "weight-medium",
        title: `Average page (${formatKb(weight)})`,
        severity: "warn",
        recommendation: "Consider whether the document could be lighter; most landing pages are under 500KB of HTML."
      })
    } else {
      audit(b, {
        id: "weight-fail",
        title: `Large page (${formatKb(weight)})`,
        severity: "fail",
        recommendation: "The HTML document is large. Review inline assets and markup bloat."
      })
    }
  }
}

function formatKb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}
