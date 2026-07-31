import { randomUUID } from "node:crypto"
import type { Config, CrawlJob, CrawlProgress, CrawlConfig, CrawlRecord, Storage, Notifier, UserNotificationSettings, NotificationEvent } from "@supacrawl/core"
import { runCrawlWithPersistence, Notifier as NotifierClass } from "@supacrawl/core"

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

  /** Build a per-job notifier, falling back to the global notifier if no job-specific providers set. */
  private getNotifierForJob(job?: CrawlJob): Notifier {
    if (!job || !job.notificationProviders) return this.notifier
    // Check if any provider is enabled in the job config
    const hasEnabledProvider = Object.values(job.notificationProviders).some(
      (p: unknown) => (p as { enabled?: boolean })?.enabled
    )
    if (!hasEnabledProvider) return this.notifier
    const cfg = NotifierClass.configFromJob(job)
    return new NotifierClass(cfg)
  }

  /** Send user-level notifications after a crawl completes. */
  private async sendUserNotifications(
    crawlId: string,
    record: CrawlRecord
  ): Promise<void> {
    const results = this.storage.listResults(crawlId)
    const expiringSoon = results
      .filter((r) => {
        if (!r.sslValidUntil) return false
        const days = Math.floor(
          (Date.parse(r.sslValidUntil) - Date.now()) / 86400000
        )
        return days >= 0 && days < this.config.checks.ssl.warnDays
      })
    const expiringUrls = expiringSoon.slice(0, 10)
    const mojibakeFlagged = results
      .filter((r) => r.mojibakeFlagged)
    const mojibakeUrls = mojibakeFlagged.slice(0, 10)
    const brokenUrls = results
      .filter((r) => r.statusCode !== null && r.statusCode >= 400)
      .slice(0, 10)
    const changedUrls = results
      .filter((r) => r.contentChanged)
      .slice(0, 10)

    const events: { event: NotificationEvent; title: string; message: string; htmlBody?: string }[] = []

    const brokenUrlItems = brokenUrls.map((r) => ({ url: r.url, detail: r.error ?? `HTTP ${r.statusCode}` }))
    const changedUrlItems = changedUrls.map((r) => ({ url: r.url }))
    const sslUrlItems = expiringUrls.map((r) => ({ url: r.url }))
    const mojibakeUrlItems = mojibakeUrls.map((r) => ({ url: r.url, detail: r.mojibakeScore ? `${Math.round(r.mojibakeScore * 100)}%` : "" }))

    const reportUrls = {
      broken: brokenUrlItems.slice(0, 30),
      changed: changedUrlItems.slice(0, 30),
      sslExpiring: sslUrlItems.slice(0, 30),
      mojibake: mojibakeUrlItems.slice(0, 30)
    }

    if (record.urlsBroken > 0) {
      const brokenList = brokenUrls
        .map((r) => `  • ${r.url} (${r.error ?? `HTTP ${r.statusCode}`})`)
        .join("\n")
      const htmlBrokenList = brokenUrls
        .map((r) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#dc2626;">•</td><td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;font-size:13px;">${r.url}</td><td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#dc2626;">${r.error ?? `HTTP ${r.statusCode}`}</td></tr>`)
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
    if (expiringSoon.length > 0) {
      const sslList = expiringSoon
        .map((r) => `  • ${r}`)
        .join("\n")
      events.push({
        event: "onSslExpiring",
        title: `🔒 ${expiringSoon.length} SSL cert(s) expiring soon`,
        message: `URLs with expiring certificates:\n${sslList}`
      })
    }
    if (mojibakeFlagged.length > 0) {
      const mjList = mojibakeFlagged
        .map((r) => `  • ${r.url}`)
        .join("\n")
      events.push({
        event: "onMojibakeDetected",
        title: `🔤 ${mojibakeFlagged.length} URL(s) with mojibake detected`,
        message: `Crawl found ${mojibakeFlagged.length} URLs with garbled text:\n${mjList}`
      })
    }

    // Build a full HTML report for onCrawlComplete
    const healthScore = record.urlsChecked > 0
      ? Math.round(((record.urlsChecked - record.urlsBroken) / record.urlsChecked) * 100)
      : 100

    // Compute response time stats
    const responseTimes = results
      .map((r) => r.responseTimeMs)
      .filter((t): t is number => t !== null)
    const avgRt = responseTimes.length > 0 ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : null
    const fastestRt = responseTimes.length > 0 ? Math.min(...responseTimes) : null
    const slowestRt = responseTimes.length > 0 ? Math.max(...responseTimes) : null

    const reportStats = {
      healthScore,
      totalChecked: record.urlsChecked,
      totalFound: record.urlsTotal,
      brokenCount: record.urlsBroken,
      changedCount: record.urlsChanged,
      sslCount: expiringSoon.length,
      mojibakeCount: mojibakeFlagged.length,
      avgResponseTimeMs: avgRt,
      fastestResponseTimeMs: fastestRt,
      slowestResponseTimeMs: slowestRt
    }

    const completeHtml = buildFullReportHtml({
      crawlId,
      healthScore,
      totalChecked: record.urlsChecked,
      totalFound: record.urlsTotal,
      brokenCount: record.urlsBroken,
      changedCount: record.urlsChanged,
      sslCount: expiringSoon.length,
      mojibakeCount: mojibakeFlagged.length,
      brokenUrls: brokenUrls.map((r) => ({ url: r.url, detail: r.error ?? `HTTP ${r.statusCode}` })),
      changedUrls: changedUrls.map((r) => ({ url: r.url })),
      sslUrls: expiringSoon.map((r) => r.url).slice(0, 10)
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
          retryOnTransientError: this.config.crawl.retryOnTransientError,
          maxRetries: this.config.crawl.maxRetries,
          detectMojibake: opts.job.detectMojibake
        }
      : this.config.crawl
    const jobNotifier = this.getNotifierForJob(opts?.job)
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
        // Send user-level notifications after crawl completes
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

  async cancelJobCrawl(jobId: string): Promise<boolean> {
    const crawlId = this.jobCrawlMap.get(jobId)
    if (!crawlId) return false
    this.jobCrawlMap.delete(jobId)
    return this.cancelCrawl(crawlId)
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

interface ReportUrl {
  url: string
  detail?: string
}

function buildFullReportHtml(opts: {
  crawlId: string
  healthScore: number
  totalChecked: number
  totalFound: number
  brokenCount: number
  changedCount: number
  sslCount: number
  mojibakeCount: number
  brokenUrls: ReportUrl[]
  changedUrls: ReportUrl[]
  sslUrls: string[]
  }): string {
  const healthColor = opts.healthScore >= 90 ? "#059669" : opts.healthScore >= 70 ? "#d97706" : "#dc2626"
  const healthBg = opts.healthScore >= 90 ? "#d1fae5" : opts.healthScore >= 70 ? "#fef3c7" : "#fee2e2"

  function statCard(num: number, label: string, icon: string, color: string, bg: string, border: string) {
    return `<td style="padding:6px;width:25%;">
      <div style="background:${bg};border:1px solid ${border};border-radius:8px;padding:14px 8px;text-align:center;">
        <div style="font-size:18px;margin-bottom:4px;">${icon}</div>
        <div style="font-size:20px;font-weight:700;color:${num > 0 ? color : "#059669"};">${num}</div>
        <div style="font-size:9px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.3px;">${label}</div>
      </div>
    </td>`
  }

  function issueSection(title: string, count: number, color: string, bg: string, urls: ReportUrl[]) {
    if (urls.length === 0) return ""
    return `<div style="margin-top:14px;border:1px solid ${color}33;border-radius:8px;overflow:hidden;">
      <div style="background:${bg};padding:10px 16px;font-size:13px;font-weight:700;color:${color};">
        ${title} (${count})
      </div>
      ${urls.map((r, i) => `<div style="padding:8px 16px;border-top:1px solid #f1f5f9;font-size:12px;${i > 0 ? "" : ""}">
        <div style="color:#1e293b;word-break:break-all;">${r.url}</div>
        ${r.detail ? `<div style="color:#64748b;font-size:11px;font-family:'JetBrains Mono',monospace;margin-top:2px;">${r.detail}</div>` : ""}
      </div>`).join("")}
    </div>`
  }

  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:580px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#6366f1 0%,#4f46e5 100%);color:#fff;border-radius:10px;padding:22px 28px;margin-bottom:16px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
      <div>
        <div style="font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:1px;opacity:0.8;margin-bottom:4px;">supacrawl</div>
        <h1 style="margin:0;font-size:20px;font-weight:700;line-height:1.2;">Crawl Report</h1>
        <p style="margin:4px 0 0;font-size:11px;opacity:0.85;">ID: ${opts.crawlId.slice(0, 8)}</p>
      </div>
      <div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:10px 16px;text-align:center;min-width:64px;">
        <div style="font-size:8px;font-weight:600;text-transform:uppercase;opacity:0.75;margin-bottom:2px;">Health</div>
        <div style="font-size:26px;font-weight:800;line-height:1;">${opts.healthScore}%</div>
      </div>
    </div>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
    <tr>
      ${statCard(opts.brokenCount, "Broken", "&#x1F6A8;", "#dc2626", "#fef2f2", "#fecaca")}
      ${statCard(opts.changedCount, "Changed", "&#x1F504;", "#d97706", "#fffbeb", "#fde68a")}
      ${statCard(opts.sslCount, "SSL Expiring", "&#x1F512;", "#ea580c", "#fff7ed", "#fed7aa")}
      ${statCard(opts.mojibakeCount, "Mojibake", "&#x1F524;", "#9333ea", "#faf5ff", "#e9d5ff")}
    </tr>
  </table>

  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:12px;">
    <div style="font-size:12px;font-weight:700;color:#0f172a;margin-bottom:8px;">&#x1F4CA; Summary</div>
    <div style="font-size:12px;color:#64748b;">
      Checked <strong style="color:#0f172a;">${opts.totalChecked}</strong> of <strong style="color:#0f172a;">${opts.totalFound}</strong> URLs ·
      ${opts.brokenCount > 0 || opts.changedCount > 0 || opts.sslCount > 0 || opts.mojibakeCount > 0
        ? `${opts.brokenCount + opts.changedCount + opts.sslCount + opts.mojibakeCount} issues found`
        : "All URLs healthy &#x2705;"}
    </div>
  </div>

  ${issueSection("&#x1F6A8; Broken URLs", opts.brokenCount, "#dc2626", "#fef2f2", opts.brokenUrls)}
  ${issueSection("&#x1F504; Changed URLs", opts.changedCount, "#d97706", "#fffbeb", opts.changedUrls)}
  ${issueSection("&#x1F512; SSL Expiring Soon", opts.sslCount, "#ea580c", "#fff7ed", opts.sslUrls.map(u => ({ url: u })))}

  <p style="text-align:center;font-size:10px;color:#94a3b8;margin-top:14px;">supacrawl &middot; Automated crawl report</p>
</div>`
}
