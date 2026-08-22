import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { defaultConfig, loadConfigFromFile, parseConfig, writeConfigToFile } from "./config.js"
import { CrawlJobExportSchema, type Config } from "./types.js"

const MINIMAL = {
  sitemaps: ["https://example.com/sitemap.xml"],
  crawl: {},
  checks: { ssl: {}, responseTime: {} }
}

describe("parseConfig", () => {
  it("parses a valid minimal config and applies inner defaults", () => {
    const config = parseConfig(JSON.stringify(MINIMAL))

    expect(config.crawl.delayMs).toBe(2000)
    expect(config.crawl.maxConcurrency).toBe(2)
    expect(config.crawl.timeoutMs).toBe(30000)
    expect(config.crawl.userAgent).toBe("supacrawl/0.1")
    expect(config.crawl.respectRobotsTxt).toBe(true)
    expect(config.crawl.maxBodyBytes).toBe(256 * 1024)
    expect(config.checks.ssl.enabled).toBe(true)
    expect(config.checks.ssl.warnDays).toBe(30)
    expect(config.checks.responseTime.warnMs).toBe(3000)
    expect(config.checks.contentDiff).toBe(true)
  })

  it("applies the notifications default when omitted", () => {
    const config = parseConfig(JSON.stringify(MINIMAL))

    expect(config.notifications.providers.slack.enabled).toBe(false)
    expect(config.notifications.providers.email.to).toEqual([])
    expect(config.notifications.events.onCrawlFailure).toBe(true)
    expect(config.notifications.events.onCrawlComplete).toBe(false)
  })
  it("transforms plain sitemap URL strings into enabled entries", () => {
    const config = parseConfig(
      JSON.stringify({
        ...MINIMAL,
        sitemaps: ["https://example.com/a.xml", { url: "https://example.com/b.xml", enabled: false }]
      })
    )

    expect(config.sitemaps).toEqual([
      { url: "https://example.com/a.xml", enabled: true },
      { url: "https://example.com/b.xml", enabled: false }
    ])
  })

  it("merges a partial crawl object over defaults", () => {
    const config = parseConfig(
      JSON.stringify({ ...MINIMAL, crawl: { delayMs: 500, maxUrls: 10 } })
    )

    expect(config.crawl.delayMs).toBe(500)
    expect(config.crawl.maxUrls).toBe(10)
    // untouched fields keep schema defaults
    expect(config.crawl.timeoutMs).toBe(30000)
    expect(config.crawl.maxRetries).toBe(2)
  })

  it("throws ZodError on an empty sitemaps array", () => {
    const raw = JSON.stringify({ ...MINIMAL, sitemaps: [] })
    expect(() => parseConfig(raw)).toThrow(z.ZodError)
  })

  it("throws ZodError on a wrong-typed field", () => {
    const raw = JSON.stringify({ ...MINIMAL, crawl: { delayMs: "soon" } })
    expect(() => parseConfig(raw)).toThrow(z.ZodError)
  })

  it("rejects invalid JSON", () => {
    expect(() => parseConfig("{ not json")).toThrow(SyntaxError)
  })

  it("strips unknown top-level fields", () => {
    const config = parseConfig(
      JSON.stringify({ ...MINIMAL, mysteryField: true })
    ) as unknown as Record<string, unknown>

    expect("mysteryField" in config).toBe(false)
    expect(Object.keys(config).sort()).toEqual(["checks", "crawl", "notifications", "sitemaps"])
  })

  it("keeps an optional schedule string", () => {
    const config = parseConfig(JSON.stringify({ ...MINIMAL, schedule: "0 3 * * *" }))
    expect(config.schedule).toBe("0 3 * * *")
  })
})

describe("defaultConfig", () => {
  it("passes parseConfig unchanged", () => {
    const parsed = parseConfig(JSON.stringify(defaultConfig()))
    expect(parsed.sitemaps).toEqual([
      { url: "https://example.com/sitemap.xml", enabled: false }
    ])
  })

  it("returns sane values", () => {
    const d = defaultConfig()
    expect(d.crawl!.delayMs).toBeGreaterThan(0)
    expect(d.crawl!.maxConcurrency).toBeGreaterThanOrEqual(1)
    expect(d.crawl!.respectRobotsTxt).toBe(true)
    expect(d.crawl!.maxUrls).toBeGreaterThan(0)
    expect(d.sitemaps!.length).toBeGreaterThanOrEqual(1)
  })
})

describe("loadConfigFromFile", () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it("loads a valid config file", () => {
    dir = mkdtempSync(join(tmpdir(), "supacrawl-test-"))
    const path = join(dir, "config.json")
    const expected = parseConfig(JSON.stringify(MINIMAL))
    writeFileSync(path, JSON.stringify(expected), "utf-8")

    expect(loadConfigFromFile(path)).toEqual(expected)
  })

  it("falls back to defaults with a warning when the file is missing", () => {
    dir = mkdtempSync(join(tmpdir(), "supacrawl-test-"))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const missing = join(dir, "nope.json")

    const config = loadConfigFromFile(missing)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain(missing)
    expect(config).toEqual(parseConfig(JSON.stringify(defaultConfig())))
  })

  it("throws on a file containing invalid JSON", () => {
    dir = mkdtempSync(join(tmpdir(), "supacrawl-test-"))
    const path = join(dir, "broken.json")
    writeFileSync(path, "{ broken", "utf-8")

    expect(() => loadConfigFromFile(path)).toThrow(SyntaxError)
  })
})

describe("writeConfigToFile round-trip", () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it("writes JSON that loads back to an equal config", () => {
    dir = mkdtempSync(join(tmpdir(), "supacrawl-test-"))
    const path = join(dir, "roundtrip.json")
    const original = parseConfig(
      JSON.stringify({ ...MINIMAL, schedule: "0 4 * * 1" })
    )

    writeConfigToFile(path, original)

    expect(existsSync(path)).toBe(true)
    expect(loadConfigFromFile(path)).toEqual(original)
  })

  it("emits pretty-printed JSON", () => {
    dir = mkdtempSync(join(tmpdir(), "supacrawl-test-"))
    const path = join(dir, "pretty.json")
    const original = parseConfig(JSON.stringify(MINIMAL))

    writeConfigToFile(path, original)

    const text = readFileSync(path, "utf-8")
    expect(text).toContain("\n  ")
    expect(text).toContain('"sitemaps"')
    const reparsed: Config = parseConfig(text)
    expect(reparsed).toEqual(original)
  })
})

describe("CrawlJobExportSchema", () => {
  const validJob = {
    id: "job-1",
    name: "Example",
    sitemapUrl: "https://example.com/sitemap.xml",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z"
  }
  const validExport = {
    version: 1,
    exportedAt: "2026-01-03T12:00:00.000Z",
    jobs: [validJob]
  }

  it("parses a valid export with defaults applied to jobs", () => {
    const parsed = CrawlJobExportSchema.parse(validExport)

    expect(parsed.version).toBe(1)
    const job = parsed.jobs[0]!
    expect(job.enabled).toBe(true)
    expect(job.intervalValue).toBe(60)
    expect(job.intervalUnit).toBe("minutes")
    expect(job.runAt).toBeNull()
    expect(job.notifyOnFailure).toBe(true)
    expect(job.lastRunAt).toBeUndefined()
    expect(job.lastRunStatus).toBeUndefined()
  })

  it("accepts optional job runtime fields", () => {
    const parsed = CrawlJobExportSchema.parse({
      ...validExport,
      jobs: [{ ...validJob, lastRunAt: null, lastRunStatus: null, sitemapUrls: null }]
    })

    const job = parsed.jobs[0]!
    expect(job.lastRunAt).toBeNull()
    expect(job.lastRunStatus).toBeNull()
    expect(job.sitemapUrls).toBeNull()
  })

  it("rejects a missing required field (version)", () => {
    const { version: _version, ...withoutVersion } = validExport
    expect(() => CrawlJobExportSchema.parse(withoutVersion)).toThrow(z.ZodError)
  })

  it("rejects a wrong-typed field (exportedAt)", () => {
    expect(() =>
      CrawlJobExportSchema.parse({ ...validExport, exportedAt: 12345 })
    ).toThrow(z.ZodError)
  })

  it("rejects a job without a name", () => {
    const { name: _name, ...nameless } = validJob
    expect(() =>
      CrawlJobExportSchema.parse({ ...validExport, jobs: [nameless] })
    ).toThrow(z.ZodError)
  })

  it("rejects a non-literal version", () => {
    expect(() => CrawlJobExportSchema.parse({ ...validExport, version: 2 })).toThrow(
      z.ZodError
    )
  })
})
