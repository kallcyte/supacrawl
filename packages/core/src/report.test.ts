import { describe, expect, it } from "vitest"
import { buildCrawlReportHtml, buildCrawlSummaryText } from "./report.js"
import type { ReportUrl } from "./report.js"
import type { CrawlSummary } from "./types.js"

// Representative CrawlSummary-shaped input, mapped into the flat option
// objects the report builders take (mirrors how callers feed crawl results in).
function makeSummary(overrides: Partial<CrawlSummary> = {}): CrawlSummary {
  return {
    crawlId: "abcdef1234567890",
    jobName: "Nightly blog check",
    status: "completed",
    startedAt: "2026-08-22T00:00:00.000Z",
    finishedAt: "2026-08-22T00:01:05.000Z",
    durationMs: 65_000,
    totalUrls: 12,
    checkedUrls: 10,
    healthScore: 95,
    avgResponseTimeMs: 240,
    slowestResponseTimeMs: 810,
    fastestResponseTimeMs: 95,
    issues: {
      broken: [],
      changed: [],
      sslExpiring: [],
      mojibake: [],
      llmGarbage: [],
    },
    ...overrides,
  }
}

function toReportOpts(summary: CrawlSummary) {
  const asReportUrl = (issues: CrawlSummary["issues"]["broken"]): ReportUrl[] =>
    issues.map((i) => ({ url: i.url, detail: i.detail }))
  return {
    crawlId: summary.crawlId,
    healthScore: summary.healthScore,
    totalChecked: summary.checkedUrls,
    totalFound: summary.totalUrls,
    brokenCount: summary.issues.broken.length,
    changedCount: summary.issues.changed.length,
    sslCount: summary.issues.sslExpiring.length,
    mojibakeCount: summary.issues.mojibake.length,
    llmGarbageCount: summary.issues.llmGarbage.length,
    brokenUrls: asReportUrl(summary.issues.broken),
    changedUrls: asReportUrl(summary.issues.changed),
    sslUrls: summary.issues.sslExpiring.map((i) => i.url),
  }
}

const HEALTHY = makeSummary()

const MIXED = makeSummary({
  healthScore: 62,
  issues: {
    broken: [
      { url: "https://example.com/dead-page", detail: "HTTP 404", severity: "high" },
      { url: "https://example.com/timeout", detail: "ETIMEDOUT after 30000ms", severity: "high" },
    ],
    changed: [{ url: "https://example.com/pricing", detail: "content hash changed", severity: "medium" }],
    sslExpiring: [{ url: "https://example.com", detail: "expires in 5 days", severity: "high" }],
    mojibake: [],
    llmGarbage: [],
  },
})

describe("buildCrawlReportHtml", () => {
  it("renders the report header with the truncated crawl id and health score", () => {
    const html = buildCrawlReportHtml(toReportOpts(HEALTHY))
    expect(html).toContain("Crawl Report")
    // crawl id is sliced to its first 8 characters
    expect(html).toContain("ID: abcdef12")
    expect(html).not.toContain("abcdef1234567890")
    expect(html).toContain("95%")
  })

  it("includes the stat cards with counts and labels", () => {
    const html = buildCrawlReportHtml(
      toReportOpts(
        makeSummary({
          healthScore: 40,
          issues: {
            ...HEALTHY.issues,
            broken: [{ url: "https://example.com/x", detail: "404", severity: "high" }],
            changed: [{ url: "https://example.com/y", detail: "changed", severity: "medium" }],
            sslExpiring: [{ url: "https://example.com/z", detail: "ssl", severity: "low" }],
            mojibake: [{ url: "https://example.com/m", detail: "moji", severity: "medium" }],
            llmGarbage: [{ url: "https://example.com/g", detail: "garbage", severity: "low" }],
          },
        }),
      ),
    )
    for (const label of ["Broken", "Changed", "SSL Expiring", "Mojibake", "LLM Garbage"]) {
      expect(html).toContain(label)
    }
    expect(html).toContain("Checked <strong")
    expect(html).toContain("10</strong> of <strong")
    expect(html).toContain("12</strong> URLs")
    // 1+1+1+1+1 = 5 aggregated issues
    expect(html).toContain("5 issues found")
  })

  it("lists issue urls and details inside their issue sections", () => {
    const html = buildCrawlReportHtml(toReportOpts(MIXED))
    expect(html).toContain("Broken URLs (2)")
    expect(html).toContain("https://example.com/dead-page")
    expect(html).toContain("HTTP 404")
    expect(html).toContain("https://example.com/timeout")
    expect(html).toContain("Changed URLs (1)")
    expect(html).toContain("https://example.com/pricing")
    expect(html).toContain("SSL Expiring Soon (1)")
    expect(html).toContain("https://example.com")
  })

  it("omits sections for issue categories that have no entries", () => {
    const html = buildCrawlReportHtml(toReportOpts(MIXED))
    expect(html).not.toContain("Mojibake (")
    expect(html).not.toContain("LLM Garbage (")
  })

  it("reports all-healthy summary text when there are no issues", () => {
    const html = buildCrawlReportHtml(toReportOpts(HEALTHY))
    expect(html).toContain("All URLs healthy")
    expect(html).not.toContain("issues found")
    expect(html).not.toContain("Broken URLs (")
    expect(html).not.toContain("Changed URLs (")
    expect(html).not.toContain("SSL Expiring Soon (")
  })

  it("renders an empty/zero-result crawl without throwing", () => {
    const empty = makeSummary({ totalUrls: 0, checkedUrls: 0 })
    expect(() => buildCrawlReportHtml(toReportOpts(empty))).not.toThrow()
    const html = buildCrawlReportHtml(toReportOpts(empty))
    expect(html).toContain("Checked <strong")
    expect(html).toContain("All URLs healthy")
  })

  it("escapes user-controlled strings so injected html renders inert", () => {
    const html = buildCrawlReportHtml(
      toReportOpts(
        makeSummary({
          crawlId: "<script>alert(1)</script>crawl",
          issues: {
            ...HEALTHY.issues,
            broken: [
              {
                url: 'https://example.com/q?x=1&y=<b>"quoted"</b>',
                detail: "boom & <script>alert(2)</script>",
                severity: "high",
              },
            ],
          },
        }),
      ),
    )
    // crawl id is sliced to 8 chars, then escaped
    expect(html).toContain("ID: &lt;script&gt;")
    expect(html).toContain(
      "https://example.com/q?x=1&amp;y=&lt;b&gt;&quot;quoted&quot;&lt;/b&gt;",
    )
    expect(html).toContain("boom &amp; &lt;script&gt;alert(2)&lt;/script&gt;")
    expect(html).not.toContain("<script>")
    expect(html).not.toContain('<b>"quoted"</b>')
  })

  it("handles special characters in urls without throwing or mangling them", () => {
    const html = buildCrawlReportHtml(
      toReportOpts(
        makeSummary({
          issues: {
            ...HEALTHY.issues,
            broken: [
              {
                url: "https://example.com/caf%C3%A9?a=%7Bjson%7D#frag%20ment",
                detail: "unicode ✓ & emoji 🚨",
                severity: "high",
              },
            ],
          },
        }),
      ),
    )
    expect(html).toContain("https://example.com/caf%C3%A9?a=%7Bjson%7D#frag%20ment")
    expect(html).toContain("unicode ✓ &amp; emoji 🚨")
  })
})

describe("buildCrawlSummaryText", () => {
  it("contains counts, health score, and is plain text", () => {
    const text = buildCrawlSummaryText({
      totalChecked: 10,
      totalFound: 12,
      broken: 2,
      changed: 1,
      skipped: 3,
      healthScore: 87,
      durationMs: 65_000,
    })
    expect(text).toBe(
      "Checked 10 of 12 URLs in 1m5s. Health: 87%. 2 broken, 1 changed, 3 skipped.",
    )
    expect(text).not.toContain("<")
    expect(text).not.toContain(">")
  })

  it("formats sub-second durations in milliseconds", () => {
    const text = buildCrawlSummaryText({
      totalChecked: 4,
      totalFound: 4,
      broken: 0,
      changed: 0,
      skipped: 0,
      healthScore: 100,
      durationMs: 850,
    })
    expect(text).toContain("in 850ms.")
  })

  it("formats durations under a minute in seconds", () => {
    const text = buildCrawlSummaryText({
      totalChecked: 4,
      totalFound: 4,
      broken: 0,
      changed: 0,
      skipped: 0,
      healthScore: 100,
      durationMs: 59_500,
    })
    expect(text).toContain("in 59s.")
  })

  it("renders zero-result crawls without throwing", () => {
    expect(() =>
      buildCrawlSummaryText({
        totalChecked: 0,
        totalFound: 0,
        broken: 0,
        changed: 0,
        skipped: 0,
        healthScore: 100,
        durationMs: 0,
      }),
    ).not.toThrow()
    expect(
      buildCrawlSummaryText({
        totalChecked: 0,
        totalFound: 0,
        broken: 0,
        changed: 0,
        skipped: 0,
        healthScore: 100,
        durationMs: 0,
      }),
    ).toContain("Checked 0 of 0 URLs")
  })
})
