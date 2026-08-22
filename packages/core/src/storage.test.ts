import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import BetterSqlite3 from "better-sqlite3"
import { Storage } from "./storage.js"
import type {
  CrawlJob,
  CrawlRecord,
  CrawlResultRecord,
  Heartbeat,
  MaintenanceWindowRecord,
  MonitorRecord,
  SeoInfo,
  StatusPageRecord,
  UrlStateRecord
} from "./types.js"

let dir: string
let storage: Storage

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "supacrawl-test-"))
  storage = new Storage({ path: join(dir, "test.db") })
})

afterEach(() => {
  storage.close()
  rmSync(dir, { recursive: true, force: true })
})

function nowIso(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString()
}

const BASE = Date.parse("2026-08-01T00:00:00.000Z")
function iso(minutes: number): string {
  return new Date(BASE + minutes * 60_000).toISOString()
}
function uid(): string {
  return randomUUID()
}

function makeCrawl(overrides: Partial<CrawlRecord> = {}): CrawlRecord {
  return {
    id: uid(),
    jobId: null,
    startedAt: iso(0),
    finishedAt: null,
    status: "running",
    urlsTotal: 0,
    urlsChecked: 0,
    urlsChanged: 0,
    urlsBroken: 0,
    urlsSkipped: 0,
    errorMessage: null,
    ...overrides
  }
}

function makeResult(crawlId: string, overrides: Partial<CrawlResultRecord> = {}): CrawlResultRecord {
  return {
    id: uid(),
    crawlId,
    url: "https://example.com/",
    statusCode: 200,
    responseTimeMs: 100,
    contentHash: "hash-1",
    contentChanged: false,
    error: null,
    redirectChain: null,
    finalUrl: null,
    sslValidUntil: null,
    sitemapLastmod: null,
    checkedAt: iso(0),
    checkMethod: "GET",
    mojibakeScore: null,
    mojibakeFlagged: false,
    mojibakeSample: null,
    llmGarbageScore: null,
    llmGarbageFlagged: false,
    llmGarbageSample: null,
    seo: null,
    textExtract: null,
    prevText: null,
    ...overrides
  }
}

function makeJob(overrides: Partial<CrawlJob> = {}): CrawlJob {
  return {
    id: uid(),
    name: "weekly crawl",
    sitemapUrl: "https://example.com/sitemap.xml",
    sitemapUrls: null,
    enabled: true,
    intervalValue: 60,
    intervalUnit: "minutes",
    runAt: null,
    notifyOnComplete: false,
    notifyOnFailure: true,
    notifyOnChange: false,
    notifyOnMojibake: false,
    notifyOnLlmGarbage: false,
    notifySslExpiring: true,
    notifyOnProgress: false,
    detectMojibake: true,
    detectLlmGarbage: true,
    delayMs: 200,
    maxConcurrency: 2,
    timeoutMs: 30000,
    userAgent: "supacrawl/0.1",
    respectRobotsTxt: true,
    maxUrls: 1000,
    maxBodyBytes: 5 * 1024 * 1024,
    notificationProviders: null,
    createdAt: iso(0),
    updatedAt: iso(0),
    lastRunAt: null,
    lastRunStatus: null,
    ...overrides
  }
}

function makeMonitor(overrides: Partial<MonitorRecord> = {}): MonitorRecord {
  return {
    id: uid(),
    name: "example",
    type: "http",
    url: "https://example.com/",
    group: "",
    method: "GET",
    expectedStatus: 200,
    expectedBody: null,
    intervalSeconds: 60,
    retryCount: 3,
    timeoutMs: 10000,
    acceptedResponseTimeMs: 5000,
    enabled: true,
    source: "manual",
    jobId: null,
    createdAt: iso(0),
    updatedAt: iso(0),
    ...overrides
  }
}

function makeHeartbeat(monitorId: string, overrides: Partial<Heartbeat> = {}): Heartbeat {
  return {
    id: uid(),
    monitorId,
    status: "up",
    responseTimeMs: 100,
    message: null,
    checkedAt: iso(0),
    ...overrides
  }
}

function makeStatusPage(overrides: Partial<StatusPageRecord> = {}): StatusPageRecord {
  return {
    id: uid(),
    slug: "status",
    title: "Service Status",
    description: null,
    showResponseTimes: true,
    public: true,
    createdAt: iso(0),
    ...overrides
  }
}

function makeMaintenanceWindow(monitorId: string, overrides: Partial<MaintenanceWindowRecord> = {}): MaintenanceWindowRecord {
  return {
    id: uid(),
    monitorId,
    title: "Deploy window",
    description: null,
    startAt: iso(0),
    endAt: iso(60),
    createdAt: iso(0),
    ...overrides
  }
}

/** The user/account/session tables are owned by the server auth layer; create them on the same DB file. */
function createAuthTablesAndUser(userId: string, email: string | null): void {
  const db = new BetterSqlite3(storage.dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS user (
      id TEXT PRIMARY KEY, name TEXT, email TEXT, emailVerified INTEGER DEFAULT 0,
      image TEXT, createdAt TEXT, updatedAt TEXT, role TEXT DEFAULT 'user',
      banned INTEGER DEFAULT 0, banReason TEXT, banExpires TEXT
    );
    CREATE TABLE IF NOT EXISTS account (
      id TEXT PRIMARY KEY, accountId TEXT, providerId TEXT, userId TEXT NOT NULL,
      accessToken TEXT, refreshToken TEXT, idToken TEXT, accessTokenExpiresAt TEXT,
      refreshTokenExpiresAt TEXT, scope TEXT, password TEXT, createdAt TEXT, updatedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY, expiresAt TEXT NOT NULL, token TEXT NOT NULL,
      createdAt TEXT, updatedAt TEXT, ipAddress TEXT, userAgent TEXT,
      userId TEXT NOT NULL, impersonatedBy TEXT
    );
  `)
  db.prepare(`INSERT INTO user (id, email) VALUES (?, ?)`).run(userId, email)
  db.close()
}

describe("schema init and persistence", () => {
  it("persists data across close/re-open without migration errors", () => {
    const job = makeJob()
    storage.createCrawlJob(job)
    storage.setSetting("k", "v1")
    storage.close()

    const reopened = new Storage({ path: join(dir, "test.db") })
    try {
      expect(reopened.getCrawlJob(job.id)?.name).toBe("weekly crawl")
      expect(reopened.getSetting("k")).toBe("v1")
    } finally {
      reopened.close()
    }
  })
})

describe("settings KV", () => {
  it("returns null for missing keys and overwrites existing ones", () => {
    expect(storage.getSetting("nope")).toBeNull()
    storage.setSetting("theme", "dark")
    storage.setSetting("theme", "light")
    expect(storage.getSetting("theme")).toBe("light")
  })
})
describe("crawls", () => {
  it("create/get round-trips all fields", () => {
    const job = makeJob()
    storage.createCrawlJob(job)
    const crawl = makeCrawl({
      startedAt: iso(10),
      status: "completed",
      urlsTotal: 5,
      urlsChecked: 5,
      urlsChanged: 1,
      urlsBroken: 2,
      urlsSkipped: 0,
      finishedAt: iso(20)
    })
    storage.createCrawl(crawl, job.id)
    storage.updateCrawl(crawl.id, {
      finishedAt: crawl.finishedAt!,
      urlsChecked: crawl.urlsChecked,
      urlsChanged: crawl.urlsChanged,
      urlsBroken: crawl.urlsBroken,
      urlsSkipped: crawl.urlsSkipped
    })
    // createCrawl persists job_id, but getCrawl omits the column from its SELECT.
    expect(storage.getCrawl(crawl.id)).toEqual({ ...crawl, jobId: null })
  })

  it("documents current behavior: getCrawl/listCrawls drop job_id, while getCrawlsForJob preserves it", () => {
    const job = makeJob()
    storage.createCrawlJob(job)
    const crawl = makeCrawl({ startedAt: iso(1) })
    storage.createCrawl(crawl, job.id)
    expect(storage.getCrawl(crawl.id)!.jobId).toBeNull()
    expect(storage.listCrawls()[0]!.jobId).toBeNull()
    expect(storage.getCrawlsForJob(job.id)[0]).toMatchObject({ id: crawl.id, jobId: job.id })
  })

  it("getCrawl returns null for unknown ids", () => {
    expect(storage.getCrawl("missing")).toBeNull()
  })

  it("updateCrawl patches only provided fields", () => {
    const crawl = makeCrawl()
    storage.createCrawl(crawl)
    storage.updateCrawl(crawl.id, {
      status: "failed",
      urlsChecked: 3,
      urlsBroken: 1,
      finishedAt: iso(5),
      errorMessage: "boom"
    })
    const got = storage.getCrawl(crawl.id)!
    expect(got.status).toBe("failed")
    expect(got.urlsChecked).toBe(3)
    expect(got.urlsBroken).toBe(1)
    expect(got.finishedAt).toBe(iso(5))
    expect(got.errorMessage).toBe("boom")
    expect(got.startedAt).toBe(crawl.startedAt)
  })

  it("listCrawls orders newest first and honors limit/offset", () => {
    for (const m of [10, 30, 20]) {
      storage.createCrawl(makeCrawl({ id: uid(), startedAt: iso(m) }))
    }
    const all = storage.listCrawls()
    expect(all.map((c) => c.startedAt)).toEqual([iso(30), iso(20), iso(10)])
    expect(storage.listCrawls(1).map((c) => c.startedAt)).toEqual([iso(30)])
    expect(storage.listCrawls(1, 1).map((c) => c.startedAt)).toEqual([iso(20)])
  })

  it("rejects duplicate crawl ids", () => {
    const crawl = makeCrawl()
    storage.createCrawl(crawl)
    expect(() => storage.createCrawl(makeCrawl({ id: crawl.id }))).toThrow(/UNIQUE/i)
  })

  it("deleteCrawl removes its results too", () => {
    const crawl = makeCrawl()
    storage.createCrawl(crawl)
    const result = makeResult(crawl.id)
    storage.insertResult(result)
    storage.deleteCrawl(crawl.id)
    expect(storage.getCrawl(crawl.id)).toBeNull()
    expect(storage.getResult(result.id)).toBeNull()
    expect(storage.listResults(crawl.id)).toEqual([])
  })
})

describe("results", () => {
  it("getResult round-trips content, flags, seo and text", () => {
    const crawl = makeCrawl()
    storage.createCrawl(crawl)
    const seo = { title: "Hello" } as unknown as SeoInfo
    const result = makeResult(crawl.id, {
      statusCode: 404,
      responseTimeMs: 250,
      contentHash: "h2",
      contentChanged: true,
      error: "not found",
      redirectChain: "https://a -> https://b",
      finalUrl: "https://b/",
      sslValidUntil: "2027-01-01T00:00:00.000Z",
      sitemapLastmod: "2026-02-02",
      checkedAt: iso(15),
      checkMethod: "HEAD",
      mojibakeScore: 0.9,
      mojibakeFlagged: true,
      mojibakeSample: "Ã©Ã¨",
      llmGarbageScore: 0.5,
      llmGarbageFlagged: true,
      llmGarbageSample: "as an AI",
      seo,
      textExtract: "page text",
      prevText: "previous text"
    })
    storage.insertResult(result)
    expect(storage.getResult(result.id)).toEqual(result)
  })

  it("getResult returns null for unknown ids", () => {
    expect(storage.getResult("missing")).toBeNull()
  })

  it("insertResult rejects duplicate result ids", () => {
    const crawl = makeCrawl()
    storage.createCrawl(crawl)
    const result = makeResult(crawl.id)
    storage.insertResult(result)
    expect(() => storage.insertResult(makeResult(crawl.id, { id: result.id }))).toThrow(/UNIQUE/i)
  })

  it("listResults orders by checked_at and applies filters", () => {
    const crawl = makeCrawl()
    storage.createCrawl(crawl)
    const ok = makeResult(crawl.id, { checkedAt: iso(1), url: "https://x/ok" })
    const broken = makeResult(crawl.id, { checkedAt: iso(2), url: "https://x/broken", statusCode: 500, error: "server error" })
    const changed = makeResult(crawl.id, { checkedAt: iso(3), url: "https://x/changed", contentChanged: true })
    const garbled = makeResult(crawl.id, { checkedAt: iso(4), url: "https://x/garbled", mojibakeFlagged: true, mojibakeScore: 0.8 })
    const garbage = makeResult(crawl.id, { checkedAt: iso(5), url: "https://x/garbage", llmGarbageFlagged: true })
    for (const r of [garbled, ok, garbage, changed, broken]) storage.insertResult(r)

    expect(storage.listResults(crawl.id).map((r) => r.url)).toEqual([
      "https://x/ok", "https://x/broken", "https://x/changed", "https://x/garbled", "https://x/garbage"
    ])
    expect(storage.listResults(crawl.id, { brokenOnly: true }).map((r) => r.url)).toEqual(["https://x/broken"])
    expect(storage.listResults(crawl.id, { changedOnly: true }).map((r) => r.url)).toEqual(["https://x/changed"])
    expect(storage.listResults(crawl.id, { mojibakeOnly: true }).map((r) => r.url)).toEqual(["https://x/garbled"])
    expect(storage.listResults(crawl.id, { llmGarbageOnly: true }).map((r) => r.url)).toEqual(["https://x/garbage"])
  })

  it("listResults excludes seo when includeSeo is false", () => {
    const crawl = makeCrawl()
    storage.createCrawl(crawl)
    storage.insertResult(makeResult(crawl.id, { seo: { title: "T" } as unknown as SeoInfo }))
    const rows = storage.listResults(crawl.id, undefined, { includeSeo: false })
    expect(rows[0]!.seo).toBeNull()
    expect(storage.listResults(crawl.id)[0]!.seo).toEqual({ title: "T" })
  })

  it("enforces the crawl_results → crawls foreign key", () => {
    expect(() => storage.insertResult(makeResult("no-such-crawl"))).toThrow(/FOREIGN KEY/i)
  })
})

describe("url state", () => {
  it("upsert inserts then updates on conflict", () => {
    const url = "https://example.com/a"
    expect(storage.getUrlState(url)).toBeNull()
    storage.upsertUrlState({
      url,
      lastStatusCode: 200,
      lastContentHash: "h1",
      lastResponseTimeMs: 50,
      sitemapLastmod: null,
      lastCheckedAt: iso(1),
      consecutiveFailures: 0,
      hasSeo: true,
      prevText: "old"
    })
    expect(storage.getUrlState(url)).toEqual({
      url,
      lastStatusCode: 200,
      lastContentHash: "h1",
      lastResponseTimeMs: 50,
      sitemapLastmod: null,
      lastCheckedAt: iso(1),
      consecutiveFailures: 0,
      hasSeo: true,
      prevText: "old"
    })
    storage.upsertUrlState({
      url,
      lastStatusCode: 500,
      lastContentHash: "h2",
      lastResponseTimeMs: 900,
      sitemapLastmod: "2026-03-03",
      lastCheckedAt: iso(2),
      consecutiveFailures: 2,
      hasSeo: false,
      prevText: null
    })
    const updated = storage.getUrlState(url)!
    expect(updated.lastStatusCode).toBe(500)
    expect(updated.consecutiveFailures).toBe(2)
    expect(updated.hasSeo).toBe(false)
    expect(storage.getAllUrlStates()).toHaveLength(1)
  })

  it("getUrlState returns null for unknown urls and listUrls sorts by recency", () => {
    storage.upsertUrlState(state("https://b/", iso(1)))
    storage.upsertUrlState(state("https://a/", iso(9)))
    expect(storage.getUrlState("https://missing/")).toBeNull()
    expect(storage.listUrls().map((s) => s.url)).toEqual(["https://a/", "https://b/"])
  })
})

function state(url: string, at: string): UrlStateRecord {
  return {
    url,
    lastStatusCode: 200,
    lastContentHash: null,
    lastResponseTimeMs: null,
    sitemapLastmod: null,
    lastCheckedAt: at,
    consecutiveFailures: 0,
    hasSeo: false,
    prevText: null
  }
}

describe("url history", () => {
  it("returns results for a url newest-first honoring limit", () => {
    const c1 = makeCrawl()
    const c2 = makeCrawl()
    storage.createCrawl(c1)
    storage.createCrawl(c2)
    storage.insertResult(makeResult(c1.id, { id: uid(), url: "https://x/page", checkedAt: iso(1), statusCode: 200 }))
    storage.insertResult(makeResult(c2.id, { id: uid(), url: "https://x/page", checkedAt: iso(2), statusCode: 500 }))
    storage.insertResult(makeResult(c2.id, { id: uid(), url: "https://x/other", checkedAt: iso(3) }))
    const history = storage.getUrlHistory("https://x/page")
    expect(history.map((r) => r.statusCode)).toEqual([500, 200])
    expect(storage.getUrlHistory("https://x/page", 1)).toHaveLength(1)
    expect(storage.getUrlHistory("https://never-checked")).toEqual([])
  })
})

describe("crawl jobs", () => {
  it("create/get/list round-trips job fields including arrays", () => {
    const job = makeJob({
      sitemapUrls: ["https://a/sitemap.xml", "https://b/sitemap.xml"],
      notificationProviders: { slack: { enabled: true, webhookUrl: "https://hooks/x" } },
      runAt: iso(5)
    })
    storage.createCrawlJob(job)
    storage.updateCrawlJob(job.id, { lastRunAt: iso(6), lastRunStatus: "completed" })
    expect(storage.getCrawlJob(job.id)).toEqual({ ...job, lastRunAt: iso(6), lastRunStatus: "completed" })
    expect(storage.listCrawlJobs()).toEqual([{ ...job, lastRunAt: iso(6), lastRunStatus: "completed" }])
  })

  it("documents current behavior: createCrawlJob silently drops maxBodyBytes in favor of the column default", () => {
    const job = makeJob({ maxBodyBytes: 1024 })
    storage.createCrawlJob(job)
    expect(storage.getCrawlJob(job.id)!.maxBodyBytes).toBe(5 * 1024 * 1024)
  })

  it("getCrawlJob returns null for unknown ids", () => {
    expect(storage.getCrawlJob("missing")).toBeNull()
  })

  it("updateCrawlJob patches scalars, booleans and arrays", () => {
    const job = makeJob()
    storage.createCrawlJob(job)
    storage.updateCrawlJob(job.id, {
      name: "renamed",
      enabled: false,
      intervalValue: 15,
      sitemapUrls: ["https://new/sitemap.xml"],
      lastRunAt: iso(9),
      lastRunStatus: "failed"
    })
    const got = storage.getCrawlJob(job.id)!
    expect(got.name).toBe("renamed")
    expect(got.enabled).toBe(false)
    expect(got.intervalValue).toBe(15)
    expect(got.sitemapUrls).toEqual(["https://new/sitemap.xml"])
    expect(got.lastRunStatus).toBe("failed")
    expect(got.userAgent).toBe(job.userAgent)
  })

  it("deleteCrawlJob removes the job and its crawls", () => {
    const job = makeJob()
    storage.createCrawlJob(job)
    const other = makeCrawl()
    storage.createCrawl(other)
    storage.createCrawl(makeCrawl(), job.id)
    storage.deleteCrawlJob(job.id)
    expect(storage.getCrawlJob(job.id)).toBeNull()
    expect(storage.getCrawlsForJob(job.id)).toEqual([])
    expect(storage.getCrawl(other.id)).not.toBeNull()
  })

  it("getCrawlsForJob filters, orders desc and limits", () => {
    const job = makeJob()
    storage.createCrawlJob(job)
    for (const m of [10, 30, 20]) {
      storage.createCrawl(makeCrawl({ startedAt: iso(m) }), job.id)
    }
    storage.createCrawl(makeCrawl({ startedAt: iso(40) }))
    expect(storage.getCrawlsForJob(job.id).map((c) => c.startedAt)).toEqual([iso(30), iso(20), iso(10)])
    expect(storage.getCrawlsForJob(job.id, 1)).toHaveLength(1)
  })

  it("importCrawlJobs assigns fresh ids and returns the count; export lists them", () => {
    const original = makeJob()
    const importedCount = storage.importCrawlJobs([original, makeJob({ name: "second" })])
    expect(importedCount).toBe(2)
    const jobs = storage.exportCrawlJobs()
    expect(jobs).toHaveLength(2)
    expect(jobs.map((j) => j.id).sort()).not.toContain(original.id)
    expect(jobs.map((j) => j.name).sort()).toEqual(["second", "weekly crawl"])
    // import is a plain insert: re-importing the same jobs duplicates them under new ids
    expect(storage.importCrawlJobs([original])).toBe(1)
    expect(storage.listCrawlJobs()).toHaveLength(3)
  })
})

describe("monitors", () => {
  it("create/get round-trips monitor fields including group", () => {
    const job = makeJob()
    storage.createCrawlJob(job)
    const monitor = makeMonitor({ group: "prod", expectedBody: "ok", jobId: job.id })
    storage.createMonitor(monitor)
    expect(storage.getMonitor(monitor.id)).toEqual(monitor)
  })

  it("getMonitor returns null for unknown ids", () => {
    expect(storage.getMonitor("missing")).toBeNull()
  })

  it("updateMonitor patches fields, including the quoted group column", () => {
    const monitor = makeMonitor()
    storage.createMonitor(monitor)
    storage.updateMonitor(monitor.id, { name: "renamed", group: "staging", enabled: false, intervalSeconds: 120 })
    const got = storage.getMonitor(monitor.id)!
    expect(got.name).toBe("renamed")
    expect(got.group).toBe("staging")
    expect(got.enabled).toBe(false)
    expect(got.intervalSeconds).toBe(120)
  })

  it("updateMonitors returns change count and no-ops on empty input", () => {
    const m1 = makeMonitor()
    const m2 = makeMonitor()
    storage.createMonitor(m1)
    storage.createMonitor(m2)
    expect(storage.updateMonitors([], { enabled: false })).toBe(0)
    expect(storage.updateMonitors([m1.id, m2.id], { enabled: false })).toBe(2)
    expect(storage.getMonitor(m1.id)!.enabled).toBe(false)
    expect(storage.getMonitor(m2.id)!.enabled).toBe(false)
  })

  it("deleteMonitor and deleteMonitors remove rows and report counts", () => {
    const m1 = makeMonitor()
    const m2 = makeMonitor()
    const m3 = makeMonitor()
    for (const m of [m1, m2, m3]) storage.createMonitor(m)
    expect(storage.deleteMonitors([])).toBe(0)
    expect(storage.deleteMonitors([m1.id, m2.id])).toBe(2)
    expect(storage.getMonitor(m1.id)).toBeNull()
    expect(storage.deleteMonitor(m3.id))
    expect(storage.getMonitor(m3.id)).toBeNull()
  })

  it("listEnabledMonitors filters disabled monitors", () => {
    storage.createMonitor(makeMonitor({ enabled: true }))
    storage.createMonitor(makeMonitor({ enabled: false }))
    expect(storage.listEnabledMonitors()).toHaveLength(1)
  })

  it("listMonitorsForJob filters by jobId", () => {
    const job = makeJob()
    storage.createCrawlJob(job)
    storage.createMonitor(makeMonitor({ jobId: job.id }))
    storage.createMonitor(makeMonitor({ jobId: null }))
    expect(storage.listMonitorsForJob(job.id)).toHaveLength(1)
    expect(storage.listMonitorsForJob("job-other")).toEqual([])
  })

  it("upsertMonitorByUrl creates with derived defaults then updates in place", () => {
    const created = storage.upsertMonitorByUrl("https://example.com/health", {})
    expect(created).not.toBeNull()
    expect(created!.name).toBe("example.com/health")
    expect(created!.method).toBe("GET")
    expect(created!.intervalSeconds).toBe(60)
    expect(created!.source).toBe("manual")

    const updated = storage.upsertMonitorByUrl("https://example.com/health", {
      name: "healthcheck",
      enabled: false
    })
    expect(updated!.id).toBe(created!.id)
    expect(updated!.name).toBe("healthcheck")
    expect(updated!.enabled).toBe(false)
    expect(storage.listMonitors()).toHaveLength(1)
  })

  it("listMonitors enriches with heartbeat-derived status and uptime", () => {
    const monitor = makeMonitor()
    storage.createMonitor(monitor)
    expect(storage.listMonitors()[0]!.currentStatus).toBeNull()
    const t1 = nowIso(20)
    const t2 = nowIso(10)
    storage.insertHeartbeat(makeHeartbeat(monitor.id, { checkedAt: t1, status: "up", responseTimeMs: 100 }))
    storage.insertHeartbeat(makeHeartbeat(monitor.id, { checkedAt: t2, status: "down", responseTimeMs: null }))
    const enriched = storage.listMonitors()[0]!
    expect(enriched.latestHeartbeat?.status).toBe("down")
    expect(enriched.recentHeartbeats.map((h) => h.checkedAt)).toEqual([t1, t2])
    expect(enriched.uptime24h).toBeCloseTo(50, 5)
    expect(enriched.uptime7d).toBeCloseTo(50, 5)
  })

  it("listMonitorDomains counts per hostname sorted alphabetically", () => {
    storage.createMonitor(makeMonitor({ url: "https://b.com/" }))
    storage.createMonitor(makeMonitor({ url: "https://a.com/1" }))
    storage.createMonitor(makeMonitor({ url: "https://a.com/2" }))
    expect(storage.listMonitorDomains()).toEqual([
      { domain: "a.com", count: 2 },
      { domain: "b.com", count: 1 }
    ])
  })

  it("listMonitorsInDomains returns [] for empty input and filters otherwise", () => {
    const keep = makeMonitor({ url: "https://keep.com/" })
    storage.createMonitor(keep)
    storage.createMonitor(makeMonitor({ url: "https://drop.com/" }))
    expect(storage.listMonitorsInDomains([])).toEqual([])
    const filtered = storage.listMonitorsInDomains(["keep.com"])
    expect(filtered).toHaveLength(1)
    expect(filtered[0]!.id).toBe(keep.id)
  })
})

describe("heartbeats", () => {
  it("getLatestHeartbeat returns newest record or null", () => {
    const monitor = makeMonitor()
    storage.createMonitor(monitor)
    expect(storage.getLatestHeartbeat(monitor.id)).toBeNull()
    storage.insertHeartbeat(makeHeartbeat(monitor.id, { checkedAt: iso(1) }))
    const latest = makeHeartbeat(monitor.id, { checkedAt: iso(2), status: "down", message: "timeout" })
    storage.insertHeartbeat(latest)
    expect(storage.getLatestHeartbeat(monitor.id)?.id).toBe(latest.id)
  })

  it("enforces the heartbeats → monitors foreign key", () => {
    expect(() => storage.insertHeartbeat(makeHeartbeat("no-such-monitor"))).toThrow(/FOREIGN KEY/i)
  })

  it("listHeartbeats orders desc with limit; listHeartbeatsSince filters ascending", () => {
    const monitor = makeMonitor()
    storage.createMonitor(monitor)
    for (const m of [1, 3, 2]) {
      storage.insertHeartbeat(makeHeartbeat(monitor.id, { checkedAt: iso(m) }))
    }
    expect(storage.listHeartbeats(monitor.id).map((h) => h.checkedAt)).toEqual([iso(3), iso(2), iso(1)])
    expect(storage.listHeartbeats(monitor.id, 2)).toHaveLength(2)
    expect(storage.listHeartbeatsSince(monitor.id, iso(2)).map((h) => h.checkedAt)).toEqual([iso(2), iso(3)])
  })

  it("pruneHeartbeats deletes older records and returns the count", () => {
    const monitor = makeMonitor()
    storage.createMonitor(monitor)
    storage.insertHeartbeat(makeHeartbeat(monitor.id, { checkedAt: iso(1) }))
    storage.insertHeartbeat(makeHeartbeat(monitor.id, { checkedAt: iso(100) }))
    expect(storage.pruneHeartbeats(iso(50))).toBe(1)
    expect(storage.listHeartbeats(monitor.id)).toHaveLength(1)
    expect(storage.pruneHeartbeats(iso(90))).toBe(0)
  })
})

describe("uptime and monitor stats", () => {
  it("getUptimeForPeriod computes percentage or null without data", () => {
    const monitor = makeMonitor()
    storage.createMonitor(monitor)
    expect(storage.getUptimeForPeriod(monitor.id, iso(-100))).toBeNull()
    storage.insertHeartbeat(makeHeartbeat(monitor.id, { checkedAt: iso(1), status: "up" }))
    storage.insertHeartbeat(makeHeartbeat(monitor.id, { checkedAt: iso(2), status: "up" }))
    storage.insertHeartbeat(makeHeartbeat(monitor.id, { checkedAt: iso(3), status: "up" }))
    storage.insertHeartbeat(makeHeartbeat(monitor.id, { checkedAt: iso(4), status: "down" }))
    expect(storage.getUptimeForPeriod(monitor.id, iso(-100))).toBe(75)
    expect(storage.getUptimeForPeriod(monitor.id, iso(10))).toBeNull() // since excludes all beats
  })

  it("getMonitorStats aggregates response times over 30d", () => {
    const monitor = makeMonitor()
    storage.createMonitor(monitor)
    const stats = storage.getMonitorStats(monitor.id)
    expect(stats).toEqual({
      uptime24h: null, uptime7d: null, uptime30d: null, uptime365d: null,
      avgResponseTimeMs: null, minResponseTimeMs: null, maxResponseTimeMs: null
    })
    storage.insertHeartbeat(makeHeartbeat(monitor.id, { checkedAt: nowIso(30), status: "up", responseTimeMs: 300 }))
    storage.insertHeartbeat(makeHeartbeat(monitor.id, { checkedAt: nowIso(20), status: "up", responseTimeMs: 100 }))
    storage.insertHeartbeat(makeHeartbeat(monitor.id, { checkedAt: nowIso(10), status: "down", responseTimeMs: 201 }))
    const filled = storage.getMonitorStats(monitor.id)
    expect(filled.avgResponseTimeMs).toBe(200)
    expect(filled.minResponseTimeMs).toBe(100)
    expect(filled.maxResponseTimeMs).toBe(300)
    expect(filled.uptime24h).toBeCloseTo(66.7, 5)
    expect(filled.uptime365d).toBeCloseTo(66.7, 5)
  })
})

describe("status pages", () => {
  it("create/get/bySlug/update/delete round-trip", () => {
    const page = makeStatusPage({ description: "desc", showResponseTimes: false, public: false })
    storage.createStatusPage(page)
    expect(storage.getStatusPage(page.id)).toEqual(page)
    expect(storage.getStatusPageBySlug("status")).toEqual(page)
    expect(storage.listStatusPages()).toEqual([page])

    storage.updateStatusPage(page.id, { title: "New title", public: true })
    const updated = storage.getStatusPage(page.id)!
    expect(updated.title).toBe("New title")
    expect(updated.public).toBe(true)
    expect(updated.showResponseTimes).toBe(false)

    storage.deleteStatusPage(page.id)
    expect(storage.getStatusPage(page.id)).toBeNull()
    expect(storage.getStatusPageBySlug("status")).toBeNull()
  })

  it("slug lookups return null for unknown slugs and slugs are unique", () => {
    expect(storage.getStatusPageBySlug("ghost")).toBeNull()
    storage.createStatusPage(makeStatusPage())
    expect(() => storage.createStatusPage(makeStatusPage({ slug: "status" }))).toThrow(/UNIQUE/i)
  })

  it("setStatusPageMonitors replaces the link set; getStatusPageMonitors preserves order and groups", () => {
    const page = makeStatusPage()
    storage.createStatusPage(page)
    const m1 = makeMonitor({ createdAt: iso(1) })
    const m2 = makeMonitor({ createdAt: iso(2) })
    storage.createMonitor(m1)
    storage.createMonitor(m2)
    storage.setStatusPageMonitors(page.id, [
      { monitorId: m2.id, groupName: "api" },
      { monitorId: m1.id }
    ])
    let linked = storage.getStatusPageMonitors(page.id)
    expect(linked.map((m) => m.id)).toEqual([m2.id, m1.id])
    expect(linked[0]!.groupName).toBe("api")
    expect(linked[1]!.groupName).toBe("")
    expect(linked[0]!.currentStatus).toBeNull()
    storage.setStatusPageMonitors(page.id, [{ monitorId: m1.id }])
    linked = storage.getStatusPageMonitors(page.id)
    expect(linked).toHaveLength(1)
    expect(linked[0]!.id).toBe(m1.id)
  })
})

describe("maintenance windows", () => {
  it("creates, lists per monitor and globally with monitor names", () => {
    const monitor = makeMonitor({ name: "api-monitor" })
    storage.createMonitor(monitor)
    const w1 = makeMaintenanceWindow(monitor.id, { startAt: iso(10) })
    const w2 = makeMaintenanceWindow(monitor.id, { startAt: iso(20) })
    storage.createMaintenanceWindow(w1)
    storage.createMaintenanceWindow(w2)

    expect(storage.listMaintenanceWindowsForMonitor(monitor.id).map((w) => w.id)).toEqual([w2.id, w1.id])
    const all = storage.listMaintenanceWindows()
    expect(all.map((w) => w.monitorName)).toEqual(["api-monitor", "api-monitor"])

    storage.deleteMaintenanceWindow(w1.id)
    expect(storage.listMaintenanceWindowsForMonitor(monitor.id)).toHaveLength(1)
  })

  it("hasActiveMaintenanceWindow detects overlap at a point in time", () => {
    const monitor = makeMonitor()
    storage.createMonitor(monitor)
    storage.createMaintenanceWindow(makeMaintenanceWindow(monitor.id, { startAt: iso(10), endAt: iso(20) }))
    expect(storage.hasActiveMaintenanceWindow(monitor.id, iso(15))).toBe(true)
    expect(storage.hasActiveMaintenanceWindow(monitor.id, iso(25))).toBe(false)
    expect(storage.hasActiveMaintenanceWindow("other-monitor", iso(15))).toBe(false)
  })
})

describe("monitor export/import", () => {
  it("exports monitors plus heartbeats and merges duplicates on re-import", () => {
    let backup: { monitors: MonitorRecord[]; heartbeats: Heartbeat[] }
    const monitor = makeMonitor()
    const source = new Storage({ path: join(dir, "source.db") })
    try {
      source.createMonitor(monitor)
      source.insertHeartbeat(makeHeartbeat(monitor.id, { id: "hb-1", checkedAt: iso(1) }))
      source.insertHeartbeat(makeHeartbeat(monitor.id, { id: "hb-2", checkedAt: iso(2) }))
      backup = source.exportMonitors()
    } finally {
      source.close()
    }
    expect(backup.monitors).toHaveLength(1)
    expect(backup.heartbeats).toHaveLength(2)

    // Target already hosts a monitor with the same type|url|method key.
    const twin = makeMonitor({ id: "existing-id", url: monitor.url })
    storage.createMonitor(twin)
    storage.insertHeartbeat(makeHeartbeat(twin.id, { id: "hb-existing", checkedAt: iso(0) }))

    const dangling = makeHeartbeat("unknown-monitor", { id: "hb-dangling", checkedAt: iso(3) })
    const res = storage.importMonitors(backup.monitors, [...backup.heartbeats, dangling])
    expect(res).toEqual({ imported: 0, skippedDuplicates: 1, mergedIntoExisting: 1, heartbeatsAdded: 2 })
    expect(storage.listMonitors()).toHaveLength(1)
    expect(storage.listHeartbeats(twin.id)).toHaveLength(3)
    // Idempotent: re-importing the same payload adds nothing.
    const again = storage.importMonitors(backup.monitors, backup.heartbeats)
    expect(again.imported).toBe(0)
    expect(again.heartbeatsAdded).toBe(0)
    expect(storage.listHeartbeats(twin.id)).toHaveLength(3)
  })
})

describe("maintenance window export/import", () => {
  it("skips windows for unknown monitors and ignores already-imported ids", () => {
    const monitor = makeMonitor()
    storage.createMonitor(monitor)
    const known = makeMaintenanceWindow(monitor.id)
    const unknown = makeMaintenanceWindow("no-such-monitor")

    const first = storage.importMaintenanceWindows([known, unknown])
    expect(first).toEqual({ imported: 1, skippedUnknownMonitor: 1 })
    const second = storage.importMaintenanceWindows([known, unknown])
    expect(second).toEqual({ imported: 0, skippedUnknownMonitor: 1 })
    expect(storage.listMaintenanceWindows()).toHaveLength(1)

    expect(storage.exportMaintenanceWindows().map((w) => w.id)).toEqual([known.id])
  })
})

describe("status page export/import", () => {
  it("updates existing slugs in place and drops links to unknown monitors", () => {
    const page = makeStatusPage()
    const monitor = makeMonitor()
    storage.createStatusPage(page)
    storage.createMonitor(monitor)
    storage.setStatusPageMonitors(page.id, [{ monitorId: monitor.id, groupName: "core" }])

    const exported = storage.exportStatusPages()
    expect(exported).toHaveLength(1)
    expect(exported[0]!.monitors).toEqual([{ monitorId: monitor.id, sortOrder: 0, groupName: "core" }])
    // Fresh DB: same slug but different id/title; one known monitor, one dangling link.
    const target = new Storage({ path: join(dir, "target.db") })
    try {
      const localMonitor = makeMonitor({ id: "local-mon", url: "https://target.example/" })
      target.createMonitor(localMonitor)
      const payload = [{
        ...makeStatusPage({ id: "different-id", title: "Renamed status" }),
        monitors: [
          { monitorId: "local-mon", sortOrder: 2, groupName: "b" },
          { monitorId: "ghost-mon", sortOrder: 1, groupName: "a" }
        ]
      }]
      const res = target.importStatusPages(payload)
      expect(res).toEqual({ imported: 1, updated: 0, linked: 1, droppedLinks: 1 })
      let pageInTarget = target.getStatusPageBySlug("status")!
      const pageIdAfterFirstImport = pageInTarget.id

      // Re-importing a page with the same slug updates it in place instead of duplicating.
      const again = target.importStatusPages([{
        ...makeStatusPage({ id: "third-id", title: "Final title" }),
        monitors: [{ monitorId: "local-mon", sortOrder: 0, groupName: "" }]
      }])
      expect(again).toEqual({ imported: 0, updated: 1, linked: 1, droppedLinks: 0 })
      pageInTarget = target.getStatusPageBySlug("status")!
      expect(pageInTarget.id).toBe(pageIdAfterFirstImport)
      expect(pageInTarget.title).toBe("Final title")
      expect(target.listStatusPages()).toHaveLength(1)
      const linked = target.getStatusPageMonitors(pageInTarget.id)
      expect(linked.map((m) => m.id)).toEqual(["local-mon"])
    } finally {
      target.close()
    }
  })
})

describe("backup tables", () => {
  it("lists backupable table names and iterates rows", () => {
    const names = storage.getBackupTableNames()
    for (const t of ["crawl_jobs", "crawls", "crawl_results", "url_state", "settings", "monitors", "heartbeats", "status_pages", "maintenance_windows"]) {
      expect(names).toContain(t)
    }
    expect(names).not.toContain("resource_snapshots")
    storage.setSetting("iter-me", "1")
    const rows = [...storage.iterateBackupTable("settings")]
    expect(rows).toEqual([{ key: "iter-me", value: "1" }])
    expect(() => [...storage.iterateBackupTable("sqlite_schema")]).toThrow(/Unknown backup table/)
  })

  it("restoreFromBackup wipes prior data, restores rows and reports skips", () => {
    createAuthTablesAndUser("u-old", "old@example.com")
    storage.setSetting("wipe-me", "x")
    storage.upsertUrlState({ ...state("https://wipe/", iso(1)) })

    const payload = {
      settings: [{ key: "restored", value: "yes" }],
      user: [{ id: "u-new", email: "new@example.com" }],
      url_state: [{ url: "https://broken-row/" }] // missing required last_checked_at
    }
    const res = storage.restoreFromBackup(payload)
    expect(res.restored.settings).toBe(1)
    expect(res.restored.user).toBe(1)
    expect(res.skippedRows.url_state).toBe(1)
    expect(res.errors.length).toBeGreaterThanOrEqual(1)
    expect(res.errors[0]).toContain("last_checked_at")

    expect(storage.getSetting("wipe-me")).toBeNull()
    expect(storage.getSetting("restored")).toBe("yes")
    expect(storage.getUrlState("https://wipe/")).toBeNull()

    // The user table is wiped and repopulated from the payload.
    expect(storage.getUserEmail("u-old")).toBeNull()
    expect(storage.getUserEmail("u-new")).toBe("new@example.com")
  })
})

describe("stats and aggregation", () => {
  it("getOverviewStats starts zeroed and reflects data afterwards", () => {
    expect(storage.getOverviewStats()).toEqual({
      totalUrls: 0, totalCrawls: 0, lastCrawlAt: null, lastCrawlBroken: 0, lastCrawlChanged: 0, brokenNow: 0
    })
    const crawl = makeCrawl({ startedAt: iso(1) })
    storage.createCrawl(crawl)
    storage.updateCrawl(crawl.id, { status: "completed", urlsBroken: 4, urlsChanged: 2 })
    storage.upsertUrlState({ ...state("https://ok/", iso(2)), lastStatusCode: 200 })
    storage.upsertUrlState({ ...state("https://dead/", iso(3)), lastStatusCode: 503 })
    const stats = storage.getOverviewStats()
    expect(stats.totalUrls).toBe(2)
    expect(stats.totalCrawls).toBe(1)
    expect(stats.lastCrawlAt).toBe(iso(1))
    expect(stats.lastCrawlChanged).toBe(2)
    expect(stats.brokenNow).toBe(1)
  })

  it("getTimeline buckets crawls per day into healthy/broken", () => {
    const healthy = makeCrawl({ startedAt: iso(1) })
    const broken = makeCrawl({ startedAt: iso(2) })
    storage.createCrawl(healthy)
    storage.createCrawl(broken)
    storage.updateCrawl(healthy.id, { urlsBroken: 0 })
    storage.updateCrawl(broken.id, { urlsBroken: 3 })
    const timeline = storage.getTimeline(30)
    expect(timeline).toEqual([{ date: iso(0).slice(0, 10), healthy: 1, broken: 1 }])
  })
  it("getCrawlDurationTrend includes only finished crawls with computed durations", () => {
    const done = makeCrawl({ startedAt: "2026-08-01T10:00:00.000Z" })
    const running = makeCrawl({ startedAt: "2026-08-01T11:00:00.000Z" })
    storage.createCrawl(done)
    storage.createCrawl(running)
    storage.updateCrawl(done.id, { finishedAt: "2026-08-01T10:00:05.000Z" })
    const trend = storage.getCrawlDurationTrend()
    expect(trend).toHaveLength(1)
    expect(trend[0]!.id).toBe(done.id)
    expect(Math.abs(trend[0]!.durationMs - 5000)).toBeLessThan(50)
  })

  it("getStatusDistribution buckets status codes including errors", () => {
    const crawl = makeCrawl()
    storage.createCrawl(crawl)
    const rows = [
      makeResult(crawl.id, { statusCode: 200 }),
      makeResult(crawl.id, { statusCode: 301 }),
      makeResult(crawl.id, { statusCode: 404 }),
      makeResult(crawl.id, { statusCode: 500 }),
      makeResult(crawl.id, { statusCode: null, error: "timeout" })
    ]
    for (const r of rows) storage.insertResult(r)
    const dist = Object.fromEntries(storage.getStatusDistribution(crawl.id).map((d) => [d.status, d.count]))
    expect(dist).toEqual({ "2xx": 1, "3xx": 1, "4xx": 1, "5xx": 1, error: 1 })
    expect(storage.getStatusDistribution("no-such-crawl")).toEqual([])
  })

  it("cleanupStaleCrawls fails running crawls left behind by a restart", () => {
    const running = makeCrawl({ status: "running" })
    const completed = makeCrawl({ status: "completed" })
    storage.createCrawl(running)
    storage.createCrawl(completed)
    storage.cleanupStaleCrawls()
    const failedRow = storage.getCrawl(running.id)!
    expect(failedRow.status).toBe("failed")
    expect(failedRow.errorMessage).toBe("Server was restarted")
    expect(failedRow.finishedAt).not.toBeNull()
    expect(storage.getCrawl(completed.id)!.status).toBe("completed")
  })
})

describe("crawl summary", () => {
  it("returns null for unknown crawls", () => {
    expect(storage.getCrawlSummary("missing")).toBeNull()
  })

  it("aggregates issue categories, health score and response time stats", () => {
    const crawl = makeCrawl({
      status: "completed",
      urlsTotal: 4,
      startedAt: "2026-08-01T10:00:00.000Z"
    })
    storage.createCrawl(crawl)
    storage.updateCrawl(crawl.id, { status: "completed", finishedAt: "2026-08-01T10:01:00.000Z" })
    const sslSoon = new Date(Date.now() + 10 * 86_400_000).toISOString()
    const results = [
      makeResult(crawl.id, { url: "https://x/fine", responseTimeMs: 100, checkedAt: iso(1) }),
      makeResult(crawl.id, { url: "https://x/broken", statusCode: 503, responseTimeMs: 300, checkedAt: iso(2) }),
      makeResult(crawl.id, { url: "https://x/changed", contentChanged: true, responseTimeMs: 200, checkedAt: iso(3) }),
      makeResult(crawl.id, {
        url: "https://x/garbled", mojibakeFlagged: true, mojibakeScore: 0.85,
        sslValidUntil: sslSoon, responseTimeMs: 400, checkedAt: iso(4)
      })
    ]
    for (const r of results) storage.insertResult(r)

    const summary = storage.getCrawlSummary(crawl.id)!
    expect(summary.crawlId).toBe(crawl.id)
    expect(summary.status).toBe("completed")
    expect(summary.durationMs).toBe(60000)
    expect(summary.totalUrls).toBe(4)
    expect(summary.checkedUrls).toBe(4)
    expect(summary.healthScore).toBe(75)
    expect(summary.avgResponseTimeMs).toBe(250)
    expect(summary.slowestResponseTimeMs).toBe(400)
    expect(summary.fastestResponseTimeMs).toBe(100)
    expect(summary.issues.broken.map((i) => i.url)).toEqual(["https://x/broken"])
    expect(summary.issues.broken[0]).toMatchObject({ detail: "HTTP 503", severity: "high" })
    expect(summary.issues.changed.map((i) => i.url)).toEqual(["https://x/changed"])
    expect(summary.issues.sslExpiring.map((i) => i.url)).toEqual(["https://x/garbled"])
    expect(summary.issues.mojibake[0]?.detail).toContain("85%")
    expect(summary.issues.llmGarbage).toEqual([])
  })
})

describe("user notification settings", () => {
  const fullSettings = {
    slack: { enabled: true, webhookUrl: "https://hooks/slack" },
    telegram: { enabled: false },
    email: { enabled: true, to: ["ops@example.com"] },
    webhook: { enabled: false },
    enabledEvents: {
      onCrawlFailure: true, onContentChange: false, onSslExpiring: false, onCrawlComplete: true,
      onMojibakeDetected: false, onLlmGarbageDetected: false, onCrawlProgress: false,
      onMonitorDown: true, onMonitorRecovery: false, onMonitorSlow: false
    }
  }

  it("returns null before any upsert", () => {
    expect(storage.getUserNotificationSettings("u1")).toBeNull()
    expect(storage.listUserNotificationSettings()).toEqual([])
  })

  it("upserts, reads back, overwrites, lists and deletes", () => {
    storage.upsertUserNotificationSettings("u1", fullSettings)
    expect(storage.getUserNotificationSettings("u1")).toMatchObject({
      userId: "u1",
      ...fullSettings
    })
    expect(typeof storage.getUserNotificationSettings("u1")!.updatedAt).toBe("string")

    storage.upsertUserNotificationSettings("u1", {
      ...fullSettings,
      slack: { enabled: false }
    })
    expect(storage.getUserNotificationSettings("u1")!.slack).toEqual({ enabled: false })
    expect(storage.listUserNotificationSettings()).toHaveLength(1)

    storage.upsertUserNotificationSettings("u2", fullSettings)
    expect(storage.listUserNotificationSettings().map((s) => s.userId).sort()).toEqual(["u1", "u2"])

    storage.deleteUserNotificationSettings("u1")
    expect(storage.getUserNotificationSettings("u1")).toBeNull()
    expect(storage.listUserNotificationSettings()).toHaveLength(1)
  })
})

describe("user email lookup", () => {
  it("reads emails from the auth-owned user table or returns null", () => {
    createAuthTablesAndUser("u1", "ops@example.com")
    expect(storage.getUserEmail("u1")).toBe("ops@example.com")
    expect(storage.getUserEmail("nobody")).toBeNull()
  })
})

describe("resource snapshots", () => {
  it("inserts, queries by time, latest lookup and purging", () => {
    expect(storage.getLatestResourceSnapshot()).toBeNull()
    storage.insertResourceSnapshot({ rssMb: 100, heapTotalMb: 50, heapUsedMb: 20, externalMb: 1, cpuPercent: 5, diskUsedMb: 1000, recordedAt: iso(1) })
    storage.insertResourceSnapshot({ rssMb: 110, heapTotalMb: 55, heapUsedMb: 25, externalMb: 2, cpuPercent: 7, diskUsedMb: 1010, recordedAt: iso(2) })

    expect(storage.getResourceSnapshots(iso(2)).map((s) => s.recordedAt)).toEqual([iso(2)])
    const latest = storage.getLatestResourceSnapshot()!
    expect(latest.rssMb).toBe(110)
    expect(latest.heapUsedMb).toBe(25)

    expect(storage.purgeOldResourceSnapshots(iso(2))).toBe(1)
    expect(storage.getLatestResourceSnapshot()!.recordedAt).toBe(iso(2))
    expect(storage.purgeOldResourceSnapshots(iso(2))).toBe(0)
  })
})
