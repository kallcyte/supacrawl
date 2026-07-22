import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import BetterSqlite3 from "better-sqlite3"
type SqliteDb = InstanceType<typeof BetterSqlite3>
import type {
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
        error_message TEXT
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
        check_method TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_results_crawl ON crawl_results(crawl_id);
      CREATE INDEX IF NOT EXISTS idx_results_url ON crawl_results(url);
      CREATE INDEX IF NOT EXISTS idx_results_status ON crawl_results(status_code);

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
  }

  close(): void {
    this.db.close()
  }

  // Crawls
  createCrawl(record: CrawlRecord): void {
    this.db
      .prepare(
        `INSERT INTO crawls (id, started_at, status, urls_total)
         VALUES (?, ?, ?, ?)`
      )
      .run(record.id, record.startedAt, record.status, record.urlsTotal)
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
          sitemap_lastmod, checked_at, check_method)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        r.checkMethod
      )
  }

  listResults(
    crawlId: string,
    filter?: { brokenOnly?: boolean; changedOnly?: boolean }
  ): CrawlResultRecord[] {
    let sql = `SELECT id, crawl_id, url, status_code, response_time_ms, content_hash,
                      content_changed, error, redirect_chain, ssl_valid_until,
                      sitemap_lastmod, checked_at, check_method
               FROM crawl_results WHERE crawl_id = ?`
    const params: unknown[] = [crawlId]
    if (filter?.brokenOnly) {
      sql += ` AND (status_code >= 400 OR status_code IS NULL)`
    }
    if (filter?.changedOnly) {
      sql += ` AND content_changed = 1`
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
                sitemap_lastmod, checked_at, check_method
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
                sitemap_lastmod, checked_at, check_method
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
}

function mapCrawl(row: Record<string, unknown>): CrawlRecord {
  return {
    id: row.id as string,
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
    checkMethod: row.check_method as CrawlResultRecord["checkMethod"]
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
