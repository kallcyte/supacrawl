import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import BetterSqlite3 from "better-sqlite3"
type SqliteDb = InstanceType<typeof BetterSqlite3>
import type {
  CrawlJob,
  CrawlRecord,
  CrawlResultRecord,
  UrlStateRecord
} from "./types.js"

export interface StorageOptions {
  path: string
}

export class Storage {
  private db: SqliteDb

  constructor(opts: StorageOptions) {
    mkdirSync(dirname(opts.path), { recursive: true })
    this.db = new BetterSqlite3(opts.path)
    this.migrate()
  }

  private hasColumn(table: string, column: string): boolean {
    const row = this.db.prepare(`SELECT COUNT(*) AS cnt FROM pragma_table_info(?) WHERE name = ?`).get(table, column) as { cnt: number }
    return row.cnt > 0
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS crawls (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        urls_total INTEGER DEFAULT 0,
        urls_checked INTEGER DEFAULT 0,
        urls_changed INTEGER DEFAULT 0,
        urls_broken INTEGER DEFAULT 0,
        urls_skipped INTEGER DEFAULT 0,
        error_message TEXT,
        job_id TEXT REFERENCES crawl_jobs(id)
      );

      CREATE TABLE IF NOT EXISTS crawl_results (
        id TEXT PRIMARY KEY,
        crawl_id TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        status_code INTEGER,
        response_time_ms INTEGER,
        content_hash TEXT,
        content_changed INTEGER DEFAULT 0,
        error TEXT,
        redirect_chain TEXT,
        ssl_valid_until TEXT,
        sitemap_lastmod TEXT,
        checked_at TEXT NOT NULL,
        check_method TEXT NOT NULL,
        mojibake_score REAL,
        mojibake_flagged INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_results_crawl ON crawl_results(crawl_id);
      CREATE INDEX IF NOT EXISTS idx_results_url ON crawl_results(url);
      CREATE INDEX IF NOT EXISTS idx_results_status ON crawl_results(status_code);

      CREATE TABLE IF NOT EXISTS crawl_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sitemap_url TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        interval_value INTEGER NOT NULL,
        interval_unit TEXT NOT NULL DEFAULT 'minutes',
        notify_on_complete INTEGER DEFAULT 0,
        notify_on_failure INTEGER DEFAULT 1,
        notify_on_change INTEGER DEFAULT 1,
        notify_on_mojibake INTEGER DEFAULT 0,
        detect_mojibake INTEGER DEFAULT 1,
        delay_ms INTEGER NOT NULL,
        max_concurrency INTEGER NOT NULL,
        timeout_ms INTEGER NOT NULL,
        user_agent TEXT NOT NULL,
        respect_robots_txt INTEGER DEFAULT 1,
        max_urls INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_run_at TEXT,
        last_run_status TEXT
      );

      CREATE TABLE IF NOT EXISTS url_state (
        url TEXT PRIMARY KEY,
        last_status_code INTEGER,
        last_content_hash TEXT,
        last_response_time_ms INTEGER,
        sitemap_lastmod TEXT,
        last_checked_at TEXT NOT NULL,
        consecutive_failures INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)

    if (!this.hasColumn("crawls", "job_id")) {
      this.db.exec(`ALTER TABLE crawls ADD COLUMN job_id TEXT REFERENCES crawl_jobs(id)`)
    }
    if (!this.hasColumn("crawl_jobs", "sitemap_urls")) {
      this.db.exec(`ALTER TABLE crawl_jobs ADD COLUMN sitemap_urls TEXT`)
    }
    if (!this.hasColumn("crawl_results", "mojibake_score")) {
      this.db.exec(`ALTER TABLE crawl_results ADD COLUMN mojibake_score REAL`)
    }
    if (!this.hasColumn("crawl_results", "mojibake_flagged")) {
      this.db.exec(`ALTER TABLE crawl_results ADD COLUMN mojibake_flagged INTEGER DEFAULT 0`)
    }
    if (!this.hasColumn("crawl_jobs", "detect_mojibake")) {
      this.db.exec(`ALTER TABLE crawl_jobs ADD COLUMN detect_mojibake INTEGER DEFAULT 1`)
    }
    if (!this.hasColumn("crawl_jobs", "notify_on_mojibake")) {
      this.db.exec(`ALTER TABLE crawl_jobs ADD COLUMN notify_on_mojibake INTEGER DEFAULT 0`)
    }
  }

  close(): void {
    this.db.close()
  }

  // Crawls
  createCrawl(record: CrawlRecord, jobId?: string): void {
    this.db
      .prepare(
        `INSERT INTO crawls (id, started_at, status, urls_total, job_id)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(record.id, record.startedAt, record.status, record.urlsTotal, jobId ?? null)
  }

  updateCrawl(
    id: string,
    patch: Partial<
      Pick<
        CrawlRecord,
        | "finishedAt"
        | "status"
        | "urlsTotal"
        | "urlsChecked"
        | "urlsChanged"
        | "urlsBroken"
        | "urlsSkipped"
        | "errorMessage"
      >
    >
  ): void {
    const fields: string[] = []
    const values: unknown[] = []
    if (patch.finishedAt !== undefined) {
      fields.push("finished_at = ?")
      values.push(patch.finishedAt)
    }
    if (patch.status !== undefined) {
      fields.push("status = ?")
      values.push(patch.status)
    }
    if (patch.urlsTotal !== undefined) {
      fields.push("urls_total = ?")
      values.push(patch.urlsTotal)
    }
    if (patch.urlsChecked !== undefined) {
      fields.push("urls_checked = ?")
      values.push(patch.urlsChecked)
    }
    if (patch.urlsChanged !== undefined) {
      fields.push("urls_changed = ?")
      values.push(patch.urlsChanged)
    }
    if (patch.urlsBroken !== undefined) {
      fields.push("urls_broken = ?")
      values.push(patch.urlsBroken)
    }
    if (patch.urlsSkipped !== undefined) {
      fields.push("urls_skipped = ?")
      values.push(patch.urlsSkipped)
    }
    if (patch.errorMessage !== undefined) {
      fields.push("error_message = ?")
      values.push(patch.errorMessage)
    }
    if (fields.length === 0) return
    values.push(id)
    this.db.prepare(`UPDATE crawls SET ${fields.join(", ")} WHERE id = ?`).run(...values)
  }

  getCrawl(id: string): CrawlRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, started_at, finished_at, status, urls_total, urls_checked,
                urls_changed, urls_broken, urls_skipped, error_message
         FROM crawls WHERE id = ?`
      )
      .get(id) as Record<string, unknown> | undefined
    return row ? mapCrawl(row) : null
  }

  deleteCrawl(id: string): void {
    this.db.prepare("DELETE FROM crawl_results WHERE crawl_id = ?").run(id)
    this.db.prepare("DELETE FROM crawls WHERE id = ?").run(id)
  }

  listCrawls(limit = 50, offset = 0): CrawlRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, started_at, finished_at, status, urls_total, urls_checked,
                urls_changed, urls_broken, urls_skipped, error_message
         FROM crawls ORDER BY started_at DESC LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as Record<string, unknown>[]
    return rows.map(mapCrawl)
  }

  // Results
  insertResult(r: CrawlResultRecord): void {
    this.db
      .prepare(
        `INSERT INTO crawl_results
         (id, crawl_id, url, status_code, response_time_ms, content_hash,
          content_changed, error, redirect_chain, ssl_valid_until,
          sitemap_lastmod, checked_at, check_method, mojibake_score, mojibake_flagged)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        r.id,
        r.crawlId,
        r.url,
        r.statusCode,
        r.responseTimeMs,
        r.contentHash,
        r.contentChanged ? 1 : 0,
        r.error,
        r.redirectChain,
        r.sslValidUntil,
        r.sitemapLastmod,
        r.checkedAt,
        r.checkMethod,
        r.mojibakeScore,
        r.mojibakeFlagged ? 1 : 0
      )
  }

  listResults(
    crawlId: string,
    filter?: { brokenOnly?: boolean; changedOnly?: boolean; mojibakeOnly?: boolean }
  ): CrawlResultRecord[] {
    let sql = `SELECT id, crawl_id, url, status_code, response_time_ms, content_hash,
                      content_changed, error, redirect_chain, ssl_valid_until,
                      sitemap_lastmod, checked_at, check_method, mojibake_score, mojibake_flagged
               FROM crawl_results WHERE crawl_id = ?`
    const params: unknown[] = [crawlId]
    if (filter?.brokenOnly) {
      sql += ` AND (status_code >= 400 OR status_code IS NULL)`
    }
    if (filter?.changedOnly) {
      sql += ` AND content_changed = 1`
    }
    if (filter?.mojibakeOnly) {
      sql += ` AND mojibake_flagged = 1`
    }
    sql += ` ORDER BY checked_at ASC`
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[]
    return rows.map(mapResult)
  }

  getResult(id: string): CrawlResultRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, crawl_id, url, status_code, response_time_ms, content_hash,
                content_changed, error, redirect_chain, ssl_valid_until,
                sitemap_lastmod, checked_at, check_method, mojibake_score, mojibake_flagged
         FROM crawl_results WHERE id = ?`
      )
      .get(id) as Record<string, unknown> | undefined
    return row ? mapResult(row) : null
  }

  // URL state
  upsertUrlState(s: UrlStateRecord): void {
    this.db
      .prepare(
        `INSERT INTO url_state
         (url, last_status_code, last_content_hash, last_response_time_ms,
          sitemap_lastmod, last_checked_at, consecutive_failures)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(url) DO UPDATE SET
           last_status_code = excluded.last_status_code,
           last_content_hash = excluded.last_content_hash,
           last_response_time_ms = excluded.last_response_time_ms,
           sitemap_lastmod = excluded.sitemap_lastmod,
           last_checked_at = excluded.last_checked_at,
           consecutive_failures = excluded.consecutive_failures`
      )
      .run(
        s.url,
        s.lastStatusCode,
        s.lastContentHash,
        s.lastResponseTimeMs,
        s.sitemapLastmod,
        s.lastCheckedAt,
        s.consecutiveFailures
      )
  }

  getAllUrlStates(): UrlStateRecord[] {
    const rows = this.db
      .prepare(
        `SELECT url, last_status_code, last_content_hash, last_response_time_ms,
                sitemap_lastmod, last_checked_at, consecutive_failures
         FROM url_state`
      )
      .all() as Record<string, unknown>[]
    return rows.map(mapUrlState)
  }

  getUrlHistory(url: string, limit = 100): CrawlResultRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, crawl_id, url, status_code, response_time_ms, content_hash,
                content_changed, error, redirect_chain, ssl_valid_until,
                sitemap_lastmod, checked_at, check_method, mojibake_score, mojibake_flagged
         FROM crawl_results WHERE url = ?
         ORDER BY checked_at DESC LIMIT ?`
      )
      .all(url, limit) as Record<string, unknown>[]
    return rows.map(mapResult)
  }

  listUrls(limit = 500, offset = 0): UrlStateRecord[] {
    const rows = this.db
      .prepare(
        `SELECT url, last_status_code, last_content_hash, last_response_time_ms,
                sitemap_lastmod, last_checked_at, consecutive_failures
         FROM url_state ORDER BY last_checked_at DESC LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as Record<string, unknown>[]
    return rows.map(mapUrlState)
  }

  // Settings KV
  getSetting(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value)
  }

  // Crawl Jobs
  listCrawlJobs(): CrawlJob[] {
    const rows = this.db.prepare(`SELECT * FROM crawl_jobs ORDER BY created_at DESC`).all() as Record<string, unknown>[]
    return rows.map(mapCrawlJob)
  }

  getCrawlJob(id: string): CrawlJob | null {
    const row = this.db.prepare(`SELECT * FROM crawl_jobs WHERE id = ?`).get(id) as Record<string, unknown> | undefined
    return row ? mapCrawlJob(row) : null
  }

  createCrawlJob(job: CrawlJob): void {
    this.db
      .prepare(
        `INSERT INTO crawl_jobs
         (id, name, sitemap_url, sitemap_urls, enabled, interval_value, interval_unit,
          notify_on_complete, notify_on_failure, notify_on_change, notify_on_mojibake,
          detect_mojibake,
          delay_ms, max_concurrency, timeout_ms, user_agent,
          respect_robots_txt, max_urls, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        job.id, job.name, job.sitemapUrl,
        job.sitemapUrls ? JSON.stringify(job.sitemapUrls) : null,
        job.enabled ? 1 : 0,
        job.intervalValue, job.intervalUnit,
        job.notifyOnComplete ? 1 : 0, job.notifyOnFailure ? 1 : 0, job.notifyOnChange ? 1 : 0,
        job.notifyOnMojibake ? 1 : 0,
        job.detectMojibake ? 1 : 0,
        job.delayMs, job.maxConcurrency, job.timeoutMs, job.userAgent,
        job.respectRobotsTxt ? 1 : 0, job.maxUrls,
        job.createdAt, job.updatedAt
      )
  }

  updateCrawlJob(id: string, patch: Partial<CrawlJob>): void {
    const fields: string[] = []
    const values: unknown[] = []
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue
      const col = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)
      fields.push(`${col} = ?`)
      if (Array.isArray(value)) {
        values.push(JSON.stringify(value))
      } else if (typeof value === "boolean") {
        values.push(value ? 1 : 0)
      } else {
        values.push(value)
      }
    }
    values.push(id)
    this.db.prepare(`UPDATE crawl_jobs SET ${fields.join(", ")} WHERE id = ?`).run(...values)
  }

  deleteCrawlJob(id: string): void {
    this.db.prepare(`DELETE FROM crawl_jobs WHERE id = ?`).run(id)
  }

  getCrawlsForJob(jobId: string, limit = 50): CrawlRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM crawls WHERE job_id = ? ORDER BY started_at DESC LIMIT ?`)
      .all(jobId, limit) as Record<string, unknown>[]
    return rows.map(mapCrawl)
  }

  // Stats
  getOverviewStats(): {
    totalUrls: number
    totalCrawls: number
    lastCrawlAt: string | null
    lastCrawlBroken: number
    lastCrawlChanged: number
    brokenNow: number
  } {
    const totalUrls = (
      this.db.prepare(`SELECT COUNT(*) AS c FROM url_state`).get() as { c: number }
    ).c
    const totalCrawls = (
      this.db.prepare(`SELECT COUNT(*) AS c FROM crawls`).get() as { c: number }
    ).c
    const lastCrawl = this.db
      .prepare(
        `SELECT started_at, urls_broken, urls_changed FROM crawls ORDER BY started_at DESC LIMIT 1`
      )
      .get() as { started_at: string; urls_broken: number; urls_changed: number } | undefined
    const brokenNow = (
      this.db
        .prepare(`SELECT COUNT(*) AS c FROM url_state WHERE last_status_code >= 400`)
        .get() as { c: number }
    ).c
    return {
      totalUrls,
      totalCrawls,
      lastCrawlAt: lastCrawl?.started_at ?? null,
      lastCrawlBroken: lastCrawl?.urls_broken ?? 0,
      lastCrawlChanged: lastCrawl?.urls_changed ?? 0,
      brokenNow
    }
  }

  getTimeline(days = 30): { date: string; healthy: number; broken: number }[] {
    const rows = this.db
      .prepare(
        `SELECT substr(started_at, 1, 10) AS date,
                SUM(CASE WHEN urls_broken = 0 THEN 1 ELSE 0 END) AS healthy,
                SUM(CASE WHEN urls_broken > 0 THEN 1 ELSE 0 END) AS broken
         FROM crawls
         WHERE started_at >= datetime('now', ?)
         GROUP BY date
         ORDER BY date ASC`
      )
      .all(`-${days} days`) as { date: string; healthy: number; broken: number }[]
    return rows
  }

  getCrawlDurationTrend(limit = 30): { id: string; startedAt: string; durationMs: number }[] {
    const rows = this.db
      .prepare(
        `SELECT id, started_at,
                (julianday(finished_at) - julianday(started_at)) * 86400000 AS duration_ms
         FROM crawls
         WHERE finished_at IS NOT NULL
         ORDER BY started_at DESC LIMIT ?`
      )
      .all(limit) as { id: string; started_at: string; duration_ms: number | null }[]
    return rows
      .map((r) => ({
        id: r.id,
        startedAt: r.started_at,
        durationMs: Math.max(0, Math.round(r.duration_ms ?? 0))
      }))
      .reverse()
  }

  getStatusDistribution(crawlId: string): { status: string; count: number }[] {
    const rows = this.db
      .prepare(
        `SELECT
           CASE
             WHEN status_code IS NULL THEN 'error'
             WHEN status_code < 200 THEN '1xx'
             WHEN status_code < 300 THEN '2xx'
             WHEN status_code < 400 THEN '3xx'
             WHEN status_code < 500 THEN '4xx'
             ELSE '5xx'
           END AS bucket,
           COUNT(*) AS c
         FROM crawl_results WHERE crawl_id = ?
         GROUP BY bucket`
      )
      .all(crawlId) as { bucket: string; c: number }[]
    return rows.map((r) => ({ status: r.bucket, count: r.c }))
  }

  cleanupStaleCrawls(): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE crawls SET status = 'failed', finished_at = ?, error_message = ? WHERE status = 'running'`
      )
      .run(now, "Server was restarted")
  }
}

function mapCrawlJob(row: Record<string, unknown>): CrawlJob {
  let sitemapUrls: string[] | null = null
  if (typeof row.sitemap_urls === "string") {
    try {
      const parsed = JSON.parse(row.sitemap_urls)
      if (Array.isArray(parsed)) sitemapUrls = parsed
    } catch { /* ignore */ }
  }
  return {
    id: row.id as string,
    name: row.name as string,
    sitemapUrl: row.sitemap_url as string,
    sitemapUrls,
    enabled: row.enabled === 1,
    intervalValue: row.interval_value as number,
    intervalUnit: row.interval_unit as CrawlJob["intervalUnit"],
    notifyOnComplete: row.notify_on_complete === 1,
    notifyOnFailure: row.notify_on_failure === 1,
    notifyOnChange: row.notify_on_change === 1,
    notifyOnMojibake: row.notify_on_mojibake === 1,
    detectMojibake: row.detect_mojibake !== 0,
    delayMs: row.delay_ms as number,
    maxConcurrency: row.max_concurrency as number,
    timeoutMs: row.timeout_ms as number,
    userAgent: row.user_agent as string,
    respectRobotsTxt: row.respect_robots_txt === 1,
    maxUrls: row.max_urls as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    lastRunAt: (row.last_run_at as string | null) ?? null,
    lastRunStatus: (row.last_run_status as CrawlJob["lastRunStatus"]) ?? null
  }
}

function mapCrawl(row: Record<string, unknown>): CrawlRecord {
  return {
    id: row.id as string,
    jobId: (row.job_id as string | null) ?? null,
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string | null) ?? null,
    status: row.status as CrawlRecord["status"],
    urlsTotal: (row.urls_total as number) ?? 0,
    urlsChecked: (row.urls_checked as number) ?? 0,
    urlsChanged: (row.urls_changed as number) ?? 0,
    urlsBroken: (row.urls_broken as number) ?? 0,
    urlsSkipped: (row.urls_skipped as number) ?? 0,
    errorMessage: (row.error_message as string | null) ?? null
  }
}

function mapResult(row: Record<string, unknown>): CrawlResultRecord {
  return {
    id: row.id as string,
    crawlId: row.crawl_id as string,
    url: row.url as string,
    statusCode: (row.status_code as number | null) ?? null,
    responseTimeMs: (row.response_time_ms as number | null) ?? null,
    contentHash: (row.content_hash as string | null) ?? null,
    contentChanged: row.content_changed === 1,
    error: (row.error as string | null) ?? null,
    redirectChain: (row.redirect_chain as string | null) ?? null,
    sslValidUntil: (row.ssl_valid_until as string | null) ?? null,
    sitemapLastmod: (row.sitemap_lastmod as string | null) ?? null,
    checkedAt: row.checked_at as string,
    checkMethod: row.check_method as CrawlResultRecord["checkMethod"],
    mojibakeScore: (row.mojibake_score as number | null) ?? null,
    mojibakeFlagged: row.mojibake_flagged === 1
  }
}

function mapUrlState(row: Record<string, unknown>): UrlStateRecord {
  return {
    url: row.url as string,
    lastStatusCode: (row.last_status_code as number | null) ?? null,
    lastContentHash: (row.last_content_hash as string | null) ?? null,
    lastResponseTimeMs: (row.last_response_time_ms as number | null) ?? null,
    sitemapLastmod: (row.sitemap_lastmod as string | null) ?? null,
    lastCheckedAt: row.last_checked_at as string,
    consecutiveFailures: (row.consecutive_failures as number) ?? 0
  }
}
