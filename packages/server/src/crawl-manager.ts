import { randomUUID } from "node:crypto"
import type { Config, CrawlJob, CrawlProgress, CrawlConfig, CrawlRecord, Storage, Notifier, UserNotificationSettings, NotificationEvent } from "@supacrawl/core"
import {
  runCrawlWithPersistence,
  Notifier as NotifierClass,
  buildCrawlReportHtml,
  RustCrawler,
  getDefaultDaemonBin,
  isRustBackend
} from "@supacrawl/core"

export interface StartCrawlOptions {
  job?: CrawlJob
}

export class CrawlManager {
  private activeCrawls = new Map<string, AbortController>()
  private jobCrawlMap = new Map<string, string>()

  constructor(
    private config: Config,
    private storage: Storage,
    private notifier: Notifier,
    private onProgress: (p: CrawlProgress) => void
  ) {}

  setNotifier(notifier: Notifier): void {
    this.notifier = notifier
  }

  private getNotifierForJob(job?: CrawlJob): Notifier {
    if (!job || !job.notificationProviders) return this.notifier
    const hasEnabledProvider = Object.values(job.notificationProviders).some(
      (p: unknown) => (p as { enabled?: boolean })?.enabled
    )
    if (!hasEnabledProvider) return this.notifier
    const cfg = NotifierClass.configFromJob(job)
    return new NotifierClass(cfg)
  }

  private async sendUserNotifications(
    crawlId: string,
    record: CrawlRecord
  ): Promise<void> {
    const results = this.storage.listResults(crawlId, undefined, { includeSeo: false })

    const broken: { url: string; detail: string }[] = []
    const changed: { url: string }[] = []
    const sslExpiring: { url: string; validUntil: string }[] = []
    const mojibake: { url: string; score: number | null }[] = []
    const llmGarbage: { url: string; score: number | null }[] = []
    const responseTimes: number[] = []
    for (const r of results) {
      if (r.statusCode !== null && r.statusCode >= 400) {
        broken.push({ url: r.url, detail: r.error ?? `HTTP ${r.statusCode}` })
      }
      if (r.contentChanged) changed.push({ url: r.url })
      if (r.sslValidUntil) {
        const days = Math.floor(
          (Date.parse(r.sslValidUntil) - Date.now()) / 86400000
        )
        if (days >= 0 && days < this.config.checks.ssl.warnDays) {
          sslExpiring.push({ url: r.url, validUntil: r.sslValidUntil })
        }
      }
      if (r.mojibakeFlagged) mojibake.push({ url: r.url, score: r.mojibakeScore })
      if (r.llmGarbageFlagged) llmGarbage.push({ url: r.url, score: r.llmGarbageScore })
      if (r.responseTimeMs !== null) responseTimes.push(r.responseTimeMs)
    }

    const brokenUrls = broken.slice(0, 10)
    const changedUrls = changed.slice(0, 10)
    const expiringUrls = sslExpiring.slice(0, 10)
    const mojibakeUrls = mojibake.slice(0, 10)
    const llmGarbageUrls = llmGarbage.slice(0, 10)

    const events: { event: NotificationEvent; title: string; message: string; htmlBody?: string }[] = []

    const brokenUrlItems = brokenUrls.map((r) => ({ url: r.url, detail: r.detail }))
    const changedUrlItems = changedUrls.map((r) => ({ url: r.url }))
    const sslUrlItems = expiringUrls.map((r) => ({ url: r.url }))
    const mojibakeUrlItems = mojibakeUrls.map((r) => ({ url: r.url, detail: r.score ? `${Math.round(r.score * 100)}%` : "" }))
    const llmGarbageUrlItems = llmGarbageUrls.map((r) => ({ url: r.url, detail: r.score ? `${Math.round(r.score * 100)}%` : "" }))

    const reportUrls = {
      broken: brokenUrlItems.slice(0, 30),
      changed: changedUrlItems.slice(0, 30),
      sslExpiring: sslUrlItems.slice(0, 30),
      mojibake: mojibakeUrlItems.slice(0, 30),
      llmGarbage: llmGarbageUrlItems.slice(0, 30)
    }

    if (record.urlsBroken > 0) {
      const brokenList = brokenUrls
        .map((r) => `  • ${r.url} (${r.detail})`)
        .join("\n")
      const htmlBrokenList = brokenUrls
        .map((r) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#dc2626;">•</td><td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;font-size:13px;">${r.url}</td><td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#dc2626;">${r.detail}</td></tr>`)
        .join("")
      events.push({
        event: "onCrawlFailure",
        title: `🚨 Crawl found ${record.urlsBroken} broken URL(s)`,
        message: `Crawl found ${record.urlsBroken} broken links out of ${record.urlsChecked} checked.\n\n${brokenList}`,
        htmlBody: buildSummaryHtml("🚨 Broken URLs Found", `Crawl found ${record.urlsBroken} broken link(s) out of ${record.urlsChecked} checked.`, brokenList.length > 0
          ? `<table style="width:100%;border-collapse:collapse;margin-top:12px;">${htmlBrokenList}</table>`
          : "", record.urlsBroken)
      })
    }
    if (record.urlsChanged > 0) {
      const changedList = changedUrls
        .map((r) => `  • ${r.url}`)
        .join("\n")
      const htmlChangedList = changedUrls
        .map((r) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#eab308;">•</td><td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;font-size:13px;">${r.url}</td><td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;font-size:13px;">Content hash changed</td></tr>`)
        .join("")
      events.push({
        event: "onContentChange",
        title: `🔄 Crawl detected ${record.urlsChanged} content change(s)`,
        message: `Crawl detected ${record.urlsChanged} URLs with content changes.\n\n${changedList}`,
        htmlBody: buildSummaryHtml("🔄 Content Changes", `Crawl detected ${record.urlsChanged} URL(s) with content changes.`, htmlChangedList, record.urlsChanged)
      })
    }
    if (sslExpiring.length > 0) {
      const sslList = sslExpiring
        .map((r) => `  • ${r.url}`)
        .join("\n")
      events.push({
        event: "onSslExpiring",
        title: `🔒 ${sslExpiring.length} SSL cert(s) expiring soon`,
        message: `URLs with expiring certificates:\n${sslList}`
      })
    }
    if (mojibake.length > 0) {
      const mjList = mojibake
        .map((r) => `  • ${r.url}`)
        .join("\n")
      events.push({
        event: "onMojibakeDetected",
        title: `🔤 ${mojibake.length} URL(s) with mojibake detected`,
        message: `Crawl found ${mojibake.length} URLs with garbled text:\n${mjList}`
      })
    }
    if (llmGarbage.length > 0) {
      const lgList = llmGarbage
        .map((r) => `  • ${r.url}`)
        .join("\n")
      events.push({
        event: "onLlmGarbageDetected",
        title: `🤖 ${llmGarbage.length} URL(s) with LLM garbage detected`,
        message: `Crawl found ${llmGarbage.length} URLs with AI-generated artifacts:\n${lgList}`
      })
    }

    // Build a full HTML report for onCrawlComplete
    const healthScore = record.urlsChecked > 0
      ? Math.round(((record.urlsChecked - record.urlsBroken) / record.urlsChecked) * 100)
      : 100

    // Compute response time stats
    const avgRt = responseTimes.length > 0 ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : null
    const fastestRt = responseTimes.length > 0 ? Math.min(...responseTimes) : null
    const slowestRt = responseTimes.length > 0 ? Math.max(...responseTimes) : null

    const reportStats = {
      healthScore,
      totalChecked: record.urlsChecked,
      totalFound: record.urlsTotal,
      brokenCount: record.urlsBroken,
      changedCount: record.urlsChanged,
      sslCount: sslExpiring.length,
      mojibakeCount: mojibake.length,
      llmGarbageCount: llmGarbage.length,
      avgResponseTimeMs: avgRt,
      fastestResponseTimeMs: fastestRt,
      slowestResponseTimeMs: slowestRt
    }

    const completeHtml = buildCrawlReportHtml({
      crawlId,
      healthScore,
      totalChecked: record.urlsChecked,
      totalFound: record.urlsTotal,
      brokenCount: record.urlsBroken,
      changedCount: record.urlsChanged,
      sslCount: sslExpiring.length,
      mojibakeCount: mojibake.length,
      llmGarbageCount: llmGarbage.length,
      brokenUrls: brokenUrls.map((r) => ({ url: r.url, detail: r.detail })),
      changedUrls: changedUrls.map((r) => ({ url: r.url })),
      sslUrls: sslExpiring.map((r) => r.url).slice(0, 10)
    })
    events.push({
      event: "onCrawlComplete",
      title: `✅ Crawl complete — ${healthScore}% health score`,
      message: `Checked ${record.urlsChecked} of ${record.urlsTotal} URLs. ${record.urlsBroken} broken, ${record.urlsChanged} changed.`,
      htmlBody: completeHtml
    })

    const users = this.storage.listUserNotificationSettings()
    for (const user of users) {
      const hasAnyProvider =
        user.slack.enabled ||
        user.telegram.enabled ||
        user.email.enabled ||
        user.webhook.enabled
      if (!hasAnyProvider) continue

      const cfg = NotifierClass.configFromUserSettings(user)
      const notifier = new NotifierClass(cfg)

      for (const ev of events) {
        if (notifier.isEventEnabled(ev.event)) {
          await notifier.notify(ev.event, {
            event: ev.event,
            title: ev.title,
            message: ev.message,
            htmlBody: ev.htmlBody,
            crawlId,
            reportStats,
            reportUrls,
            meta: {
              broken: record.urlsBroken,
              changed: record.urlsChanged
            }
          })
        }
      }
    }
  }

  listActive(): string[] {
    return [...this.activeCrawls.keys()]
  }

  isActive(crawlId: string): boolean {
    return this.activeCrawls.has(crawlId)
  }

  isJobRunning(jobId: string): boolean {
    return this.jobCrawlMap.has(jobId)
  }

  async startCrawl(opts?: StartCrawlOptions): Promise<string> {
    if (opts?.job && this.jobCrawlMap.has(opts.job.id)) {
      throw new Error("A crawl is already running for this job")
    }

    const id = randomUUID()
    const controller = new AbortController()
    this.activeCrawls.set(id, controller)
    if (opts?.job) {
      this.jobCrawlMap.set(opts.job.id, id)
    }
    const crawlConfig: CrawlConfig = opts?.job
      ? {
          delayMs: opts.job.delayMs,
          maxConcurrency: opts.job.maxConcurrency,
          timeoutMs: opts.job.timeoutMs,
          userAgent: opts.job.userAgent,
          respectRobotsTxt: opts.job.respectRobotsTxt,
          maxUrls: opts.job.maxUrls,
          maxBodyBytes: opts.job.maxBodyBytes,
          maxGlobalConcurrency: this.config.crawl.maxGlobalConcurrency,
          retryOnTransientError: this.config.crawl.retryOnTransientError,
          maxRetries: this.config.crawl.maxRetries,
          detectMojibake: opts.job.detectMojibake,
          detectLlmGarbage: opts.job.detectLlmGarbage
        }
      : this.config.crawl
    const jobNotifier = this.getNotifierForJob(opts?.job)

    tryGc()

    if (isRustBackend()) {
      const startedAt = new Date().toISOString()
      this.storage.createCrawl(
        {
          id,
          jobId: opts?.job?.id ?? null,
          startedAt,
          finishedAt: null,
          status: "running",
          urlsTotal: 0,
          urlsChecked: 0,
          urlsChanged: 0,
          urlsBroken: 0,
          urlsSkipped: 0,
          errorMessage: null,
        },
        opts?.job?.id ?? undefined
      )
      const rustCrawler = new RustCrawler(id, {
        daemonBin: getDefaultDaemonBin(),
        config: {
          crawl: crawlConfig,
          checks: { ...this.config.checks },
        },
        sitemaps: opts?.job
          ? (opts.job.sitemapUrls ?? [opts.job.sitemapUrl])
          : this.config.sitemaps.filter((s) => s.enabled).map((s) => s.url),
        knownHashes: this.storage.getAllUrlStates().map((s) => ({
          url: s.url,
          hash: s.lastContentHash ?? "",
          has_seo: s.hasSeo,
          last_checked_at: s.lastCheckedAt ?? null,
          sitemap_lastmod: s.sitemapLastmod ?? null,
        })),
        dbPath: process.env.CRAWLER_DB_PATH ?? this.storage.dbPath,
        abortSignal: controller.signal,
        onProgress: (p) => {
          this.onProgress(p)
          this.storage.updateCrawl(p.crawlId, {
            status: p.status,
            urlsChecked: p.checked,
            urlsTotal: p.total,
          })
        },
        onResult: (r) => {},
        onComplete: (record) => {
          const status = record.status === "failed" ? "failed" : "completed"
          this.storage.updateCrawl(id, {
            status,
            urlsChecked: record.urlsChecked,
            urlsChanged: record.urlsChanged,
            urlsBroken: record.urlsBroken,
            urlsSkipped: record.urlsSkipped,
            urlsTotal: record.urlsTotal,
            finishedAt: new Date().toISOString(),
          })
          if (opts?.job) {
            this.storage.updateCrawlJob(opts.job.id, {
              lastRunAt: new Date().toISOString(),
              lastRunStatus: status,
            })
          }
          this.sendUserNotifications(id, {
            id,
            jobId: opts?.job?.id ?? null,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            status,
            urlsTotal: record.urlsTotal,
            urlsChecked: record.urlsChecked,
            urlsChanged: record.urlsChanged,
            urlsBroken: record.urlsBroken,
            urlsSkipped: record.urlsSkipped,
            errorMessage: record.errorMessage ?? null,
          }).catch((err) => console.error(`[user notifications] ${err}`))
        },
        onError: (error) => {
          this.markCrawlFailed(id, error, opts?.job)
        },
      })

      rustCrawler
        .start()
        .catch((err) => {
          this.markCrawlFailed(id, err, opts?.job)
        })
        .finally(() => {
          this.activeCrawls.delete(id)
          if (opts?.job) {
            this.jobCrawlMap.delete(opts.job.id)
          }
          tryGc()
        })

      return id
    }

    runCrawlWithPersistence({
      crawlId: id,
      config: { ...this.config, crawl: crawlConfig },
      sitemaps: opts?.job ? (opts.job.sitemapUrls ?? [opts.job.sitemapUrl]) : undefined,
      jobId: opts?.job?.id,
      storage: this.storage,
      notifier: jobNotifier,
      abortSignal: controller.signal,
      onProgress: (p) => this.onProgress(p)
    })
      .then(({ record }) => {
        if (opts?.job) {
          this.storage.updateCrawlJob(opts.job.id, {
            lastRunAt: new Date().toISOString(),
            lastRunStatus: record.status
          })
        }
        this.sendUserNotifications(id, record).catch((err) =>
          console.error(`[user notifications] ${err}`)
        )
      })
      .catch((err) => {
        this.onProgress({
          crawlId: id,
          total: 0,
          checked: 0,
          changed: 0,
          broken: 0,
          skipped: 0,
          status: "failed",
          startedAt: new Date().toISOString()
        })
        console.error(`[crawl ${id}] failed:`, err)
      })
      .finally(() => {
        this.activeCrawls.delete(id)
        if (opts?.job) {
          this.jobCrawlMap.delete(opts.job.id)
        }
        tryGc()
      })
    return id
  }

  async cancelCrawl(crawlId: string): Promise<boolean> {
    const c = this.activeCrawls.get(crawlId)
    if (!c) return false
    c.abort()
    this.activeCrawls.delete(crawlId)
    return true
  }

  private markCrawlFailed(crawlId: string, error: unknown, job?: CrawlJob): void {
    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : "Crawl failed"
    this.storage.updateCrawl(crawlId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      errorMessage: message
    })
    if (job) {
      this.storage.updateCrawlJob(job.id, {
        lastRunAt: new Date().toISOString(),
        lastRunStatus: "failed"
      })
    }
    this.onProgress({
      crawlId,
      total: 0,
      checked: 0,
      changed: 0,
      broken: 0,
      skipped: 0,
      status: "failed",
      startedAt: new Date().toISOString(),
    })
    console.error(`[crawl ${crawlId}] failed:`, error)
  }

  async cancelJobCrawl(jobId: string): Promise<boolean> {
    const crawlId = this.jobCrawlMap.get(jobId)
    if (!crawlId) return false
    this.jobCrawlMap.delete(jobId)
    return this.cancelCrawl(crawlId)
  }
}

function tryGc(): void {
  if (typeof globalThis.gc === "function") {
    globalThis.gc()
  }
}

function buildSummaryHtml(emojiTitle: string, intro: string, tableHtml: string, total: number): string {
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:560px;margin:0 auto;">
  <div style="background:#6366f1;color:#fff;border-radius:8px 8px 0 0;padding:16px 20px;">
    <h1 style="margin:0;font-size:16px;">supacrawl · ${emojiTitle}</h1>
  </div>
  <div style="background:#fff;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 8px 8px;padding:20px;color:#1e293b;">
    <p style="margin:0 0 4px;font-size:14px;line-height:1.5;color:#475569;">${intro}</p>
    <p style="margin:0 0 12px;font-size:13px;color:#94a3b8;">Affected URLs: ${total}</p>
    ${tableHtml}
  </div>
  <p style="text-align:center;font-size:11px;color:#94a3b8;margin-top:10px;">supacrawl · Automated crawl notification</p>
</div>`
}
