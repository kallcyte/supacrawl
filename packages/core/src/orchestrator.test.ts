import { afterEach, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCrawlWithPersistence } from "./orchestrator.js"
import { Notifier } from "./notifier/index.js"
import { Storage } from "./storage.js"
import type {
  CheckResult,
  Config,
  CrawlConfig,
  CrawlProgress,
  CrawlStatus,
  NotificationsConfig,
  NotificationEvent,
  NotificationPayload
} from "./types.js"

const ORIGIN = "http://site.test"
const SITEMAP_URL = `${ORIGIN}/sitemap.xml`

function page(title: string): string {
  return `<!DOCTYPE html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>plain readable text</p></body></html>`
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
  setRoute(url: string, route: FakeRoute): void
}

/**
 * In-memory "site" serving robots.txt, sitemap.xml and HTML pages over plain
 * http (so checkUrl skips its TLS probe). Requests suspend on a microtask so
 * overlapping work interleaves deterministically without real timers.
 */
function createFakeSite(
  sitemapUrls: string[],
  routes: Record<string, FakeRoute> = {}
): FakeSite {
  const all: Record<string, FakeRoute> = {
    [`${ORIGIN}/robots.txt`]: {
      status: 200,
      body: "User-agent: *\nDisallow:\n"
    },
    [SITEMAP_URL]: { status: 200, body: buildSitemapXml(sitemapUrls) },
    ...routes
  }
  const requestedUrls: string[] = []

  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    requestedUrls.push(url)
    const route = all[url]
    let resolveGate: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve
    })
    queueMicrotask(resolveGate)
    await gate
    if (route?.rejectWith) throw new Error(route.rejectWith)
    if (!route) return new Response("not found", { status: 404 })
    return new Response(route.body ?? null, {
      status: route.status ?? 200,
      headers: route.headers
    })
  }) as typeof fetch

  return {
    fetchImpl,
    requestedUrls,
    setRoute(url, route) {
      all[url] = route
    }
  }
}

// Site under crawl: two healthy pages, one 404, one redirect to /a.
const SITE_URLS = [
  `${ORIGIN}/a`,
  `${ORIGIN}/b`,
  `${ORIGIN}/c`,
  `${ORIGIN}/d`
]

function siteRoutes(): Record<string, FakeRoute> {
  return {
    [`${ORIGIN}/a`]: { status: 200, body: page("Page A") },
    [`${ORIGIN}/b`]: { status: 200, body: page("Page B") },
    [`${ORIGIN}/c`]: { status: 404, body: "gone" },
    [`${ORIGIN}/d`]: { status: 301, headers: { Location: "/a" } }
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

function notificationsConfig(
  events: Partial<NotificationsConfig["events"]> = {}
): NotificationsConfig {
  return {
    providers: {
      slack: { enabled: false },
      telegram: { enabled: false },
      email: { enabled: false, smtp: {}, to: [] },
      webhook: { enabled: false }
    },
    events: {
      onCrawlFailure: true,
      onContentChange: true,
      onSslExpiring: true,
      onCrawlComplete: true,
      onMojibakeDetected: false,
      onLlmGarbageDetected: false,
      onCrawlProgress: false,
      onMonitorDown: true,
      onMonitorRecovery: true,
      onMonitorSlow: false,
      ...events
    }
  }
}

function appConfig(over: Partial<CrawlConfig> = {}): Config {
  return {
    sitemaps: [{ url: SITEMAP_URL, enabled: true }],
    crawl: crawlConfig(over),
    checks: {
      ssl: { enabled: true, warnDays: 30 },
      contentDiff: true,
      responseTime: { warnMs: 3000 }
    },
    notifications: notificationsConfig()
  }
}

interface NotifyCall {
  event: NotificationEvent
  payload: NotificationPayload
}

function stubNotifier(
  enabledEvents: Partial<Record<NotificationEvent, boolean>> = {}
): { notifier: Notifier; calls: NotifyCall[] } {
  const calls: NotifyCall[] = []
  const notifier = {
    notify: async (
      event: NotificationEvent,
      payload: NotificationPayload
    ) => {
      calls.push({ event, payload })
    },
    isEventEnabled: (event: NotificationEvent) => enabledEvents[event] ?? false
  } as unknown as Notifier
  return { notifier, calls }
}

const tempDirs: string[] = []

function makeStorage(): Storage {
  const dir = mkdtempSync(join(tmpdir(), "supacrawl-test-"))
  tempDirs.push(dir)
  return new Storage({ path: join(dir, "test.db") })
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe("runCrawlWithPersistence", () => {
  it("creates a running crawl record and completes it with correct counters", async () => {
    const storage = makeStorage()
    const site = createFakeSite(SITE_URLS, siteRoutes())
    let observedRunningStatus: CrawlStatus | null = null

    const { crawlId, record } = await runCrawlWithPersistence({
      crawlId: "orch-1",
      config: appConfig(),
      storage,
      notifier: stubNotifier().notifier,
      sitemaps: [SITEMAP_URL],
      fetchImpl: site.fetchImpl,
      onProgress: (p: CrawlProgress) => {
        if (observedRunningStatus === null && p.checked > 0) {
          // The crawl row must exist and be marked running mid-flight.
          observedRunningStatus = storage.getCrawl("orch-1")?.status ?? null
        }
      }
    })

    expect(crawlId).toBe("orch-1")
    expect(observedRunningStatus).toBe("running")
    expect(record.status).toBe("completed")
    expect(record.urlsTotal).toBe(4)
    expect(record.urlsChecked).toBe(4)
    expect(record.urlsBroken).toBe(1)
    expect(record.urlsChanged).toBe(0)
    expect(record.urlsSkipped).toBe(0)

    const persisted = storage.getCrawl("orch-1")
    expect(persisted?.status).toBe("completed")
    expect(persisted?.finishedAt).toBeTruthy()
    expect(persisted?.errorMessage).toBeNull()
  })

  it("persists one result per URL plus url state retrievable via getters", async () => {
    const storage = makeStorage()
    const site = createFakeSite(SITE_URLS, siteRoutes())

    await runCrawlWithPersistence({
      config: appConfig(),
      storage,
      notifier: stubNotifier().notifier,
      sitemaps: [SITEMAP_URL],
      fetchImpl: site.fetchImpl,
      crawlId: "orch-2"
    })

    const results = storage.listResults("orch-2")
    expect(results).toHaveLength(4)
    const byUrl = new Map(results.map((r) => [r.url, r]))

    const okRow = byUrl.get(`${ORIGIN}/a`)
    expect(okRow?.statusCode).toBe(200)
    expect(okRow?.contentHash).toBeTruthy()

    const notFoundRow = byUrl.get(`${ORIGIN}/c`)
    expect(notFoundRow?.statusCode).toBe(404)

    // Redirect chain was serialized into the persisted row.
    const redirectedRow = byUrl.get(`${ORIGIN}/d`)
    expect(JSON.parse(redirectedRow!.redirectChain!)).toEqual([
      `${ORIGIN}/d`
    ])
    expect(redirectedRow?.finalUrl).toBe(`${ORIGIN}/a`)

    const cState = storage.getUrlState(`${ORIGIN}/c`)
    expect(cState?.lastStatusCode).toBe(404)
    expect(cState?.consecutiveFailures).toBe(1)
    const aState = storage.getUrlState(`${ORIGIN}/a`)
    expect(aState?.lastContentHash).toBeTruthy()
    expect(aState?.consecutiveFailures).toBe(0)
  })

  it("notifies onCrawlFailure when broken URLs are found", async () => {
    const storage = makeStorage()
    const site = createFakeSite(SITE_URLS, siteRoutes())
    const { notifier, calls } = stubNotifier({ onCrawlFailure: true })

    await runCrawlWithPersistence({
      crawlId: "orch-3",
      config: appConfig(),
      storage,
      notifier,
      sitemaps: [SITEMAP_URL],
      fetchImpl: site.fetchImpl,
      jobName: "nightly",
      baseUrl: "http://app.test/"
    })

    const failureEvents = calls.filter((c) => c.event === "onCrawlFailure")
    expect(failureEvents).toHaveLength(1)
    const failureEvent = failureEvents[0]!
    expect(failureEvent.payload.title).toContain("broken URL")
    expect(failureEvent.payload.crawlId).toBe("orch-3")
    expect(failureEvent.payload.crawlName).toBe("nightly")
    expect(failureEvent.payload.crawlUrl).toBe(
      "http://app.test/crawls/orch-3"
    )
    expect(failureEvent.payload.meta).toMatchObject({ broken: 1 })
  })

  it("notifies onCrawlComplete with health score when the event is enabled", async () => {
    const storage = makeStorage()
    const site = createFakeSite(SITE_URLS, siteRoutes())
    const { notifier, calls } = stubNotifier({ onCrawlComplete: true })

    const { crawlId } = await runCrawlWithPersistence({
      crawlId: "orch-4",
      config: appConfig(),
      storage,
      notifier,
      sitemaps: [SITEMAP_URL],
      fetchImpl: site.fetchImpl
    })

    const completeEvents = calls.filter((c) => c.event === "onCrawlComplete")
    expect(completeEvents).toHaveLength(1)
    const completeEvent = completeEvents[0]!
    // 3 of 4 URLs healthy -> 75% health score.
    expect(completeEvent.payload.meta).toMatchObject({
      healthScore: 75,
      broken: 1,
      changed: 0
    })
    expect(completeEvent.payload.message).toContain("4")
    expect(completeEvent.payload.htmlBody).toContain(crawlId)
  })

  it("sends no notifications when every event is disabled", async () => {
    const storage = makeStorage()
    const site = createFakeSite(SITE_URLS, siteRoutes())
    const allOff = Object.fromEntries(
      [
        "onCrawlFailure",
        "onContentChange",
        "onSslExpiring",
        "onCrawlComplete",
        "onMojibakeDetected",
        "onLlmGarbageDetected"
      ].map((e) => [e, false])
    ) as Partial<Record<NotificationEvent, boolean>>
    const { notifier, calls } = stubNotifier(allOff)

    await runCrawlWithPersistence({
      config: appConfig(),
      storage,
      notifier,
      sitemaps: [SITEMAP_URL],
      fetchImpl: site.fetchImpl,
      crawlId: "orch-5"
    })

    expect(calls).toEqual([])
  })

  it("runs end-to-end against a real Notifier with all providers disabled", async () => {
    const storage = makeStorage()
    const site = createFakeSite(SITE_URLS, siteRoutes())

    const { record } = await runCrawlWithPersistence({
      config: appConfig(),
      storage,
      notifier: new Notifier(notificationsConfig()),
      sitemaps: [SITEMAP_URL],
      fetchImpl: site.fetchImpl,
      crawlId: "orch-6"
    })

    expect(record.status).toBe("completed")
    expect(storage.getCrawl("orch-6")?.urlsChecked).toBe(4)
  })

  it("detects content changes and accumulates consecutive failures across crawls", async () => {
    const storage = makeStorage()
    const site = createFakeSite(SITE_URLS, siteRoutes())

    await runCrawlWithPersistence({
      config: appConfig(),
      storage,
      notifier: stubNotifier().notifier,
      sitemaps: [SITEMAP_URL],
      fetchImpl: site.fetchImpl,
      crawlId: "orch-7a"
    })

    // Page B mutates between crawls; /c stays broken.
    site.setRoute(`${ORIGIN}/b`, {
      status: 200,
      body: page("Page B — revised")
    })

    const onResults: CheckResult[] = []
    await runCrawlWithPersistence({
      config: appConfig(),
      storage,
      notifier: stubNotifier().notifier,
      sitemaps: [SITEMAP_URL],
      fetchImpl: site.fetchImpl,
      crawlId: "orch-7b",
      onResult: (r) => onResults.push(r)
    })

    const bResult = onResults.find((r) => r.url === `${ORIGIN}/b`)!
    expect(bResult.contentChanged).toBe(true)
    expect(storage.getUrlState(`${ORIGIN}/c`)?.consecutiveFailures).toBe(2)

    // Second crawl's rows keep the previous extract for diffing.
    const secondRunRows = storage.listResults("orch-7b")
    const aRow = secondRunRows.find((r) => r.url === `${ORIGIN}/a`)
    expect(aRow?.prevText).toBeTruthy()
  })

  it("marks the crawl failed when a progress callback throws", async () => {
    const storage = makeStorage()
    const site = createFakeSite(SITE_URLS, siteRoutes())
    let thrown = false

    await expect(
      runCrawlWithPersistence({
        config: appConfig({ maxConcurrency: 1, maxGlobalConcurrency: 1 }),
        storage,
        notifier: stubNotifier().notifier,
        sitemaps: [SITEMAP_URL],
        fetchImpl: site.fetchImpl,
        crawlId: "orch-8",
        onProgress: (p: CrawlProgress) => {
          if (!thrown && p.checked > 0) {
            thrown = true
            throw new Error("progress boom")
          }
        }
      })
    ).rejects.toThrow("progress boom")

    const record = storage.getCrawl("orch-8")
    expect(record?.status).toBe("failed")
    expect(record?.errorMessage).toBe("progress boom")
    expect(record?.finishedAt).toBeTruthy()
  })

  it("marks the crawl failed when every request fails (zero URLs fetched, errors recorded)", async () => {
    const storage = makeStorage()
    const alwaysThrows = (async () => {
      throw new Error("network down")
    }) as typeof fetch

    const { record } = await runCrawlWithPersistence({
      config: appConfig(),
      storage,
      notifier: stubNotifier().notifier,
      sitemaps: [SITEMAP_URL],
      fetchImpl: alwaysThrows,
      crawlId: "orch-9"
    })

    // runCrawl swallows sitemap/robots fetch failures into its errors array;
    // the orchestrator treats a nothing-fetched crawl as failed.
    expect(record.status).toBe("failed")
    expect(record.finishedAt).toBeTruthy()
    expect(record.urlsTotal).toBe(0)
    expect(record.urlsChecked).toBe(0)
    expect(storage.listResults("orch-9")).toHaveLength(0)
    const persisted = storage.getCrawl("orch-9")
    expect(persisted?.errorMessage).toContain("network down")
  })

  it("keeps status completed for a legitimately empty sitemap (zero URLs, zero errors)", async () => {
    const storage = makeStorage()
    const emptyUrlset =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`
    const site = createFakeSite([], {
      [SITEMAP_URL]: { status: 200, body: emptyUrlset }
    })

    const { record } = await runCrawlWithPersistence({
      config: appConfig(),
      storage,
      notifier: stubNotifier().notifier,
      sitemaps: [SITEMAP_URL],
      fetchImpl: site.fetchImpl,
      crawlId: "orch-10"
    })

    expect(record.status).toBe("completed")
    expect(record.urlsTotal).toBe(0)
    expect(record.errorMessage).toBeNull()
    expect(storage.getCrawl("orch-10")?.status).toBe("completed")
  })
})
