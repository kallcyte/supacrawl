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
  SeoInfo,
  StatusPageMonitor,
  StatusPageRecord,
  UrlStateRecord,
  UserNotificationSettings
} from "@supacrawl/core"

export interface D1StorageOptions {
  db: D1Database
}

/**
 * D1-backed storage adapter for Cloudflare Workers.
 * Mirrors the API of the original `Storage` class but all methods are async
 * and use D1's prepare/bind pattern instead of better-sqlite3 sync calls.
 */
export class Storage {
  constructor(private opts: D1StorageOptions) {}

  private get db(): D1Database {
    return this.opts.db
  }

  // ─── Crawls ────────────────────────────────────────────────────────

  async createCrawl(record: CrawlRecord, jobId?: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO crawls (id, started_at, status, urls_total, job_id)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(record.id, record.startedAt, record.status, record.urlsTotal, jobId ?? null)
      .run()
  }

  async updateCrawl(
    id: string,
    patch: Partial<
      Pick<
        CrawlRecord,
        | "finishedAt" | "status" | "urlsTotal" | "urlsChecked"
        | "urlsChanged" | "urlsBroken" | "urlsSkipped" | "errorMessage"
      >
    >
  ): Promise<void> {
    const fields: string[] = []
    const values: unknown[] = []
    if (patch.finishedAt !== undefined) { fields.push("finished_at = ?"); values.push(patch.finishedAt) }
    if (patch.status !== undefined) { fields.push("status = ?"); values.push(patch.status) }
    if (patch.urlsTotal !== undefined) { fields.push("urls_total = ?"); values.push(patch.urlsTotal) }
    if (patch.urlsChecked !== undefined) { fields.push("urls_checked = ?"); values.push(patch.urlsChecked) }
    if (patch.urlsChanged !== undefined) { fields.push("urls_changed = ?"); values.push(patch.urlsChanged) }
    if (patch.urlsBroken !== undefined) { fields.push("urls_broken = ?"); values.push(patch.urlsBroken) }
    if (patch.urlsSkipped !== undefined) { fields.push("urls_skipped = ?"); values.push(patch.urlsSkipped) }
    if (patch.errorMessage !== undefined) { fields.push("error_message = ?"); values.push(patch.errorMessage) }
    if (fields.length === 0) return
    values.push(id)
    await this.db.prepare(`UPDATE crawls SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run()
  }

  async getCrawl(id: string): Promise<CrawlRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT id, started_at, finished_at, status, urls_total, urls_checked,
                urls_changed, urls_broken, urls_skipped, error_message
         FROM crawls WHERE id = ?`
      )
      .bind(id)
      .first<Record<string, unknown>>()
    return row ? mapCrawl(row) : null
  }

  async deleteCrawl(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM crawl_results WHERE crawl_id = ?").bind(id).run()
    await this.db.prepare("DELETE FROM crawls WHERE id = ?").bind(id).run()
  }

  async listCrawls(limit = 50, offset = 0): Promise<CrawlRecord[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, started_at, finished_at, status, urls_total, urls_checked,
                urls_changed, urls_broken, urls_skipped, error_message
         FROM crawls ORDER BY started_at DESC LIMIT ? OFFSET ?`
      )
      .bind(limit, offset)
      .all<Record<string, unknown>>()
    return (results ?? []).map(mapCrawl)
  }

  // ─── Results ───────────────────────────────────────────────────────

  async insertResult(r: CrawlResultRecord): Promise<void> {
    const stmts: D1PreparedStatement[] = []
    stmts.push(
      this.db.prepare(
        `INSERT INTO crawl_results
         (id, crawl_id, url, status_code, response_time_ms, content_hash,
          content_changed, error, redirect_chain, ssl_valid_until,
          sitemap_lastmod, checked_at, check_method, mojibake_score, mojibake_flagged,
          llm_garbage_score, llm_garbage_flagged)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        r.id, r.crawlId, r.url, r.statusCode, r.responseTimeMs, r.contentHash,
        r.contentChanged ? 1 : 0, r.error, r.redirectChain, r.sslValidUntil,
        r.sitemapLastmod, r.checkedAt, r.checkMethod,
        r.mojibakeScore, r.mojibakeFlagged ? 1 : 0,
        r.llmGarbageScore, r.llmGarbageFlagged ? 1 : 0
      )
    )
    if (r.seo) {
      stmts.push(
        this.db.prepare(
          `INSERT INTO crawl_results_seo
           (result_id, title, title_length, description, description_length,
            canonical, canonical_self_reference, noindex, nofollow,
            h1_count, word_count, page_weight_bytes, json_ld_types,
            og_title, og_description, og_image, published_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(result_id) DO UPDATE SET
             title = excluded.title, title_length = excluded.title_length,
             description = excluded.description, description_length = excluded.description_length,
             canonical = excluded.canonical, canonical_self_reference = excluded.canonical_self_reference,
             noindex = excluded.noindex, nofollow = excluded.nofollow,
             h1_count = excluded.h1_count, word_count = excluded.word_count,
             page_weight_bytes = excluded.page_weight_bytes, json_ld_types = excluded.json_ld_types,
             og_title = excluded.og_title, og_description = excluded.og_description,
             og_image = excluded.og_image, published_at = excluded.published_at`
        ).bind(
          r.id,
          r.seo.title, r.seo.titleLength,
          r.seo.description, r.seo.descriptionLength,
          r.seo.canonical, r.seo.canonicalSelfReference ? 1 : 0,
          r.seo.noindex ? 1 : 0, r.seo.nofollow ? 1 : 0,
          r.seo.h1Count, r.seo.wordCount, r.seo.pageWeightBytes,
          r.seo.jsonLdTypes.length > 0 ? JSON.stringify(r.seo.jsonLdTypes) : null,
          r.seo.ogTitle, r.seo.ogDescription, r.seo.ogImage,
          r.seo.publishedAt
        )
      )
    }
    await this.db.batch(stmts)
  }

  async listResults(
    crawlId: string,
    filter?: { brokenOnly?: boolean; changedOnly?: boolean; mojibakeOnly?: boolean; llmGarbageOnly?: boolean },
    opts?: { includeSeo?: boolean }
  ): Promise<CrawlResultRecord[]> {
    const includeSeo = opts?.includeSeo !== false
    let sql = `SELECT id, crawl_id, url, status_code, response_time_ms, content_hash,
                      content_changed, error, redirect_chain, ssl_valid_until,
                      sitemap_lastmod, checked_at, check_method, mojibake_score, mojibake_flagged,
                      llm_garbage_score, llm_garbage_flagged
               FROM crawl_results WHERE crawl_id = ?`
    const params: unknown[] = [crawlId]
    if (filter?.brokenOnly) { sql += ` AND (status_code >= 400 OR status_code IS NULL)` }
    if (filter?.changedOnly) { sql += ` AND content_changed = 1` }
    if (filter?.mojibakeOnly) { sql += ` AND mojibake_flagged = 1` }
    if (filter?.llmGarbageOnly) { sql += ` AND llm_garbage_flagged = 1` }
    sql += ` ORDER BY checked_at ASC`

    const { results: rows } = await this.db.prepare(sql).bind(...params).all<Record<string, unknown>>()
    const base = (rows ?? []).map((r) => mapResult(r, { includeSeo: false }))

    if (includeSeo && base.length > 0) {
      const ids = base.map((r) => r.id)
      const placeholders = ids.map(() => "?").join(", ")
      const { results: seoRows } = await this.db
        .prepare(`SELECT * FROM crawl_results_seo WHERE result_id IN (${placeholders})`)
        .bind(...ids)
        .all<Record<string, unknown>>()
      const seoMap = new Map<string, SeoInfo | null>()
      for (const s of (seoRows ?? [])) {
        seoMap.set(s.result_id as string, parseSeoFromRow(s))
      }
      for (const r of base) {
        r.seo = seoMap.get(r.id) ?? null
      }
    }
    return base
  }

  async getResult(id: string): Promise<CrawlResultRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT id, crawl_id, url, status_code, response_time_ms, content_hash,
                content_changed, error, redirect_chain, ssl_valid_until,
                sitemap_lastmod, checked_at, check_method, mojibake_score, mojibake_flagged,
                llm_garbage_score, llm_garbage_flagged
         FROM crawl_results WHERE id = ?`
      )
      .bind(id)
      .first<Record<string, unknown>>()
    if (!row) return null
    const result = mapResult(row, { includeSeo: false })
    const seoRow = await this.db
      .prepare(`SELECT * FROM crawl_results_seo WHERE result_id = ?`)
      .bind(id)
      .first<Record<string, unknown>>()
    result.seo = seoRow ? parseSeoFromRow(seoRow) : null
    return result
  }

  // ─── URL state ─────────────────────────────────────────────────────

  async upsertUrlState(s: UrlStateRecord): Promise<void> {
    await this.db
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
      .bind(
        s.url, s.lastStatusCode, s.lastContentHash, s.lastResponseTimeMs,
        s.sitemapLastmod, s.lastCheckedAt, s.consecutiveFailures, s.hasSeo ? 1 : 0
      )
      .run()
  }

  async getUrlState(url: string): Promise<UrlStateRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT url, last_status_code, last_content_hash, last_response_time_ms,
                sitemap_lastmod, last_checked_at, consecutive_failures, has_seo
         FROM url_state WHERE url = ?`
      )
      .bind(url)
      .first<Record<string, unknown>>()
    return row ? mapUrlState(row) : null
  }

  async getAllUrlStates(): Promise<UrlStateRecord[]> {
    const { results } = await this.db
      .prepare(
        `SELECT url, last_status_code, last_content_hash, last_response_time_ms,
                sitemap_lastmod, last_checked_at, consecutive_failures, has_seo
         FROM url_state`
      )
      .all<Record<string, unknown>>()
    return (results ?? []).map(mapUrlState)
  }

  async getUrlHistory(url: string, limit = 100): Promise<CrawlResultRecord[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, crawl_id, url, status_code, response_time_ms, content_hash,
                content_changed, error, redirect_chain, ssl_valid_until,
                sitemap_lastmod, checked_at, check_method, mojibake_score, mojibake_flagged,
                llm_garbage_score, llm_garbage_flagged
         FROM crawl_results WHERE url = ?
         ORDER BY checked_at DESC LIMIT ?`
      )
      .bind(url, limit)
      .all<Record<string, unknown>>()
    return (results ?? []).map((r) => mapResult(r, { includeSeo: false }))
  }

  async listUrls(limit = 500, offset = 0): Promise<UrlStateRecord[]> {
    const { results } = await this.db
      .prepare(
        `SELECT url, last_status_code, last_content_hash, last_response_time_ms,
                sitemap_lastmod, last_checked_at, consecutive_failures, has_seo
         FROM url_state ORDER BY last_checked_at DESC LIMIT ? OFFSET ?`
      )
      .bind(limit, offset)
      .all<Record<string, unknown>>()
    return (results ?? []).map(mapUrlState)
  }

  // ─── Settings KV ───────────────────────────────────────────────────

  async getSetting(key: string): Promise<string | null> {
    const row = await this.db
      .prepare(`SELECT value FROM settings WHERE key = ?`)
      .bind(key)
      .first<{ value: string }>()
    return row?.value ?? null
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .bind(key, value)
      .run()
  }

  // ─── Crawl Jobs ────────────────────────────────────────────────────

  async listCrawlJobs(): Promise<CrawlJob[]> {
    const { results } = await this.db
      .prepare(`SELECT * FROM crawl_jobs ORDER BY created_at DESC`)
      .all<Record<string, unknown>>()
    return (results ?? []).map(mapCrawlJob)
  }

  async getCrawlJob(id: string): Promise<CrawlJob | null> {
    const row = await this.db
      .prepare(`SELECT * FROM crawl_jobs WHERE id = ?`)
      .bind(id)
      .first<Record<string, unknown>>()
    return row ? mapCrawlJob(row) : null
  }

  async createCrawlJob(job: CrawlJob): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO crawl_jobs
         (id, name, sitemap_url, sitemap_urls, enabled, interval_value, interval_unit,
          run_at, notify_on_complete, notify_on_failure, notify_on_change, notify_on_mojibake,
          notify_on_llm_garbage, notify_ssl_expiring, notify_on_progress, detect_mojibake,
          detect_llm_garbage, delay_ms, max_concurrency, timeout_ms, user_agent,
          respect_robots_txt, max_urls, notification_providers, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        job.id, job.name, job.sitemapUrl,
        job.sitemapUrls ? JSON.stringify(job.sitemapUrls) : null,
        job.enabled ? 1 : 0, job.intervalValue, job.intervalUnit,
        job.runAt,
        job.notifyOnComplete ? 1 : 0, job.notifyOnFailure ? 1 : 0, job.notifyOnChange ? 1 : 0,
        job.notifyOnMojibake ? 1 : 0, job.notifyOnLlmGarbage ? 1 : 0,
        job.notifySslExpiring ? 1 : 0, job.notifyOnProgress ? 1 : 0,
        job.detectMojibake ? 1 : 0, job.detectLlmGarbage ? 1 : 0,
        job.delayMs, job.maxConcurrency, job.timeoutMs, job.userAgent,
        job.respectRobotsTxt ? 1 : 0, job.maxUrls,
        job.notificationProviders ? JSON.stringify(job.notificationProviders) : null,
        job.createdAt, job.updatedAt
      )
      .run()
  }

  async updateCrawlJob(id: string, patch: Partial<CrawlJob>): Promise<void> {
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
    if (fields.length === 0) return
    values.push(id)
    await this.db.prepare(`UPDATE crawl_jobs SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run()
  }

  async deleteCrawlJob(id: string): Promise<void> {
    await this.db.batch([
      this.db.prepare(`DELETE FROM crawls WHERE job_id = ?`).bind(id),
      this.db.prepare(`DELETE FROM crawl_jobs WHERE id = ?`).bind(id),
    ])
  }

  async getCrawlsForJob(jobId: string, limit = 50): Promise<CrawlRecord[]> {
    const { results } = await this.db
      .prepare(`SELECT * FROM crawls WHERE job_id = ? ORDER BY started_at DESC LIMIT ?`)
      .bind(jobId, limit)
      .all<Record<string, unknown>>()
    return (results ?? []).map(mapCrawl)
  }

  async importCrawlJobs(jobs: CrawlJob[]): Promise<number> {
    const now = new Date().toISOString()
    const stmts: D1PreparedStatement[] = []
    for (const job of jobs) {
      stmts.push(
        this.db.prepare(
          `INSERT INTO crawl_jobs
           (id, name, sitemap_url, sitemap_urls, enabled, interval_value, interval_unit,
            run_at,
            notify_on_complete, notify_on_failure, notify_on_change, notify_on_mojibake,
            notify_on_llm_garbage,
            notify_ssl_expiring, notify_on_progress, detect_mojibake, detect_llm_garbage,
            delay_ms, max_concurrency, timeout_ms, user_agent,
            respect_robots_txt, max_urls, max_body_bytes, notification_providers, created_at, updated_at,
            last_run_at, last_run_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          crypto.randomUUID(), job.name, job.sitemapUrl,
          job.sitemapUrls ? JSON.stringify(job.sitemapUrls) : null,
          job.enabled ? 1 : 0,
          job.intervalValue, job.intervalUnit,
          job.runAt,
          job.notifyOnComplete ? 1 : 0, job.notifyOnFailure ? 1 : 0, job.notifyOnChange ? 1 : 0,
          job.notifyOnMojibake ? 1 : 0,
          job.notifyOnLlmGarbage ? 1 : 0,
          job.notifySslExpiring ? 1 : 0, job.notifyOnProgress ? 1 : 0,
          job.detectMojibake ? 1 : 0, job.detectLlmGarbage ? 1 : 0,
          job.delayMs, job.maxConcurrency, job.timeoutMs, job.userAgent,
          job.respectRobotsTxt ? 1 : 0, job.maxUrls,
          job.maxBodyBytes ?? 5 * 1024 * 1024,
          job.notificationProviders ? JSON.stringify(job.notificationProviders) : null,
          job.createdAt ?? now, job.updatedAt ?? now,
          job.lastRunAt ?? null, job.lastRunStatus ?? null
        )
      )
    }
    if (stmts.length > 0) {
      await this.db.batch(stmts)
    }
    return stmts.length
  }

  async exportCrawlJobs(): Promise<CrawlJob[]> {
    return this.listCrawlJobs()
  }

  // ─── Monitors ──────────────────────────────────────────────────────

  async createMonitor(monitor: MonitorRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO monitors
         (id, name, type, url, method, expected_status, expected_body,
          interval_seconds, retry_count, timeout_ms, accepted_response_time_ms,
          enabled, source, job_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        monitor.id, monitor.name, monitor.type, monitor.url, monitor.method,
        monitor.expectedStatus, monitor.expectedBody,
        monitor.intervalSeconds, monitor.retryCount, monitor.timeoutMs,
        monitor.acceptedResponseTimeMs,
        monitor.enabled ? 1 : 0, monitor.source, monitor.jobId,
        monitor.createdAt, monitor.updatedAt
      )
      .run()
  }

  async updateMonitor(id: string, patch: Partial<Omit<MonitorRecord, "id" | "createdAt">>): Promise<void> {
    const { clauses, values } = buildMonitorUpdate(patch)
    if (clauses.length === 0) return
    values.push(id)
    await this.db.prepare(`UPDATE monitors SET ${clauses.join(", ")} WHERE id = ?`).bind(...values).run()
  }

  async updateMonitors(ids: string[], patch: Partial<Omit<MonitorRecord, "id" | "createdAt">>): Promise<number> {
    if (ids.length === 0) return 0
    const { clauses, values } = buildMonitorUpdate(patch)
    if (clauses.length === 0) return 0
    const placeholders = ids.map(() => "?").join(", ")
    values.push(...ids)
    const result = await this.db
      .prepare(`UPDATE monitors SET ${clauses.join(", ")} WHERE id IN (${placeholders})`)
      .bind(...values)
      .run()
    return result.meta?.changes ?? 0
  }

  async deleteMonitors(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0
    const placeholders = ids.map(() => "?").join(", ")
    const result = await this.db
      .prepare(`DELETE FROM monitors WHERE id IN (${placeholders})`)
      .bind(...ids)
      .run()
    return result.meta?.changes ?? 0
  }

  async getMonitor(id: string): Promise<MonitorRecord | null> {
    const row = await this.db
      .prepare(`SELECT * FROM monitors WHERE id = ?`)
      .bind(id)
      .first<Record<string, unknown>>()
    return row ? mapMonitor(row) : null
  }

  async listMonitors(): Promise<MonitorWithStatus[]> {
    const { results } = await this.db
      .prepare(`SELECT * FROM monitors ORDER BY created_at DESC`)
      .all<Record<string, unknown>>()
    return this.toMonitorWithStatus(results ?? [])
  }

  async listMonitorDomains(): Promise<{ domain: string; count: number }[]> {
    const { results } = await this.db
      .prepare(`SELECT url FROM monitors`)
      .all<{ url: string }>()
    const counts = new Map<string, number>()
    for (const row of (results ?? [])) {
      const domain = deriveDomain(row.url)
      counts.set(domain, (counts.get(domain) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => a.domain.localeCompare(b.domain))
  }

  async listMonitorsInDomains(domains: string[]): Promise<MonitorWithStatus[]> {
    if (domains.length === 0) return []
    const allowed = new Set(domains)
    const { results } = await this.db
      .prepare(`SELECT * FROM monitors ORDER BY created_at DESC`)
      .all<Record<string, unknown>>()
    const filtered = (results ?? []).filter((row) => allowed.has(deriveDomain(row.url as string)))
    return this.toMonitorWithStatus(filtered)
  }

  async listEnabledMonitors(): Promise<MonitorRecord[]> {
    const { results } = await this.db
      .prepare(`SELECT * FROM monitors WHERE enabled = 1`)
      .all<Record<string, unknown>>()
    return (results ?? []).map(mapMonitor)
  }

  async listMonitorsForJob(jobId: string): Promise<MonitorRecord[]> {
    const { results } = await this.db
      .prepare(`SELECT * FROM monitors WHERE job_id = ?`)
      .bind(jobId)
      .all<Record<string, unknown>>()
    return (results ?? []).map(mapMonitor)
  }

  async deleteMonitor(id: string): Promise<void> {
    await this.db.prepare(`DELETE FROM monitors WHERE id = ?`).bind(id).run()
  }

  async upsertMonitorByUrl(
    url: string,
    patch: Partial<Omit<MonitorRecord, "id" | "createdAt">>
  ): Promise<MonitorRecord | null> {
    const existing = await this.db
      .prepare(`SELECT * FROM monitors WHERE url = ? LIMIT 1`)
      .bind(url)
      .first<Record<string, unknown>>()
    const now = new Date().toISOString()
    if (existing) {
      const monitor = mapMonitor(existing)
      await this.updateMonitor(monitor.id, { ...patch, updatedAt: now })
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
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now
    }
    await this.createMonitor(monitor)
    return monitor
  }

  // ─── Heartbeats ────────────────────────────────────────────────────

  async insertHeartbeat(h: Heartbeat): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO heartbeats (id, monitor_id, status, response_time_ms, message, checked_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(h.id, h.monitorId, h.status, h.responseTimeMs, h.message, h.checkedAt)
      .run()
  }

  async getLatestHeartbeat(monitorId: string): Promise<Heartbeat | null> {
    const row = await this.db
      .prepare(`SELECT * FROM heartbeats WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 1`)
      .bind(monitorId)
      .first<Record<string, unknown>>()
    return row ? mapHeartbeat(row) : null
  }

  async listHeartbeats(monitorId: string, limit = 100): Promise<Heartbeat[]> {
    const { results } = await this.db
      .prepare(`SELECT * FROM heartbeats WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT ?`)
      .bind(monitorId, limit)
      .all<Record<string, unknown>>()
    return (results ?? []).map(mapHeartbeat)
  }

  async listHeartbeatsSince(monitorId: string, sinceIso: string): Promise<Heartbeat[]> {
    const { results } = await this.db
      .prepare(`SELECT * FROM heartbeats WHERE monitor_id = ? AND checked_at >= ? ORDER BY checked_at ASC`)
      .bind(monitorId, sinceIso)
      .all<Record<string, unknown>>()
    return (results ?? []).map(mapHeartbeat)
  }

  async pruneHeartbeats(olderThanIso: string): Promise<number> {
    const result = await this.db
      .prepare(`DELETE FROM heartbeats WHERE checked_at < ?`)
      .bind(olderThanIso)
      .run()
    return result.meta?.changes ?? 0
  }

  // ─── Uptime ────────────────────────────────────────────────────────

  async getUptimeForPeriod(monitorId: string, sinceIso: string): Promise<number | null> {
    const row = await this.db
      .prepare(
        `SELECT SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) AS up_count, COUNT(*) AS total
         FROM heartbeats WHERE monitor_id = ? AND checked_at >= ?`
      )
      .bind(monitorId, sinceIso)
      .first<{ up_count: number; total: number }>()
    if (!row || row.total === 0) return null
    return Math.round((row.up_count / row.total) * 1000) / 10
  }

  async getMonitorStats(monitorId: string): Promise<MonitorStats> {
    const day = 24 * 3600 * 1000
    const rtRow = await this.db
      .prepare(
        `SELECT AVG(response_time_ms) AS avg_rt, MIN(response_time_ms) AS min_rt, MAX(response_time_ms) AS max_rt
         FROM heartbeats WHERE monitor_id = ? AND response_time_ms IS NOT NULL AND checked_at >= ?`
      )
      .bind(monitorId, new Date(Date.now() - 30 * day).toISOString())
      .first<{ avg_rt: number | null; min_rt: number | null; max_rt: number | null }>()
    return {
      uptime24h: await this.getUptimeForPeriod(monitorId, new Date(Date.now() - day).toISOString()),
      uptime7d: await this.getUptimeForPeriod(monitorId, new Date(Date.now() - 7 * day).toISOString()),
      uptime30d: await this.getUptimeForPeriod(monitorId, new Date(Date.now() - 30 * day).toISOString()),
      uptime365d: await this.getUptimeForPeriod(monitorId, new Date(Date.now() - 365 * day).toISOString()),
      avgResponseTimeMs: rtRow?.avg_rt != null ? Math.round(rtRow.avg_rt) : null,
      minResponseTimeMs: rtRow?.min_rt != null ? Math.round(rtRow.min_rt) : null,
      maxResponseTimeMs: rtRow?.max_rt != null ? Math.round(rtRow.max_rt) : null
    }
  }

  // ─── Status pages ──────────────────────────────────────────────────

  async createStatusPage(page: StatusPageRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO status_pages (id, slug, title, description, show_response_times, public, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(page.id, page.slug, page.title, page.description, page.showResponseTimes ? 1 : 0, page.public ? 1 : 0, page.createdAt)
      .run()
  }

  async listStatusPages(): Promise<StatusPageRecord[]> {
    const { results } = await this.db
      .prepare(`SELECT * FROM status_pages ORDER BY created_at DESC`)
      .all<Record<string, unknown>>()
    return (results ?? []).map(mapStatusPage)
  }

  async getStatusPage(id: string): Promise<StatusPageRecord | null> {
    const row = await this.db
      .prepare(`SELECT * FROM status_pages WHERE id = ?`)
      .bind(id)
      .first<Record<string, unknown>>()
    return row ? mapStatusPage(row) : null
  }

  async getStatusPageBySlug(slug: string): Promise<StatusPageRecord | null> {
    const row = await this.db
      .prepare(`SELECT * FROM status_pages WHERE slug = ?`)
      .bind(slug)
      .first<Record<string, unknown>>()
    return row ? mapStatusPage(row) : null
  }

  async updateStatusPage(id: string, patch: Partial<Omit<StatusPageRecord, "id" | "createdAt">>): Promise<void> {
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
    await this.db.prepare(`UPDATE status_pages SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run()
  }

  async deleteStatusPage(id: string): Promise<void> {
    await this.db.prepare(`DELETE FROM status_pages WHERE id = ?`).bind(id).run()
  }

  async setStatusPageMonitors(statusPageId: string, monitorIds: string[]): Promise<void> {
    const stmts: D1PreparedStatement[] = [
      this.db.prepare(`DELETE FROM status_page_monitors WHERE status_page_id = ?`).bind(statusPageId),
    ]
    for (let i = 0; i < monitorIds.length; i++) {
      stmts.push(
        this.db.prepare(`INSERT INTO status_page_monitors (status_page_id, monitor_id, sort_order) VALUES (?, ?, ?)`)
          .bind(statusPageId, monitorIds[i]!, i)
      )
    }
    await this.db.batch(stmts)
  }

  async getStatusPageMonitors(statusPageId: string): Promise<MonitorWithStatus[]> {
    const { results } = await this.db
      .prepare(
        `SELECT m.* FROM status_page_monitors spm
         JOIN monitors m ON m.id = spm.monitor_id
         WHERE spm.status_page_id = ?
         ORDER BY spm.sort_order ASC`
      )
      .bind(statusPageId)
      .all<Record<string, unknown>>()
    const latest = await this.getLatestHeartbeatByMonitor()
    const recent = await this.getRecentHeartbeatsByMonitor(90)
    const uptime24h = await this.getUptimeByMonitor(new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    return (results ?? []).map((row) => {
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

  // ─── Maintenance windows ───────────────────────────────────────────

  async createMaintenanceWindow(w: MaintenanceWindowRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO maintenance_windows (id, monitor_id, title, description, start_at, end_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(w.id, w.monitorId, w.title, w.description, w.startAt, w.endAt, w.createdAt)
      .run()
  }

  async listMaintenanceWindowsForMonitor(monitorId: string): Promise<MaintenanceWindowRecord[]> {
    const { results } = await this.db
      .prepare(`SELECT * FROM maintenance_windows WHERE monitor_id = ? ORDER BY start_at DESC`)
      .bind(monitorId)
      .all<Record<string, unknown>>()
    return (results ?? []).map(mapMaintenanceWindow)
  }

  async hasActiveMaintenanceWindow(monitorId: string, atIso: string): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM maintenance_windows
         WHERE monitor_id = ? AND start_at <= ? AND end_at >= ?`
      )
      .bind(monitorId, atIso, atIso)
      .first<{ c: number }>()
    return (row?.c ?? 0) > 0
  }

  async deleteMaintenanceWindow(id: string): Promise<void> {
    await this.db.prepare(`DELETE FROM maintenance_windows WHERE id = ?`).bind(id).run()
  }

  // ─── Stats ─────────────────────────────────────────────────────────

  async getOverviewStats(): Promise<{
    totalUrls: number; totalCrawls: number; lastCrawlAt: string | null
    lastCrawlBroken: number; lastCrawlChanged: number; brokenNow: number
  }> {
    const totalUrls = ((await this.db.prepare(`SELECT COUNT(*) AS c FROM url_state`).first<{ c: number }>())?.c ?? 0)
    const totalCrawls = ((await this.db.prepare(`SELECT COUNT(*) AS c FROM crawls`).first<{ c: number }>())?.c ?? 0)
    const lastCrawl = await this.db
      .prepare(`SELECT started_at, urls_broken, urls_changed FROM crawls ORDER BY started_at DESC LIMIT 1`)
      .first<{ started_at: string; urls_broken: number; urls_changed: number }>()
    const brokenNow = ((await this.db
      .prepare(`SELECT COUNT(*) AS c FROM url_state WHERE last_status_code >= 400`)
      .first<{ c: number }>())?.c ?? 0)
    return {
      totalUrls, totalCrawls,
      lastCrawlAt: lastCrawl?.started_at ?? null,
      lastCrawlBroken: lastCrawl?.urls_broken ?? 0,
      lastCrawlChanged: lastCrawl?.urls_changed ?? 0,
      brokenNow
    }
  }

  async getTimeline(days = 30): Promise<{ date: string; healthy: number; broken: number }[]> {
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()
    const { results } = await this.db
      .prepare(
        `SELECT substr(started_at, 1, 10) AS date,
                SUM(CASE WHEN urls_broken = 0 THEN 1 ELSE 0 END) AS healthy,
                SUM(CASE WHEN urls_broken > 0 THEN 1 ELSE 0 END) AS broken
         FROM crawls
         WHERE started_at >= ?
         GROUP BY date
         ORDER BY date ASC`
      )
      .bind(cutoff)
      .all<{ date: string; healthy: number; broken: number }>()
    return results ?? []
  }

  async getCrawlDurationTrend(limit = 30): Promise<{ id: string; startedAt: string; durationMs: number }[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, started_at,
                (julianday(finished_at) - julianday(started_at)) * 86400000 AS duration_ms
         FROM crawls
         WHERE finished_at IS NOT NULL
         ORDER BY started_at DESC LIMIT ?`
      )
      .bind(limit)
      .all<{ id: string; started_at: string; duration_ms: number | null }>()
    return (results ?? [])
      .map((r) => ({
        id: r.id,
        startedAt: r.started_at,
        durationMs: Math.max(0, Math.round(r.duration_ms ?? 0))
      }))
      .reverse()
  }

  async getStatusDistribution(crawlId: string): Promise<{ status: string; count: number }[]> {
    const { results } = await this.db
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
      .bind(crawlId)
      .all<{ bucket: string; c: number }>()
    return (results ?? []).map((r) => ({ status: r.bucket, count: r.c }))
  }

  async getCrawlSummary(crawlId: string): Promise<CrawlSummary | null> {
    const crawl = await this.getCrawl(crawlId)
    if (!crawl) return null
    const results = await this.listResults(crawlId)

    const broken: CrawlSummaryIssue[] = results
      .filter((r) => r.statusCode !== null && r.statusCode >= 400)
      .map((r) => ({ url: r.url, detail: r.error ?? `HTTP ${r.statusCode}`, severity: "high" as const }))

    const changed: CrawlSummaryIssue[] = results
      .filter((r) => r.contentChanged)
      .map((r) => ({ url: r.url, detail: "Content changed since last crawl", severity: "medium" as const }))

    const sslExpiring: CrawlSummaryIssue[] = results
      .filter((r) => {
        if (!r.sslValidUntil) return false
        const days = Math.floor((Date.parse(r.sslValidUntil) - Date.now()) / 86400000)
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

    const responseTimes = results.map((r) => r.responseTimeMs).filter((t): t is number => t !== null)
    const durationMs = crawl.finishedAt && crawl.startedAt
      ? Math.round(Date.parse(crawl.finishedAt) - Date.parse(crawl.startedAt))
      : null
    const checkedCount = results.length
    const totalBroken = broken.length
    const healthScore = checkedCount > 0 ? Math.round(((checkedCount - totalBroken) / checkedCount) * 100) : 100

    return {
      crawlId: crawl.id,
      jobName: undefined,
      status: crawl.status,
      startedAt: crawl.startedAt,
      finishedAt: crawl.finishedAt,
      durationMs,
      totalUrls: crawl.urlsTotal,
      checkedUrls: checkedCount,
      healthScore,
      avgResponseTimeMs: responseTimes.length > 0
        ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
        : null,
      slowestResponseTimeMs: responseTimes.length > 0 ? Math.max(...responseTimes) : null,
      fastestResponseTimeMs: responseTimes.length > 0 ? Math.min(...responseTimes) : null,
      issues: { broken, changed, sslExpiring, mojibake, llmGarbage }
    }
  }

  // ─── User notification settings ────────────────────────────────────

  async getUserNotificationSettings(userId: string): Promise<UserNotificationSettings | null> {
    const row = await this.db
      .prepare(`SELECT * FROM user_notification_settings WHERE user_id = ?`)
      .bind(userId)
      .first<Record<string, unknown>>()
    return row ? mapUserNotificationSettings(row) : null
  }

  async upsertUserNotificationSettings(
    userId: string,
    settings: Omit<UserNotificationSettings, "userId" | "updatedAt">
  ): Promise<void> {
    const now = new Date().toISOString()
    await this.db
      .prepare(
        `INSERT INTO user_notification_settings
         (user_id, slack, telegram, email, webhook, teams, enabled_events, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           slack = excluded.slack, telegram = excluded.telegram,
           email = excluded.email, webhook = excluded.webhook,
           teams = excluded.teams, enabled_events = excluded.enabled_events,
           updated_at = excluded.updated_at`
      )
      .bind(
        userId,
        JSON.stringify(settings.slack),
        JSON.stringify(settings.telegram),
        JSON.stringify(settings.email),
        JSON.stringify(settings.webhook),
        JSON.stringify(settings.teams ?? { enabled: false }),
        JSON.stringify(settings.enabledEvents),
        now
      )
      .run()
  }

  async listUserNotificationSettings(): Promise<UserNotificationSettings[]> {
    const { results } = await this.db
      .prepare(`SELECT * FROM user_notification_settings`)
      .all<Record<string, unknown>>()
    return (results ?? []).map(mapUserNotificationSettings)
  }

  async deleteUserNotificationSettings(userId: string): Promise<void> {
    await this.db
      .prepare(`DELETE FROM user_notification_settings WHERE user_id = ?`)
      .bind(userId)
      .run()
  }

  // ─── Private helpers ───────────────────────────────────────────────

  private async toMonitorWithStatus(rows: Record<string, unknown>[]): Promise<MonitorWithStatus[]> {
    const latest = await this.getLatestHeartbeatByMonitor()
    const recent = await this.getRecentHeartbeatsByMonitor(90)
    const uptime24h = await this.getUptimeByMonitor(new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    const uptime7d = await this.getUptimeByMonitor(new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
    const uptime30d = await this.getUptimeByMonitor(new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
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

  private async getLatestHeartbeatByMonitor(): Promise<Map<string, Heartbeat>> {
    const { results } = await this.db
      .prepare(
        `SELECT h.* FROM heartbeats h
         JOIN (SELECT monitor_id, MAX(checked_at) AS max_at FROM heartbeats GROUP BY monitor_id) t
           ON h.monitor_id = t.monitor_id AND h.checked_at = t.max_at`
      )
      .all<Record<string, unknown>>()
    return new Map((results ?? []).map((r) => [r.monitor_id as string, mapHeartbeat(r)]))
  }

  private async getRecentHeartbeatsByMonitor(limit: number): Promise<Map<string, Heartbeat[]>> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM (
           SELECT h.*, ROW_NUMBER() OVER (PARTITION BY monitor_id ORDER BY checked_at DESC) AS rn
           FROM heartbeats h
         ) WHERE rn <= ?`
      )
      .bind(limit)
      .all<Record<string, unknown> & { rn: number }>()
    const byMonitor = new Map<string, Heartbeat[]>()
    for (const row of (results ?? [])) {
      const monitorId = row.monitor_id as string
      if (!byMonitor.has(monitorId)) byMonitor.set(monitorId, [])
      byMonitor.get(monitorId)!.push(mapHeartbeat(row))
    }
    for (const list of byMonitor.values()) list.reverse()
    return byMonitor
  }

  private async getUptimeByMonitor(sinceIso: string): Promise<Map<string, number>> {
    const { results } = await this.db
      .prepare(
        `SELECT monitor_id,
                SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) AS up_count,
                COUNT(*) AS total
         FROM heartbeats WHERE checked_at >= ?
         GROUP BY monitor_id`
      )
      .bind(sinceIso)
      .all<{ monitor_id: string; up_count: number; total: number }>()
    return new Map(
      (results ?? [])
        .filter((r) => r.total > 0)
        .map((r) => [r.monitor_id, Math.round((r.up_count / r.total) * 1000) / 10])
    )
  }
}

// ─── Row mappers ─────────────────────────────────────────────────────

function mapCrawlJob(row: Record<string, unknown>): CrawlJob {
  let sitemapUrls: string[] | null = null
  if (typeof row.sitemap_urls === "string") {
    try { const parsed = JSON.parse(row.sitemap_urls); if (Array.isArray(parsed)) sitemapUrls = parsed } catch { /* ignore */ }
  }
  let notificationProviders: CrawlJob["notificationProviders"] = null
  if (typeof row.notification_providers === "string") {
    try { const parsed = JSON.parse(row.notification_providers); if (parsed && typeof parsed === "object") notificationProviders = parsed } catch { /* ignore */ }
  }
  return {
    id: row.id as string, name: row.name as string, sitemapUrl: row.sitemap_url as string,
    sitemapUrls, enabled: row.enabled === 1,
    intervalValue: row.interval_value as number, intervalUnit: row.interval_unit as CrawlJob["intervalUnit"],
    runAt: (row.run_at as string | null) ?? null,
    notifyOnComplete: row.notify_on_complete === 1, notifyOnFailure: row.notify_on_failure === 1,
    notifyOnChange: row.notify_on_change === 1, notifyOnMojibake: row.notify_on_mojibake === 1,
    notifyOnLlmGarbage: row.notify_on_llm_garbage === 1, notifySslExpiring: row.notify_ssl_expiring !== 0,
    notifyOnProgress: row.notify_on_progress === 1,
    detectMojibake: row.detect_mojibake !== 0, detectLlmGarbage: row.detect_llm_garbage !== 0,
    delayMs: row.delay_ms as number, maxConcurrency: row.max_concurrency as number,
    timeoutMs: row.timeout_ms as number, userAgent: row.user_agent as string,
    respectRobotsTxt: row.respect_robots_txt === 1, maxUrls: row.max_urls as number,
    maxBodyBytes: (row.max_body_bytes as number) ?? 5 * 1024 * 1024,
    notificationProviders, createdAt: row.created_at as string, updatedAt: row.updated_at as string,
    lastRunAt: (row.last_run_at as string | null) ?? null,
    lastRunStatus: (row.last_run_status as CrawlJob["lastRunStatus"]) ?? null
  }
}

function mapCrawl(row: Record<string, unknown>): CrawlRecord {
  return {
    id: row.id as string, jobId: (row.job_id as string | null) ?? null,
    startedAt: row.started_at as string, finishedAt: (row.finished_at as string | null) ?? null,
    status: row.status as CrawlRecord["status"],
    urlsTotal: (row.urls_total as number) ?? 0, urlsChecked: (row.urls_checked as number) ?? 0,
    urlsChanged: (row.urls_changed as number) ?? 0, urlsBroken: (row.urls_broken as number) ?? 0,
    urlsSkipped: (row.urls_skipped as number) ?? 0, errorMessage: (row.error_message as string | null) ?? null
  }
}

function mapResult(row: Record<string, unknown>, opts?: { includeSeo?: boolean }): CrawlResultRecord {
  return {
    id: row.id as string, crawlId: row.crawl_id as string, url: row.url as string,
    statusCode: (row.status_code as number | null) ?? null,
    responseTimeMs: (row.response_time_ms as number | null) ?? null,
    contentHash: (row.content_hash as string | null) ?? null,
    contentChanged: row.content_changed === 1, error: (row.error as string | null) ?? null,
    redirectChain: (row.redirect_chain as string | null) ?? null,
    sslValidUntil: (row.ssl_valid_until as string | null) ?? null,
    sitemapLastmod: (row.sitemap_lastmod as string | null) ?? null,
    checkedAt: row.checked_at as string, checkMethod: row.check_method as CrawlResultRecord["checkMethod"],
    mojibakeScore: (row.mojibake_score as number | null) ?? null,
    mojibakeFlagged: row.mojibake_flagged === 1,
    llmGarbageScore: (row.llm_garbage_score as number | null) ?? null,
    llmGarbageFlagged: row.llm_garbage_flagged === 1,
    seo: null
  }
}

function parseSeoFromRow(row: Record<string, unknown>): SeoInfo {
  const jsonLdTypes = typeof row.json_ld_types === "string" ? tryParseStringArray(row.json_ld_types) : []
  return {
    title: (row.title as string | null) ?? null,
    titleLength: (row.title_length as number) ?? 0,
    description: (row.description as string | null) ?? null,
    descriptionLength: (row.description_length as number) ?? 0,
    canonical: (row.canonical as string | null) ?? null,
    canonicalSelfReference: row.canonical_self_reference === 1 ? true : row.canonical_self_reference === 0 ? false : null,
    noindex: row.noindex === 1,
    nofollow: row.nofollow === 1,
    h1Count: (row.h1_count as number) ?? 0,
    wordCount: (row.word_count as number) ?? 0,
    pageWeightBytes: (row.page_weight_bytes as number) ?? 0,
    jsonLdTypes,
    ogTitle: (row.og_title as string | null) ?? null,
    ogDescription: (row.og_description as string | null) ?? null,
    ogImage: (row.og_image as string | null) ?? null,
    publishedAt: (row.published_at as string | null) ?? null
  }
}

function mapUrlState(row: Record<string, unknown>): UrlStateRecord {
  return {
    url: row.url as string, lastStatusCode: (row.last_status_code as number | null) ?? null,
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
    if (typeof val === "string") { try { return JSON.parse(val) } catch { /* ignore */ } }
    return fallback
  }
  return {
    userId: row.user_id as string,
    slack: parseJson(row.slack, { enabled: false }) as UserNotificationSettings["slack"],
    telegram: parseJson(row.telegram, { enabled: false }) as UserNotificationSettings["telegram"],
    email: parseJson(row.email, { enabled: false }) as UserNotificationSettings["email"],
    webhook: parseJson(row.webhook, { enabled: false }) as UserNotificationSettings["webhook"],
    teams: parseJson(row.teams, { enabled: false }) as UserNotificationSettings["teams"],
    enabledEvents: parseJson(row.enabled_events, {
      onCrawlFailure: false, onContentChange: false, onSslExpiring: false,
      onCrawlComplete: false, onMojibakeDetected: false, onLlmGarbageDetected: false,
      onCrawlProgress: false, onMonitorDown: false, onMonitorRecovery: false
    }) as UserNotificationSettings["enabledEvents"],
    updatedAt: row.updated_at as string
  }
}

function mapMonitor(row: Record<string, unknown>): MonitorRecord {
  return {
    id: row.id as string, name: row.name as string, type: row.type as MonitorRecord["type"],
    url: row.url as string, method: row.method as string,
    expectedStatus: (row.expected_status as number) ?? 200,
    expectedBody: (row.expected_body as string | null) ?? null,
    intervalSeconds: (row.interval_seconds as number) ?? 60,
    retryCount: (row.retry_count as number) ?? 3, timeoutMs: (row.timeout_ms as number) ?? 10000,
    acceptedResponseTimeMs: (row.accepted_response_time_ms as number) ?? 5000,
    enabled: row.enabled === 1, source: row.source as MonitorRecord["source"],
    jobId: (row.job_id as string | null) ?? null,
    createdAt: row.created_at as string, updatedAt: row.updated_at as string
  }
}

function mapHeartbeat(row: Record<string, unknown>): Heartbeat {
  return {
    id: row.id as string, monitorId: row.monitor_id as string,
    status: row.status as HeartbeatStatus,
    responseTimeMs: (row.response_time_ms as number | null) ?? null,
    message: (row.message as string | null) ?? null,
    checkedAt: row.checked_at as string
  }
}

function mapStatusPage(row: Record<string, unknown>): StatusPageRecord {
  return {
    id: row.id as string, slug: row.slug as string, title: row.title as string,
    description: (row.description as string | null) ?? null,
    showResponseTimes: row.show_response_times === 1, public: row.public !== 0,
    createdAt: row.created_at as string
  }
}

function mapMaintenanceWindow(row: Record<string, unknown>): MaintenanceWindowRecord {
  return {
    id: row.id as string, monitorId: row.monitor_id as string,
    title: row.title as string, description: (row.description as string | null) ?? null,
    startAt: row.start_at as string, endAt: row.end_at as string, createdAt: row.created_at as string
  }
}

function buildMonitorUpdate(patch: Partial<Omit<MonitorRecord, "id" | "createdAt">>): { clauses: string[]; values: unknown[] } {
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

function deriveMonitorName(url: string): string {
  try { const u = new URL(url); return `${u.hostname}${u.pathname === "/" ? "" : u.pathname}` }
  catch { return url }
}

function deriveDomain(url: string): string {
  try { return new URL(url).hostname || "unknown" }
  catch { return "unknown" }
}

function tryParseStringArray(val: string): string[] {
  try {
    const parsed = JSON.parse(val)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []
  } catch { return [] }
}
