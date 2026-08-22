import { afterEach, describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
import { runCrawl } from "./crawler.js"
import type {
  CheckResult,
  CrawlConfig,
  CrawlProgress,
  SitemapEntry
} from "./types.js"

const ORIGIN = "http://site.test"
const ROBOTS_URL = `${ORIGIN}/robots.txt`
const SITEMAP_URL = `${ORIGIN}/sitemap.xml`

/** Test fixture page; many call sites must stay byte-identical for hashing. */
function page(title: string): string {
  return `<!DOCTYPE html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>plain readable text</p></body></html>`
}

function sha256(body: string): string {
  return createHash("sha256").update(body).digest("hex")
}

function buildSitemapXml(locs: string[]): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...locs.map((loc) => `  <url><loc>${loc}</loc></url>`),
    `</urlset>`
  ].join("\n")
}

interface FakeRoute {
  status?: number
  headers?: Record<string, string>
  body?: string | null
  rejectWith?: string
}

interface FakeSite {
  fetchImpl: typeof fetch
  requestedUrls: string[]
  readonly maxInFlight: number
  setRoute(url: string, route: FakeRoute): void
}

/**
 * In-memory "site": serves robots.txt, sitemap.xml and per-URL HTML pages.
 * All URLs are plain http so the SSL check in checkUrl is skipped.
 */
function createFakeSite(
  sitemapUrls: string[],
  routes: Record<string, FakeRoute> = {}
): FakeSite {
  const all: Record<string, FakeRoute> = {
    [ROBOTS_URL]: {
      status: 200,
      body: "User-agent: *\nDisallow: /private\n"
    },
    [SITEMAP_URL]: { status: 200, body: buildSitemapXml(sitemapUrls) },
    ...routes
  }
  const requestedUrls: string[] = []
  let inFlight = 0
  let currentMaxInFlight = 0

  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    requestedUrls.push(url)
    const route = all[url]
    // Suspend on a microtask so concurrently queued requests genuinely overlap
    // without paying real wall-clock time.
    let resolveGate: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve
    })
    queueMicrotask(resolveGate)
    inFlight++
    currentMaxInFlight = Math.max(currentMaxInFlight, inFlight)
    try {
      await gate
      if (route?.rejectWith) throw new Error(route.rejectWith)
      if (!route) return new Response("not found", { status: 404 })
      return new Response(route.body ?? null, {
        status: route.status ?? 200,
        headers: route.headers
      })
    } finally {
      inFlight--
    }
  }) as typeof fetch

  return {
    fetchImpl,
    requestedUrls,
    get maxInFlight() {
      return currentMaxInFlight
    },
    setRoute(url, route) {
      all[url] = route
    }
  }
}

function crawlConfig(over: Partial<CrawlConfig> = {}): CrawlConfig {
  return {
    delayMs: 0,
    maxConcurrency: 4,
    timeoutMs: 5000,
    userAgent: "supacrawl-test/1.0",
    respectRobotsTxt: true,
    maxUrls: 999999,
    retryOnTransientError: false,
    maxRetries: 0,
    detectMojibake: true,
    detectLlmGarbage: true,
    maxBodyBytes: 256 * 1024,
    maxGlobalConcurrency: 8,
    ...over
  }
}

const BASE_SITEMAP_URLS = [
  `${ORIGIN}/a`,
  `${ORIGIN}/b`,
  `${ORIGIN}/c`,
  `${ORIGIN}/redirect`,
  `${ORIGIN}/private/x`
]

function baseRoutes(): Record<string, FakeRoute> {
  return {
    [`${ORIGIN}/a`]: { status: 200, body: page("Page A") },
    [`${ORIGIN}/b`]: { status: 200, body: page("Page B") },
    [`${ORIGIN}/c`]: { status: 404, body: "gone" },
    [`${ORIGIN}/redirect`]: { status: 301, headers: { Location: "/a" } },
    [`${ORIGIN}/private/x`]: { status: 200, body: page("secret") }
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("runCrawl", () => {
  it("fetches the sitemap, robots.txt and every allowed page exactly once", async () => {
    const site = createFakeSite(BASE_SITEMAP_URLS, baseRoutes())
    const results: CheckResult[] = []

    const { entries, errors } = await runCrawl({
      crawlId: "crawl-1",
      config: crawlConfig(),
      sitemaps: [SITEMAP_URL],
      onResult: (r) => results.push(r),
      fetchImpl: site.fetchImpl
    })

    expect(errors).toEqual([])
    expect(entries.map((e) => e.loc).sort()).toEqual(
      [...BASE_SITEMAP_URLS].sort()
    )
    // /private/x is disallowed by robots.txt and must never be fetched.
    const resultUrls = results.map((r) => r.url).sort()
    expect(resultUrls).toEqual([
      `${ORIGIN}/a`,
      `${ORIGIN}/b`,
      `${ORIGIN}/c`,
      `${ORIGIN}/redirect`
    ])
    // robots.txt and the sitemap itself are each fetched exactly once.
    expect(site.requestedUrls.filter((u) => u === ROBOTS_URL)).toHaveLength(1)
    expect(site.requestedUrls.filter((u) => u === SITEMAP_URL)).toHaveLength(1)
  })

  it("carries expected status codes and body-derived fields per page", async () => {
    const site = createFakeSite(BASE_SITEMAP_URLS, baseRoutes())
    const resultsByUrl = new Map<string, CheckResult>()

    await runCrawl({
      crawlId: "crawl-2",
      config: crawlConfig(),
      sitemaps: [SITEMAP_URL],
      onResult: (r) => resultsByUrl.set(r.url, r),
      fetchImpl: site.fetchImpl
    })

    const ok = resultsByUrl.get(`${ORIGIN}/a`)!
    expect(ok.statusCode).toBe(200)
    expect(ok.error).toBeNull()
    expect(ok.contentHash).toBe(sha256(page("Page A")))
    expect(ok.finalUrl).toBe(`${ORIGIN}/a`)
    expect(ok.checkMethod).toBe("GET")

    const notFound = resultsByUrl.get(`${ORIGIN}/c`)!
    expect(notFound.statusCode).toBe(404)
    // Non-2xx responses are not hashed/parsed.
    expect(notFound.contentHash).toBeNull()
  })

  it("follows manual redirects and records the redirect chain", async () => {
    const site = createFakeSite(BASE_SITEMAP_URLS, baseRoutes())
    const resultsByUrl = new Map<string, CheckResult>()

    await runCrawl({
      crawlId: "crawl-3",
      config: crawlConfig(),
      sitemaps: [SITEMAP_URL],
      onResult: (r) => resultsByUrl.set(r.url, r),
      fetchImpl: site.fetchImpl
    })

    const redirected = resultsByUrl.get(`${ORIGIN}/redirect`)!
    expect(redirected.statusCode).toBe(200)
    expect(redirected.redirectChain).toEqual([`${ORIGIN}/redirect`])
    expect(redirected.finalUrl).toBe(`${ORIGIN}/a`)
    expect(redirected.contentHash).toBe(sha256(page("Page A")))
  })

  it("skips robots-disallowed URLs and reports them as skipped", async () => {
    const site = createFakeSite(BASE_SITEMAP_URLS, baseRoutes())
    const results: CheckResult[] = []
    const progress: CrawlProgress[] = []

    const { entries } = await runCrawl({
      crawlId: "crawl-4",
      config: crawlConfig(),
      sitemaps: [SITEMAP_URL],
      onResult: (r) => results.push(r),
      onProgress: (p) => progress.push({ ...p }),
      fetchImpl: site.fetchImpl
    })

    // Entry is listed but never checked.
    expect(entries.some((e) => e.loc === `${ORIGIN}/private/x`)).toBe(true)
    expect(results.some((r) => r.url === `${ORIGIN}/private/x`)).toBe(false)
    expect(site.requestedUrls).not.toContain(`${ORIGIN}/private/x`)

    const last = progress[progress.length - 1]!
    expect(last.status).toBe("completed")
    expect(last.total).toBe(BASE_SITEMAP_URLS.length)
    expect(last.skipped).toBe(1)
    expect(last.broken).toBe(1)
    expect(last.checked).toBe(BASE_SITEMAP_URLS.length)
  })

  it("checks disallowed URLs when respectRobotsTxt is false", async () => {
    const site = createFakeSite(BASE_SITEMAP_URLS, baseRoutes())
    const results: CheckResult[] = []
    const progress: CrawlProgress[] = []

    await runCrawl({
      crawlId: "crawl-5",
      config: crawlConfig({ respectRobotsTxt: false }),
      sitemaps: [SITEMAP_URL],
      onResult: (r) => results.push(r),
      onProgress: (p) => progress.push({ ...p }),
      fetchImpl: site.fetchImpl
    })

    expect(results.map((r) => r.url).sort()).toEqual(
      [...BASE_SITEMAP_URLS].sort()
    )
    const last = progress[progress.length - 1]!
    expect(last.skipped).toBe(0)
    expect(last.broken).toBe(1)
  })

  it("does not lose or duplicate results under concurrency", async () => {
    const urls = Array.from({ length: 24 }, (_, i) => `${ORIGIN}/p${i}`)
    const routes: Record<string, FakeRoute> = {}
    for (const u of urls) routes[u] = { status: 200, body: page(u) }
    const site = createFakeSite(urls, routes)
    const results: CheckResult[] = []

    const { entries, errors } = await runCrawl({
      crawlId: "crawl-6",
      config: crawlConfig({
        maxConcurrency: 3,
        maxGlobalConcurrency: 6,
        delayMs: 0
      }),
      sitemaps: [SITEMAP_URL],
      onResult: (r) => results.push(r),
      fetchImpl: site.fetchImpl
    })

    expect(errors).toEqual([])
    expect(entries).toHaveLength(24)
    expect(results).toHaveLength(24)
    expect(new Set(results.map((r) => r.url)).size).toBe(24)
    expect(results.every((r) => r.statusCode === 200)).toBe(true)
    // Global cap must hold even though many tasks were queued.
    expect(site.maxInFlight).toBeLessThanOrEqual(6)
    // And work genuinely ran concurrently.
    expect(site.maxInFlight).toBeGreaterThan(1)
  })

  it("emits progress from running to completed with final counters", async () => {
    const site = createFakeSite(BASE_SITEMAP_URLS, baseRoutes())
    const progress: CrawlProgress[] = []

    await runCrawl({
      crawlId: "crawl-7",
      config: crawlConfig({ respectRobotsTxt: false }),
      sitemaps: [SITEMAP_URL],
      onProgress: (p) => progress.push({ ...p }),
      fetchImpl: site.fetchImpl
    })

    expect(progress.length).toBeGreaterThanOrEqual(2)
    expect(progress[0]).toMatchObject({
      crawlId: "crawl-7",
      total: BASE_SITEMAP_URLS.length,
      checked: 0,
      status: "running"
    })
    const last = progress[progress.length - 1]!
    expect(last.status).toBe("completed")
    expect(last.finishedAt).toBeTruthy()
    expect(last.checked).toBe(BASE_SITEMAP_URLS.length)
    expect(last.changed).toBe(0)
    // Intermediate progress must be monotonic in checked count.
    let previousChecked = 0
    for (const p of progress) {
      expect(p.checked).toBeGreaterThanOrEqual(previousChecked)
      previousChecked = p.checked
    }
  })

  it("hands parsed sitemap entries to onEntries", async () => {
    const site = createFakeSite(BASE_SITEMAP_URLS, baseRoutes())
    let receivedEntries: SitemapEntry[] = []

    await runCrawl({
      crawlId: "crawl-8",
      config: crawlConfig(),
      sitemaps: [SITEMAP_URL],
      onEntries: (entries) => {
        receivedEntries = entries
      },
      fetchImpl: site.fetchImpl
    })

    expect(receivedEntries.map((e) => e.loc).sort()).toEqual(
      [...BASE_SITEMAP_URLS].sort()
    )
  })

  it("flags content changes against knownHashes", async () => {
    const site = createFakeSite(BASE_SITEMAP_URLS, baseRoutes())
    const firstPass = new Map<string, CheckResult>()

    await runCrawl({
      crawlId: "crawl-9",
      config: crawlConfig(),
      sitemaps: [SITEMAP_URL],
      onResult: (r) => firstPass.set(r.url, r),
      fetchImpl: site.fetchImpl
    })
    expect(firstPass.get(`${ORIGIN}/a`)!.contentChanged).toBe(false)

    // Second pass: stale hash for /a means change detected there only.
    const secondPass = new Map<string, CheckResult>()
    await runCrawl({
      crawlId: "crawl-9b",
      config: crawlConfig(),
      sitemaps: [SITEMAP_URL],
      onResult: (r) => secondPass.set(r.url, r),
      knownHashes: new Map([
        [`${ORIGIN}/a`, "stale-hash"],
        [`${ORIGIN}/b`, sha256(page("Page B"))]
      ]),
      fetchImpl: site.fetchImpl
    })
    expect(secondPass.get(`${ORIGIN}/a`)!.contentChanged).toBe(true)
    expect(secondPass.get(`${ORIGIN}/b`)!.contentChanged).toBe(false)
    expect(secondPass.get(`${ORIGIN}/c`)!.contentChanged).toBe(false)
  })

  it("records network failures with a null status and the error message", async () => {
    const urls = [...BASE_SITEMAP_URLS, `${ORIGIN}/boom`]
    const site = createFakeSite(urls, {
      ...baseRoutes(),
      [`${ORIGIN}/boom`]: { rejectWith: "connection reset" }
    })
    const resultsByUrl = new Map<string, CheckResult>()
    const progress: CrawlProgress[] = []

    const { entries, errors } = await runCrawl({
      crawlId: "crawl-10",
      config: crawlConfig(),
      sitemaps: [SITEMAP_URL],
      onResult: (r) => resultsByUrl.set(r.url, r),
      onProgress: (p) => progress.push({ ...p }),
      fetchImpl: site.fetchImpl
    })

    expect(errors).toEqual([])
    expect(entries).toHaveLength(urls.length)

    const failed = resultsByUrl.get(`${ORIGIN}/boom`)!
    expect(failed.statusCode).toBeNull()
    expect(failed.error).toBe("connection reset")
    expect(failed.contentHash).toBeNull()

    // Failed fetches count as neither broken (no >=400 status) nor skipped;
    // robots-skipped URLs still increment checked.
    const last = progress[progress.length - 1]!
    expect(last.checked).toBe(urls.length)
    expect(last.skipped).toBe(1)
  })

  it("reports invalid sitemap URLs in errors instead of throwing", async () => {
    const site = createFakeSite([], {})
    const { entries, errors } = await runCrawl({
      crawlId: "crawl-11",
      config: crawlConfig(),
      sitemaps: ["not-a-valid-url"],
      fetchImpl: site.fetchImpl
    })

    expect(entries).toEqual([])
    expect(errors).toEqual([
      "Invalid sitemap URL: not-a-valid-url",
      "Sitemap not-a-valid-url failed: Invalid URL"
    ])
  })

  it("respects maxUrls by truncating crawled entries", async () => {
    const urls = Array.from({ length: 10 }, (_, i) => `${ORIGIN}/m${i}`)
    const routes: Record<string, FakeRoute> = {}
    for (const u of urls) routes[u] = { status: 200, body: page(u) }
    const site = createFakeSite(urls, routes)
    const results: CheckResult[] = []

    const { entries } = await runCrawl({
      crawlId: "crawl-12",
      config: crawlConfig({ maxUrls: 4, respectRobotsTxt: false }),
      sitemaps: [SITEMAP_URL],
      onResult: (r) => results.push(r),
      fetchImpl: site.fetchImpl
    })

    expect(entries).toHaveLength(4)
    expect(results).toHaveLength(4)
  })
})
