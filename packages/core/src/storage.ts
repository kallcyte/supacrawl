import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import BetterSqlite3 from "better-sqlite3"
type SqliteDb = InstanceType<typeof BetterSqlite3>
import type {
  CrawlJob,
  CrawlRecord,
  CrawlResultRecord,
  CrawlSummary,
  CrawlSummaryIssue,
  Heartbeat,
  HeartbeatStatus,
  MaintenanceWindowRecord,
  Monitor,
  MonitorRecord,
  MonitorStats,
  MonitorWithStatus,
  ResourceSnapshot,
  SeoInfo,
  StatusPageMonitor,
  StatusPageRecord,
  UrlStateRecord,
  UserNotificationSettings
} from "./types.js"

export interface StorageOptions {
  path: string
}

export class Storage {
  private db: SqliteDb
  readonly dbPath: string

  constructor(opts: StorageOptions) {
    mkdirSync(dirname(opts.path), { recursive: true })
    this.db = new BetterSqlite3(opts.path)
    this.db.pragma("journal_mode = WAL")
    this.db.pragma("busy_timeout = 5000")
    this.dbPath = opts.path
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
        final_url TEXT,
        ssl_valid_until TEXT,
        sitemap_lastmod TEXT,
        checked_at TEXT NOT NULL,
        check_method TEXT NOT NULL,
        mojibake_score REAL,
        mojibake_flagged INTEGER DEFAULT 0,
        mojibake_sample TEXT,
        llm_garbage_score REAL,
        llm_garbage_flagged INTEGER DEFAULT 0,
        llm_garbage_sample TEXT,
        seo TEXT
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
        run_at TEXT,
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
        consecutive_failures INTEGER DEFAULT 0,
        has_seo INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS monitors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'http',
        url TEXT NOT NULL,
        method TEXT DEFAULT 'GET',
        expected_status INTEGER DEFAULT 200,
        expected_body TEXT,
        interval_seconds INTEGER NOT NULL DEFAULT 60,
        retry_count INTEGER NOT NULL DEFAULT 3,
        timeout_ms INTEGER NOT NULL DEFAULT 10000,
        accepted_response_time_ms INTEGER DEFAULT 5000,
        enabled INTEGER DEFAULT 1,
        source TEXT NOT NULL DEFAULT 'manual',
        job_id TEXT REFERENCES crawl_jobs(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS heartbeats (
        id TEXT PRIMARY KEY,
        monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        response_time_ms INTEGER,
        message TEXT,
        checked_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_heartbeats_monitor ON heartbeats(monitor_id, checked_at DESC);

      CREATE TABLE IF NOT EXISTS status_pages (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        show_response_times INTEGER DEFAULT 1,
        public INTEGER DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS status_page_monitors (
        status_page_id TEXT NOT NULL REFERENCES status_pages(id) ON DELETE CASCADE,
        monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        sort_order INTEGER DEFAULT 0,
        PRIMARY KEY (status_page_id, monitor_id)
      );

      CREATE TABLE IF NOT EXISTS maintenance_windows (
        id TEXT PRIMARY KEY,
        monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        start_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        created_at TEXT NOT NULL
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
    if (!this.hasColumn("crawl_results", "final_url")) {
      this.db.exec(`ALTER TABLE crawl_results ADD COLUMN final_url TEXT`)
    }
    if (!this.hasColumn("crawl_results", "mojibake_flagged")) {
      this.db.exec(`ALTER TABLE crawl_results ADD COLUMN mojibake_flagged INTEGER DEFAULT 0`)
    }
    if (!this.hasColumn("crawl_results", "llm_garbage_score")) {
      this.db.exec(`ALTER TABLE crawl_results ADD COLUMN llm_garbage_score REAL`)
    }
    if (!this.hasColumn("crawl_results", "llm_garbage_flagged")) {
      this.db.exec(`ALTER TABLE crawl_results ADD COLUMN llm_garbage_flagged INTEGER DEFAULT 0`)
    }
    if (!this.hasColumn("crawl_results", "mojibake_sample")) {
      this.db.exec(`ALTER TABLE crawl_results ADD COLUMN mojibake_sample TEXT`)
    }
    if (!this.hasColumn("crawl_results", "llm_garbage_sample")) {
      this.db.exec(`ALTER TABLE crawl_results ADD COLUMN llm_garbage_sample TEXT`)
    }
    if (!this.hasColumn("crawl_results", "seo")) {
      this.db.exec(`ALTER TABLE crawl_results ADD COLUMN seo TEXT`)
    }
    if (!this.hasColumn("crawl_results", "seo_diff")) {
      this.db.exec(`ALTER TABLE crawl_results ADD COLUMN seo_diff TEXT`)
    }
    if (!this.hasColumn("url_state", "has_seo")) {
      this.db.exec(`ALTER TABLE url_state ADD COLUMN has_seo INTEGER DEFAULT 0`)
    }
    if (!this.hasColumn("url_state", "prev_seo")) {
      this.db.exec(`ALTER TABLE url_state ADD COLUMN prev_seo TEXT`)
    }
    if (!this.hasColumn("crawl_jobs", "detect_mojibake")) {
      this.db.exec(`ALTER TABLE crawl_jobs ADD COLUMN detect_mojibake INTEGER DEFAULT 1`)
    }
    if (!this.hasColumn("crawl_jobs", "notify_on_mojibake")) {
      this.db.exec(`ALTER TABLE crawl_jobs ADD COLUMN notify_on_mojibake INTEGER DEFAULT 0`)
    }
    if (!this.hasColumn("crawl_jobs", "detect_llm_garbage")) {
      this.db.exec(`ALTER TABLE crawl_jobs ADD COLUMN detect_llm_garbage INTEGER DEFAULT 1`)
    }
    if (!this.hasColumn("crawl_jobs", "notify_on_llm_garbage")) {
      this.db.exec(`ALTER TABLE crawl_jobs ADD COLUMN notify_on_llm_garbage INTEGER DEFAULT 0`)
    }
    if (!this.hasColumn("crawl_jobs", "notify_ssl_expiring")) {
      this.db.exec(`ALTER TABLE crawl_jobs ADD COLUMN notify_ssl_expiring INTEGER DEFAULT 1`)
    }
    if (!this.hasColumn("crawl_jobs", "max_body_bytes")) {
      this.db.exec(`ALTER TABLE crawl_jobs ADD COLUMN max_body_bytes INTEGER DEFAULT 5242880`)
    }
    if (!this.hasColumn("crawl_jobs", "notification_providers")) {
      this.db.exec(`ALTER TABLE crawl_jobs ADD COLUMN notification_providers TEXT`)
    }
    if (!this.hasColumn("crawl_jobs", "notify_on_progress")) {
      this.db.exec(`ALTER TABLE crawl_jobs ADD COLUMN notify_on_progress INTEGER DEFAULT 0`)
    }
    if (!this.hasColumn("crawl_jobs", "run_at")) {
      this.db.exec(`ALTER TABLE crawl_jobs ADD COLUMN run_at TEXT`)
    }

    this.db.exec(`CREATE TABLE IF NOT EXISTS resource_snapshots (
      id TEXT PRIMARY KEY,
      rss_mb REAL NOT NULL DEFAULT 0,
      heap_total_mb REAL NOT NULL DEFAULT 0,
      heap_used_mb REAL NOT NULL DEFAULT 0,
      external_mb REAL NOT NULL DEFAULT 0,
      cpu_percent REAL NOT NULL DEFAULT 0,
      disk_used_mb REAL NOT NULL DEFAULT 0,
      recorded_at TEXT NOT NULL
    )`)

    if (!this.hasColumn("resource_snapshots", "disk_used_mb")) {
      this.db.exec(`ALTER TABLE resource_snapshots ADD COLUMN disk_used_mb REAL NOT NULL DEFAULT 0`)
    }
    if (!this.hasColumn("resource_snapshots", "external_mb")) {
      this.db.exec(`ALTER TABLE resource_snapshots ADD COLUMN external_mb REAL NOT NULL DEFAULT 0`)
    }
    if (!this.hasColumn("resource_snapshots", "cpu_percent")) {
      this.db.exec(`ALTER TABLE resource_snapshots ADD COLUMN cpu_percent REAL NOT NULL DEFAULT 0`)
    }
    if (this.hasColumn("resource_snapshots", "timestamp") && !this.hasColumn("resource_snapshots", "recorded_at")) {
      this.db.exec(`ALTER TABLE resource_snapshots RENAME COLUMN timestamp TO recorded_at`)
    }
    if (!this.hasColumn("resource_snapshots", "recorded_at")) {
      this.db.exec(`ALTER TABLE resource_snapshots ADD COLUMN recorded_at TEXT NOT NULL DEFAULT ''`)
    }
    if (this.hasColumn("resource_snapshots", "timestamp") && this.hasColumn("resource_snapshots", "recorded_at")) {
      this.db.exec(`DROP INDEX IF EXISTS idx_resource_snapshots_ts`)
      this.db.exec(`UPDATE resource_snapshots SET recorded_at = timestamp WHERE recorded_at = ''`)
      this.db.exec(`ALTER TABLE resource_snapshots DROP COLUMN timestamp`)
    }

    if (this.hasColumn("resource_snapshots", "event_loop_lag_ms")) {
      this.db.exec(`ALTER TABLE resource_snapshots DROP COLUMN event_loop_lag_ms`)
    }

    const expectedColumns = new Set(["id", "rss_mb", "heap_total_mb", "heap_used_mb", "external_mb", "cpu_percent", "disk_used_mb", "recorded_at"])
    const actualColumns = this.db.prepare("PRAGMA table_info('resource_snapshots')").all() as { name: string }[]
    for (const col of actualColumns) {
      if (!expectedColumns.has(col.name)) {
        this.db.exec(`ALTER TABLE resource_snapshots DROP COLUMN "${col.name}"`)
      }
    }

    this.db.exec(`CREATE TABLE IF NOT EXISTS user_notification_settings (
      user_id TEXT PRIMARY KEY,
      slack TEXT NOT NULL DEFAULT '{}',
      telegram TEXT NOT NULL DEFAULT '{}',
      email TEXT NOT NULL DEFAULT '{}',
      webhook TEXT NOT NULL DEFAULT '{}',
      enabled_events TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    )`)
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
          content_changed, error, redirect_chain, final_url, ssl_valid_until,
          sitemap_lastmod, checked_at, check_method, mojibake_score, mojibake_flagged, mojibake_sample, llm_garbage_score, llm_garbage_flagged, llm_garbage_sample, seo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        r.finalUrl,
        r.sslValidUntil,
        r.sitemapLastmod,
        r.checkedAt,
        r.checkMethod,
        r.mojibakeScore,
        r.mojibakeFlagged ? 1 : 0,
        r.mojibakeSample ?? null,
        r.llmGarbageScore,
        r.llmGarbageFlagged ? 1 : 0,
        r.llmGarbageSample ?? null,
        r.seo ? JSON.stringify(r.seo) : null
      )
  }

  listResults(
    crawlId: string,
    filter?: { brokenOnly?: boolean; changedOnly?: boolean; mojibakeOnly?: boolean; llmGarbageOnly?: boolean },
    opts?: { includeSeo?: boolean }
  ): CrawlResultRecord[] {
    const includeSeo = opts?.includeSeo !== false
    let sql = `SELECT id, crawl_id, url, status_code, response_time_ms, content_hash,
                      content_changed, error, redirect_chain, final_url, ssl_valid_until,
                      sitemap_lastmod, checked_at, check_method, mojibake_score, mojibake_flagged, mojibake_sample, llm_garbage_score, llm_garbage_flagged, llm_garbage_sample${includeSeo ? ", seo" : ""}
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
    if (filter?.llmGarbageOnly) {
      sql += ` AND llm_garbage_flagged = 1`
    }
    sql += ` ORDER BY checked_at ASC`
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[]
    return rows.map((r) => mapResult(r, { includeSeo }))
  }

  getResult(id: string): CrawlResultRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, crawl_id, url, status_code, response_time_ms, content_hash,
                content_changed, error, redirect_chain, final_url, ssl_valid_until,
                sitemap_lastmod, checked_at, check_method, mojibake_score, mojibake_flagged, mojibake_sample, llm_garbage_score, llm_garbage_flagged, llm_garbage_sample, seo
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
          sitemap_lastmod, last_checked_at, consecutive_failures, has_seo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(url) DO UPDATE SET
           last_status_code = excluded.last_status_code,
           last_content_hash = excluded.last_content_hash,
           last_response_time_ms = excluded.last_response_time_ms,
           sitemap_lastmod = excluded.sitemap_lastmod,
           last_checked_at = excluded.last_checked_at,
           consecutive_failures = excluded.consecutive_failures,
           has_seo = excluded.has_seo`
      )
      .run(
        s.url,
        s.lastStatusCode,
        s.lastContentHash,
        s.lastResponseTimeMs,
        s.sitemapLastmod,
        s.lastCheckedAt,
        s.consecutiveFailures,
        s.hasSeo ? 1 : 0
      )
  }

  getUrlState(url: string): UrlStateRecord | null {
    const row = this.db
      .prepare(
        `SELECT url, last_status_code, last_content_hash, last_response_time_ms,
                sitemap_lastmod, last_checked_at, consecutive_failures, has_seo
         FROM url_state WHERE url = ?`
      )
      .get(url) as Record<string, unknown> | undefined
    return row ? mapUrlState(row) : null
  }

  getAllUrlStates(): UrlStateRecord[] {
    const rows = this.db
      .prepare(
        `SELECT url, last_status_code, last_content_hash, last_response_time_ms,
                sitemap_lastmod, last_checked_at, consecutive_failures, has_seo
         FROM url_state`
      )
      .all() as Record<string, unknown>[]
    return rows.map(mapUrlState)
  }

  getUrlHistory(url: string, limit = 100): CrawlResultRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, crawl_id, url, status_code, response_time_ms, content_hash,
                content_changed, error, redirect_chain, final_url, ssl_valid_until,
                sitemap_lastmod, checked_at, check_method, mojibake_score, mojibake_flagged, mojibake_sample, llm_garbage_score, llm_garbage_flagged, llm_garbage_sample, seo
         FROM crawl_results WHERE url = ?
         ORDER BY checked_at DESC LIMIT ?`
      )
      .all(url, limit) as Record<string, unknown>[]
    return rows.map((r) => mapResult(r))
  }

  listUrls(limit = 500, offset = 0): UrlStateRecord[] {
    const rows = this.db
      .prepare(
        `SELECT url, last_status_code, last_content_hash, last_response_time_ms,
                sitemap_lastmod, last_checked_at, consecutive_failures, has_seo
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
          run_at,
          notify_on_complete, notify_on_failure, notify_on_change, notify_on_mojibake,
          notify_on_llm_garbage,
          notify_ssl_expiring, notify_on_progress, detect_mojibake, detect_llm_garbage,
          delay_ms, max_concurrency, timeout_ms, user_agent,
          respect_robots_txt, max_urls, notification_providers, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        job.id, job.name, job.sitemapUrl,
        job.sitemapUrls ? JSON.stringify(job.sitemapUrls) : null,
        job.enabled ? 1 : 0,
        job.intervalValue, job.intervalUnit,
        job.runAt,
        job.notifyOnComplete ? 1 : 0, job.notifyOnFailure ? 1 : 0, job.notifyOnChange ? 1 : 0,
        job.notifyOnMojibake ? 1 : 0,
        job.notifyOnLlmGarbage ? 1 : 0,
        job.notifySslExpiring ? 1 : 0, job.notifyOnProgress ? 1 : 0, job.detectMojibake ? 1 : 0, job.detectLlmGarbage ? 1 : 0,
        job.delayMs, job.maxConcurrency, job.timeoutMs, job.userAgent,
        job.respectRobotsTxt ? 1 : 0, job.maxUrls,
        job.notificationProviders ? JSON.stringify(job.notificationProviders) : null,
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
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM crawls WHERE job_id = ?`).run(id)
      this.db.prepare(`DELETE FROM crawl_jobs WHERE id = ?`).run(id)
    })()
  }

  getCrawlsForJob(jobId: string, limit = 50): CrawlRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM crawls WHERE job_id = ? ORDER BY started_at DESC LIMIT ?`)
      .all(jobId, limit) as Record<string, unknown>[]
    return rows.map(mapCrawl)
  }

  exportCrawlJobs(): CrawlJob[] {
    return this.listCrawlJobs()
  }

  importCrawlJobs(jobs: CrawlJob[]): number {
    const insert = this.db.prepare(
      `INSERT INTO crawl_jobs
       (id, name, sitemap_url, sitemap_urls, enabled, interval_value, interval_unit,
        run_at,
        notify_on_complete, notify_on_failure, notify_on_change, notify_on_mojibake,
        notify_on_llm_garbage,
        notify_ssl_expiring, notify_on_progress, detect_mojibake, detect_llm_garbage,
        delay_ms, max_concurrency, timeout_ms, user_agent,
        respect_robots_txt, max_urls, notification_providers, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const now = new Date().toISOString()
    const tx = this.db.transaction(() => {
      for (const job of jobs) {
        insert.run(
          randomUUID(), job.name, job.sitemapUrl,
          job.sitemapUrls ? JSON.stringify(job.sitemapUrls) : null,
          job.enabled ? 1 : 0,
          job.intervalValue, job.intervalUnit,
          job.runAt,
          job.notifyOnComplete ? 1 : 0, job.notifyOnFailure ? 1 : 0, job.notifyOnChange ? 1 : 0,
          job.notifyOnMojibake ? 1 : 0,
          job.notifyOnLlmGarbage ? 1 : 0,
          job.notifySslExpiring ? 1 : 0, job.notifyOnProgress ? 1 : 0, job.detectMojibake ? 1 : 0, job.detectLlmGarbage ? 1 : 0,
          job.delayMs, job.maxConcurrency, job.timeoutMs, job.userAgent,
          job.respectRobotsTxt ? 1 : 0, job.maxUrls,
          job.notificationProviders ? JSON.stringify(job.notificationProviders) : null,
          now, now
        )
      }
    })
    tx()
    return jobs.length
  }

  // Monitors
  createMonitor(monitor: MonitorRecord): void {
    this.db
      .prepare(
        `INSERT INTO monitors
         (id, name, type, url, method, expected_status, expected_body,
          interval_seconds, retry_count, timeout_ms, accepted_response_time_ms,
          enabled, source, job_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        monitor.id, monitor.name, monitor.type, monitor.url, monitor.method,
        monitor.expectedStatus, monitor.expectedBody,
        monitor.intervalSeconds, monitor.retryCount, monitor.timeoutMs,
        monitor.acceptedResponseTimeMs,
        monitor.enabled ? 1 : 0, monitor.source, monitor.jobId,
        monitor.createdAt, monitor.updatedAt
      )
  }

  updateMonitor(id: string, patch: Partial<Omit<MonitorRecord, "id" | "createdAt">>): void {
    const { clauses, values } = this.buildMonitorUpdate(patch)
    if (clauses.length === 0) return
    values.push(id)
    this.db.prepare(`UPDATE monitors SET ${clauses.join(", ")} WHERE id = ?`).run(...values)
  }

  updateMonitors(ids: string[], patch: Partial<Omit<MonitorRecord, "id" | "createdAt">>): number {
    if (ids.length === 0) return 0
    const { clauses, values } = this.buildMonitorUpdate(patch)
    if (clauses.length === 0) return 0
    const placeholders = ids.map(() => "?").join(", ")
    values.push(...ids)
    const info = this.db
      .prepare(`UPDATE monitors SET ${clauses.join(", ")} WHERE id IN (${placeholders})`)
      .run(...values)
    return info.changes
  }

  deleteMonitors(ids: string[]): number {
    if (ids.length === 0) return 0
    const placeholders = ids.map(() => "?").join(", ")
    const info = this.db.prepare(`DELETE FROM monitors WHERE id IN (${placeholders})`).run(...ids)
    return info.changes
  }

  private buildMonitorUpdate(
    patch: Partial<Omit<MonitorRecord, "id" | "createdAt">>
  ): { clauses: string[]; values: unknown[] } {
    const clauses: string[] = []
    const values: unknown[] = []
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue
      const col = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)
      clauses.push(`${col} = ?`)
      if (Array.isArray(value) || (value !== null && typeof value === "object")) {
        values.push(JSON.stringify(value))
      } else if (typeof value === "boolean") {
        values.push(value ? 1 : 0)
      } else {
        values.push(value)
      }
    }
    return { clauses, values }
  }

  getMonitor(id: string): MonitorRecord | null {
    const row = this.db.prepare(`SELECT * FROM monitors WHERE id = ?`).get(id) as Record<string, unknown> | undefined
    return row ? mapMonitor(row) : null
  }

  listMonitors(): MonitorWithStatus[] {
    const rows = this.db.prepare(`SELECT * FROM monitors ORDER BY created_at DESC`).all() as Record<string, unknown>[]
    return this.toMonitorWithStatus(rows)
  }

  listMonitorDomains(): { domain: string; count: number }[] {
    const rows = this.db.prepare(`SELECT url FROM monitors`).all() as { url: string }[]
    const counts = new Map<string, number>()
    for (const row of rows) {
      const domain = deriveDomain(row.url)
      counts.set(domain, (counts.get(domain) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => a.domain.localeCompare(b.domain))
  }

  listMonitorsInDomains(domains: string[]): MonitorWithStatus[] {
    if (domains.length === 0) return []
    const allowed = new Set(domains)
    const rows = this.db.prepare(`SELECT * FROM monitors ORDER BY created_at DESC`).all() as Record<string, unknown>[]
    const filtered = rows.filter((row) => allowed.has(deriveDomain(row.url as string)))
    return this.toMonitorWithStatus(filtered)
  }

  private toMonitorWithStatus(rows: Record<string, unknown>[]): MonitorWithStatus[] {
    const latest = this.getLatestHeartbeatByMonitor()
    const recent = this.getRecentHeartbeatsByMonitor(90)
    const uptime24h = this.getUptimeByMonitor(new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    const uptime7d = this.getUptimeByMonitor(new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
    const uptime30d = this.getUptimeByMonitor(new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
    return rows.map((row) => {
      const monitor = mapMonitor(row)
      const hb = latest.get(monitor.id) ?? null
      return {
        ...monitor,
        latestHeartbeat: hb,
        currentStatus: hb?.status ?? null,
        recentHeartbeats: recent.get(monitor.id) ?? [],
        uptime24h: uptime24h.get(monitor.id) ?? null,
        uptime7d: uptime7d.get(monitor.id) ?? null,
        uptime30d: uptime30d.get(monitor.id) ?? null
      }
    })
  }

  listEnabledMonitors(): MonitorRecord[] {
    const rows = this.db.prepare(`SELECT * FROM monitors WHERE enabled = 1`).all() as Record<string, unknown>[]
    return rows.map(mapMonitor)
  }

  listMonitorsForJob(jobId: string): MonitorRecord[] {
    const rows = this.db.prepare(`SELECT * FROM monitors WHERE job_id = ?`).all(jobId) as Record<string, unknown>[]
    return rows.map(mapMonitor)
  }

  deleteMonitor(id: string): void {
    this.db.prepare(`DELETE FROM monitors WHERE id = ?`).run(id)
  }

  upsertMonitorByUrl(
    url: string,
    patch: Partial<Omit<MonitorRecord, "id" | "createdAt">>
  ): MonitorRecord | null {
    const existing = this.db
      .prepare(`SELECT * FROM monitors WHERE url = ? LIMIT 1`)
      .get(url) as Record<string, unknown> | undefined
    const now = new Date().toISOString()
    if (existing) {
      const monitor = mapMonitor(existing)
      this.updateMonitor(monitor.id, { ...patch, updatedAt: now })
      return this.getMonitor(monitor.id)
    }
    const monitor: MonitorRecord = {
      name: deriveMonitorName(url),
      type: "http",
      url,
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
      ...patch,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now
    }
    this.createMonitor(monitor)
    return monitor
  }

  // Heartbeats
  insertHeartbeat(h: Heartbeat): void {
    this.db
      .prepare(
        `INSERT INTO heartbeats (id, monitor_id, status, response_time_ms, message, checked_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(h.id, h.monitorId, h.status, h.responseTimeMs, h.message, h.checkedAt)
  }

  getLatestHeartbeat(monitorId: string): Heartbeat | null {
    const row = this.db
      .prepare(`SELECT * FROM heartbeats WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 1`)
      .get(monitorId) as Record<string, unknown> | undefined
    return row ? mapHeartbeat(row) : null
  }

  private getLatestHeartbeatByMonitor(): Map<string, Heartbeat> {
    const rows = this.db
      .prepare(
        `SELECT h.* FROM heartbeats h
         JOIN (SELECT monitor_id, MAX(checked_at) AS max_at FROM heartbeats GROUP BY monitor_id) t
           ON h.monitor_id = t.monitor_id AND h.checked_at = t.max_at`
      )
      .all() as Record<string, unknown>[]
    return new Map(rows.map((r) => [r.monitor_id as string, mapHeartbeat(r)]))
  }

  private getRecentHeartbeatsByMonitor(limit: number): Map<string, Heartbeat[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM (
           SELECT h.*, ROW_NUMBER() OVER (PARTITION BY monitor_id ORDER BY checked_at DESC) AS rn
           FROM heartbeats h
         ) WHERE rn <= ?`
      )
      .all(limit) as (Record<string, unknown> & { rn: number })[]
    const byMonitor = new Map<string, Heartbeat[]>()
    for (const row of rows) {
      const monitorId = row.monitor_id as string
      if (!byMonitor.has(monitorId)) byMonitor.set(monitorId, [])
      byMonitor.get(monitorId)!.push(mapHeartbeat(row))
    }
    for (const list of byMonitor.values()) list.reverse()
    return byMonitor
  }

  listHeartbeats(monitorId: string, limit = 100): Heartbeat[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM heartbeats WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT ?`
      )
      .all(monitorId, limit) as Record<string, unknown>[]
    return rows.map(mapHeartbeat)
  }

  listHeartbeatsSince(monitorId: string, sinceIso: string): Heartbeat[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM heartbeats WHERE monitor_id = ? AND checked_at >= ? ORDER BY checked_at ASC`
      )
      .all(monitorId, sinceIso) as Record<string, unknown>[]
    return rows.map(mapHeartbeat)
  }

  pruneHeartbeats(olderThanIso: string): number {
    const info = this.db.prepare(`DELETE FROM heartbeats WHERE checked_at < ?`).run(olderThanIso)
    return info.changes
  }

  // Uptime
  private getUptimeByMonitor(sinceIso: string): Map<string, number> {
    const rows = this.db
      .prepare(
        `SELECT monitor_id,
                SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) AS up_count,
                COUNT(*) AS total
         FROM heartbeats WHERE checked_at >= ?
         GROUP BY monitor_id`
      )
      .all(sinceIso) as { monitor_id: string; up_count: number; total: number }[]
    return new Map(
      rows
        .filter((r) => r.total > 0)
        .map((r) => [r.monitor_id, Math.round((r.up_count / r.total) * 1000) / 10])
    )
  }

  getUptimeForPeriod(monitorId: string, sinceIso: string): number | null {
    const row = this.db
      .prepare(
        `SELECT SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) AS up_count, COUNT(*) AS total
         FROM heartbeats WHERE monitor_id = ? AND checked_at >= ?`
      )
      .get(monitorId, sinceIso) as { up_count: number; total: number } | undefined
    if (!row || row.total === 0) return null
    return Math.round((row.up_count / row.total) * 1000) / 10
  }

  getMonitorStats(monitorId: string): MonitorStats {
    const day = 24 * 3600 * 1000
    const rtRow = this.db
      .prepare(
        `SELECT AVG(response_time_ms) AS avg_rt, MIN(response_time_ms) AS min_rt, MAX(response_time_ms) AS max_rt
         FROM heartbeats WHERE monitor_id = ? AND response_time_ms IS NOT NULL AND checked_at >= ?`
      )
      .get(monitorId, new Date(Date.now() - 30 * day).toISOString()) as
      | { avg_rt: number | null; min_rt: number | null; max_rt: number | null }
      | undefined
    return {
      uptime24h: this.getUptimeForPeriod(monitorId, new Date(Date.now() - 1 * day).toISOString()),
      uptime7d: this.getUptimeForPeriod(monitorId, new Date(Date.now() - 7 * day).toISOString()),
      uptime30d: this.getUptimeForPeriod(monitorId, new Date(Date.now() - 30 * day).toISOString()),
      uptime365d: this.getUptimeForPeriod(monitorId, new Date(Date.now() - 365 * day).toISOString()),
      avgResponseTimeMs: rtRow?.avg_rt != null ? Math.round(rtRow.avg_rt) : null,
      minResponseTimeMs: rtRow?.min_rt != null ? Math.round(rtRow.min_rt) : null,
      maxResponseTimeMs: rtRow?.max_rt != null ? Math.round(rtRow.max_rt) : null
    }
  }

  // Status pages
  createStatusPage(page: StatusPageRecord): void {
    this.db
      .prepare(
        `INSERT INTO status_pages (id, slug, title, description, show_response_times, public, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(page.id, page.slug, page.title, page.description, page.showResponseTimes ? 1 : 0, page.public ? 1 : 0, page.createdAt)
  }

  listStatusPages(): StatusPageRecord[] {
    const rows = this.db.prepare(`SELECT * FROM status_pages ORDER BY created_at DESC`).all() as Record<string, unknown>[]
    return rows.map(mapStatusPage)
  }

  getStatusPage(id: string): StatusPageRecord | null {
    const row = this.db.prepare(`SELECT * FROM status_pages WHERE id = ?`).get(id) as Record<string, unknown> | undefined
    return row ? mapStatusPage(row) : null
  }

  getStatusPageBySlug(slug: string): StatusPageRecord | null {
    const row = this.db.prepare(`SELECT * FROM status_pages WHERE slug = ?`).get(slug) as Record<string, unknown> | undefined
    return row ? mapStatusPage(row) : null
  }

  updateStatusPage(id: string, patch: Partial<Omit<StatusPageRecord, "id" | "createdAt">>): void {
    const fields: string[] = []
    const values: unknown[] = []
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue
      const col = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)
      fields.push(`${col} = ?`)
      if (typeof value === "boolean") values.push(value ? 1 : 0)
      else values.push(value)
    }
    if (fields.length === 0) return
    values.push(id)
    this.db.prepare(`UPDATE status_pages SET ${fields.join(", ")} WHERE id = ?`).run(...values)
  }

  deleteStatusPage(id: string): void {
    this.db.prepare(`DELETE FROM status_pages WHERE id = ?`).run(id)
  }

  setStatusPageMonitors(statusPageId: string, monitorIds: string[]): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM status_page_monitors WHERE status_page_id = ?`).run(statusPageId)
      const insert = this.db.prepare(
        `INSERT INTO status_page_monitors (status_page_id, monitor_id, sort_order) VALUES (?, ?, ?)`
      )
      monitorIds.forEach((monitorId, i) => insert.run(statusPageId, monitorId, i))
    })
    tx()
  }

  getStatusPageMonitors(statusPageId: string): MonitorWithStatus[] {
    const rows = this.db
      .prepare(
        `SELECT m.* FROM status_page_monitors spm
         JOIN monitors m ON m.id = spm.monitor_id
         WHERE spm.status_page_id = ?
         ORDER BY spm.sort_order ASC`
      )
      .all(statusPageId) as Record<string, unknown>[]
    const latest = this.getLatestHeartbeatByMonitor()
    const recent = this.getRecentHeartbeatsByMonitor(90)
    const uptime24h = this.getUptimeByMonitor(new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    return rows.map((row) => {
      const monitor = mapMonitor(row)
      const hb = latest.get(monitor.id) ?? null
      return {
        ...monitor,
        latestHeartbeat: hb,
        currentStatus: hb?.status ?? null,
        recentHeartbeats: recent.get(monitor.id) ?? [],
        uptime24h: uptime24h.get(monitor.id) ?? null,
        uptime7d: null,
        uptime30d: null
      }
    })
  }

  // Maintenance windows
  createMaintenanceWindow(w: MaintenanceWindowRecord): void {
    this.db
      .prepare(
        `INSERT INTO maintenance_windows (id, monitor_id, title, description, start_at, end_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(w.id, w.monitorId, w.title, w.description, w.startAt, w.endAt, w.createdAt)
  }

  listMaintenanceWindowsForMonitor(monitorId: string): MaintenanceWindowRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM maintenance_windows WHERE monitor_id = ? ORDER BY start_at DESC`)
      .all(monitorId) as Record<string, unknown>[]
    return rows.map(mapMaintenanceWindow)
  }

  hasActiveMaintenanceWindow(monitorId: string, atIso: string): boolean {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM maintenance_windows
         WHERE monitor_id = ? AND start_at <= ? AND end_at >= ?`
      )
      .get(monitorId, atIso, atIso) as { c: number }
    return row.c > 0
  }

  deleteMaintenanceWindow(id: string): void {
    this.db.prepare(`DELETE FROM maintenance_windows WHERE id = ?`).run(id)
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

  getCrawlSummary(crawlId: string): CrawlSummary | null {
    const crawl = this.getCrawl(crawlId)
    if (!crawl) return null
    const results = this.listResults(crawlId)

    const broken: CrawlSummaryIssue[] = results
      .filter((r) => r.statusCode !== null && r.statusCode >= 400)
      .map((r) => ({
        url: r.url,
        detail: r.error ?? `HTTP ${r.statusCode}`,
        severity: "high" as const
      }))

    const changed: CrawlSummaryIssue[] = results
      .filter((r) => r.contentChanged)
      .map((r) => ({
        url: r.url,
        detail: "Content changed since last crawl",
        severity: "medium" as const
      }))

    const sslExpiring: CrawlSummaryIssue[] = results
      .filter((r) => {
        if (!r.sslValidUntil) return false
        const days = Math.floor(
          (Date.parse(r.sslValidUntil) - Date.now()) / 86400000
        )
        return days >= 0 && days < 30
      })
      .map((r) => ({
        url: r.url,
        detail: `SSL expires ${r.sslValidUntil!.slice(0, 10)}`,
        severity: "medium" as const
      }))

    const mojibake: CrawlSummaryIssue[] = results
      .filter((r) => r.mojibakeFlagged)
      .map((r) => ({
        url: r.url,
        detail: r.mojibakeScore !== null
          ? `Text garbled (confidence: ${Math.round(r.mojibakeScore * 100)}%)`
          : "Text may be garbled",
        severity: "low" as const
      }))

    const llmGarbage: CrawlSummaryIssue[] = results
      .filter((r) => r.llmGarbageFlagged)
      .map((r) => ({
        url: r.url,
        detail: r.llmGarbageScore !== null
          ? `LLM artifact detected (confidence: ${Math.round(r.llmGarbageScore * 100)}%)`
          : "Possible LLM garbage",
        severity: "low" as const
      }))

    const responseTimes = results
      .map((r) => r.responseTimeMs)
      .filter((t): t is number => t !== null)

    const durationMs =
      crawl.finishedAt && crawl.startedAt
        ? Math.round(Date.parse(crawl.finishedAt) - Date.parse(crawl.startedAt))
        : null

    const checkedCount = results.length
    const totalBroken = broken.length
    const healthScore =
      checkedCount > 0
        ? Math.round(((checkedCount - totalBroken) / checkedCount) * 100)
        : 100

    return {
      crawlId: crawl.id,
      jobName: undefined, // filled in route if needed
      status: crawl.status,
      startedAt: crawl.startedAt,
      finishedAt: crawl.finishedAt,
      durationMs,
      totalUrls: crawl.urlsTotal,
      checkedUrls: checkedCount,
      healthScore,
      avgResponseTimeMs:
        responseTimes.length > 0
          ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
          : null,
      slowestResponseTimeMs:
        responseTimes.length > 0 ? Math.max(...responseTimes) : null,
      fastestResponseTimeMs:
        responseTimes.length > 0 ? Math.min(...responseTimes) : null,
      issues: { broken, changed, sslExpiring, mojibake, llmGarbage }
    }
  }

  cleanupStaleCrawls(): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE crawls SET status = 'failed', finished_at = ?, error_message = ? WHERE status = 'running'`
      )
      .run(now, "Server was restarted")
  }

  getUserNotificationSettings(userId: string): UserNotificationSettings | null {
    const row = this.db
      .prepare(`SELECT * FROM user_notification_settings WHERE user_id = ?`)
      .get(userId) as Record<string, unknown> | undefined
    if (!row) return null
    return mapUserNotificationSettings(row)
  }

  getUserEmail(userId: string): string | null {
    const row = this.db
      .prepare(`SELECT email FROM user WHERE id = ?`)
      .get(userId) as { email?: string } | undefined
    return row?.email ?? null
  }

  upsertUserNotificationSettings(
    userId: string,
    settings: Omit<UserNotificationSettings, "userId" | "updatedAt">
  ): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO user_notification_settings
         (user_id, slack, telegram, email, webhook, enabled_events, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           slack = excluded.slack,
           telegram = excluded.telegram,
           email = excluded.email,
           webhook = excluded.webhook,
           enabled_events = excluded.enabled_events,
           updated_at = excluded.updated_at`
      )
      .run(
        userId,
        JSON.stringify(settings.slack),
        JSON.stringify(settings.telegram),
        JSON.stringify(settings.email),
        JSON.stringify(settings.webhook),
        JSON.stringify(settings.enabledEvents),
        now
      )
  }

  listUserNotificationSettings(): UserNotificationSettings[] {
    const rows = this.db
      .prepare(`SELECT * FROM user_notification_settings`)
      .all() as Record<string, unknown>[]
    return rows.map(mapUserNotificationSettings)
  }

  deleteUserNotificationSettings(userId: string): void {
    this.db
      .prepare(`DELETE FROM user_notification_settings WHERE user_id = ?`)
      .run(userId)
  }

  insertResourceSnapshot(snapshot: Omit<ResourceSnapshot, "id">): void {
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO resource_snapshots (id, rss_mb, heap_total_mb, heap_used_mb, external_mb, cpu_percent, disk_used_mb, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, snapshot.rssMb, snapshot.heapTotalMb, snapshot.heapUsedMb, snapshot.externalMb, snapshot.cpuPercent, snapshot.diskUsedMb, snapshot.recordedAt)
  }

  getResourceSnapshots(since: string): ResourceSnapshot[] {
    const rows = this.db
      .prepare(`SELECT * FROM resource_snapshots WHERE recorded_at >= ? ORDER BY recorded_at ASC`)
      .all(since) as Record<string, unknown>[]
    return rows.map(mapResourceSnapshot)
  }

  getLatestResourceSnapshot(): ResourceSnapshot | null {
    const row = this.db
      .prepare(`SELECT * FROM resource_snapshots ORDER BY recorded_at DESC LIMIT 1`)
      .get() as Record<string, unknown> | undefined
    if (!row) return null
    return mapResourceSnapshot(row)
  }

  purgeOldResourceSnapshots(before: string): number {
    const result = this.db
      .prepare(`DELETE FROM resource_snapshots WHERE recorded_at < ?`)
      .run(before)
    return result.changes
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
  let notificationProviders: CrawlJob["notificationProviders"] = null
  if (typeof row.notification_providers === "string") {
    try {
      const parsed = JSON.parse(row.notification_providers)
      if (parsed && typeof parsed === "object") notificationProviders = parsed
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
    runAt: (row.run_at as string | null) ?? null,
    notifyOnComplete: row.notify_on_complete === 1,
    notifyOnFailure: row.notify_on_failure === 1,
    notifyOnChange: row.notify_on_change === 1,
    notifyOnMojibake: row.notify_on_mojibake === 1,
    notifyOnLlmGarbage: row.notify_on_llm_garbage === 1,
    notifySslExpiring: row.notify_ssl_expiring !== 0,
    notifyOnProgress: row.notify_on_progress === 1,
    detectMojibake: row.detect_mojibake !== 0,
    detectLlmGarbage: row.detect_llm_garbage !== 0,
    delayMs: row.delay_ms as number,
    maxConcurrency: row.max_concurrency as number,
    timeoutMs: row.timeout_ms as number,
    userAgent: row.user_agent as string,
    respectRobotsTxt: row.respect_robots_txt === 1,
    maxUrls: row.max_urls as number,
    maxBodyBytes: (row.max_body_bytes as number) ?? 5 * 1024 * 1024,
    notificationProviders,
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

function mapResult(row: Record<string, unknown>, opts?: { includeSeo?: boolean }): CrawlResultRecord {
  const includeSeo = opts?.includeSeo !== false
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
    finalUrl: (row.final_url as string | null) ?? null,
    sslValidUntil: (row.ssl_valid_until as string | null) ?? null,
    sitemapLastmod: (row.sitemap_lastmod as string | null) ?? null,
    checkedAt: row.checked_at as string,
    checkMethod: row.check_method as CrawlResultRecord["checkMethod"],
    mojibakeScore: (row.mojibake_score as number | null) ?? null,
    mojibakeFlagged: row.mojibake_flagged === 1,
    mojibakeSample: (row.mojibake_sample as string | null) ?? null,
    llmGarbageScore: (row.llm_garbage_score as number | null) ?? null,
    llmGarbageFlagged: row.llm_garbage_flagged === 1,
    llmGarbageSample: (row.llm_garbage_sample as string | null) ?? null,
    seo: includeSeo ? parseSeo(row.seo) : null
  }
}

function parseSeo(val: unknown): SeoInfo | null {
  if (typeof val !== "string" || val.length === 0) return null
  try {
    const parsed = JSON.parse(val) as unknown
    if (!parsed || typeof parsed !== "object") return null
    return parsed as SeoInfo
  } catch {
    return null
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
    consecutiveFailures: (row.consecutive_failures as number) ?? 0,
    hasSeo: row.has_seo === 1
  }
}

function mapUserNotificationSettings(row: Record<string, unknown>): UserNotificationSettings {
  const parseJson = (val: unknown, fallback: unknown): unknown => {
    if (typeof val === "string") {
      try { return JSON.parse(val) } catch { /* ignore */ }
    }
    return fallback
  }
  return {
    userId: row.user_id as string,
    slack: parseJson(row.slack, { enabled: false }) as UserNotificationSettings["slack"],
    telegram: parseJson(row.telegram, { enabled: false }) as UserNotificationSettings["telegram"],
    email: parseJson(row.email, { enabled: false }) as UserNotificationSettings["email"],
    webhook: parseJson(row.webhook, { enabled: false }) as UserNotificationSettings["webhook"],
    enabledEvents: parseJson(row.enabled_events, {
      onCrawlFailure: false,
      onContentChange: false,
      onSslExpiring: false,
      onCrawlComplete: false,
      onMojibakeDetected: false,
      onLlmGarbageDetected: false,
      onCrawlProgress: false,
      onMonitorDown: false,
      onMonitorRecovery: false
    }) as UserNotificationSettings["enabledEvents"],
    updatedAt: row.updated_at as string
  }
}

function mapMonitor(row: Record<string, unknown>): MonitorRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    type: row.type as MonitorRecord["type"],
    url: row.url as string,
    method: row.method as string,
    expectedStatus: (row.expected_status as number) ?? 200,
    expectedBody: (row.expected_body as string | null) ?? null,
    intervalSeconds: (row.interval_seconds as number) ?? 60,
    retryCount: (row.retry_count as number) ?? 3,
    timeoutMs: (row.timeout_ms as number) ?? 10000,
    acceptedResponseTimeMs: (row.accepted_response_time_ms as number) ?? 5000,
    enabled: row.enabled === 1,
    source: row.source as MonitorRecord["source"],
    jobId: (row.job_id as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

function mapHeartbeat(row: Record<string, unknown>): Heartbeat {
  return {
    id: row.id as string,
    monitorId: row.monitor_id as string,
    status: row.status as HeartbeatStatus,
    responseTimeMs: (row.response_time_ms as number | null) ?? null,
    message: (row.message as string | null) ?? null,
    checkedAt: row.checked_at as string
  }
}

function mapStatusPage(row: Record<string, unknown>): StatusPageRecord {
  return {
    id: row.id as string,
    slug: row.slug as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    showResponseTimes: row.show_response_times === 1,
    public: row.public !== 0,
    createdAt: row.created_at as string
  }
}

function mapMaintenanceWindow(row: Record<string, unknown>): MaintenanceWindowRecord {
  return {
    id: row.id as string,
    monitorId: row.monitor_id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    startAt: row.start_at as string,
    endAt: row.end_at as string,
    createdAt: row.created_at as string
  }
}

function deriveMonitorName(url: string): string {
  try {
    const u = new URL(url)
    return `${u.hostname}${u.pathname === "/" ? "" : u.pathname}`
  } catch {
    return url
  }
}

function deriveDomain(url: string): string {
  try {
    return new URL(url).hostname || "unknown"
  } catch {
    return "unknown"
  }
}

function mapResourceSnapshot(row: Record<string, unknown>): ResourceSnapshot {
  return {
    id: row.id as string,
    rssMb: (row.rss_mb as number) ?? 0,
    heapTotalMb: (row.heap_total_mb as number) ?? 0,
    heapUsedMb: (row.heap_used_mb as number) ?? 0,
    externalMb: (row.external_mb as number) ?? 0,
    cpuPercent: (row.cpu_percent as number) ?? 0,
    diskUsedMb: (row.disk_used_mb as number) ?? 0,
    recordedAt: row.recorded_at as string
  }
}
