import { checkMonitor } from "@supacrawl/core"
import { Notifier } from "@supacrawl/core"
import { Storage as D1Storage } from "./storage-d1.js"
import { nextRunAtMs } from "./routes/scheduler-utils.js"
import type { NotificationsConfig, Heartbeat, HeartbeatResult, CrawlJob } from "@supacrawl/core"

export interface CronEnv {
  DB: D1Database
  CRAWL_QUEUE: Queue
  SLACK_WEBHOOK_URL?: string
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
  TEAMS_WEBHOOK_URL?: string
  WEBHOOK_URL?: string
}

/**
 * Unified cron handler: runs every 60s.
 * 1. Checks enabled crawl jobs and enqueues due ones.
 * 2. Checks enabled monitors and records heartbeats + notifications.
 */
export async function scheduled(
  _event: ScheduledEvent,
  env: CronEnv,
  _ctx: ExecutionContext
): Promise<void> {
  const storage = new D1Storage({ db: env.DB })
  const notifier = buildNotifier(env)

  // ── Crawl job scheduling ──
  const jobs = await storage.listCrawlJobs()
  const now = Date.now()
  for (const job of jobs) {
    if (!job.enabled) continue
    const next = nextRunAtMs(job, now)
    if (next === null || now < next) continue

    const crawlId = crypto.randomUUID()
    await env.CRAWL_QUEUE.send({
      type: "crawl:start",
      crawlId,
      jobId: job.id,
      sitemaps: job.sitemapUrls ?? [job.sitemapUrl],
      crawlConfig: {
        delayMs: job.delayMs,
        maxConcurrency: job.maxConcurrency,
        timeoutMs: job.timeoutMs,
        userAgent: job.userAgent,
        respectRobotsTxt: job.respectRobotsTxt,
        maxUrls: job.maxUrls,
        maxBodyBytes: job.maxBodyBytes,
        maxGlobalConcurrency: 32,
        retryOnTransientError: true,
        maxRetries: 2,
        detectMojibake: job.detectMojibake,
        detectLlmGarbage: job.detectLlmGarbage
      },
      notificationProviders: job.notificationProviders ?? undefined,
      startedAt: new Date().toISOString()
    })
  }

  // ── Monitor checks ──
  const monitors = await storage.listEnabledMonitors()
  for (const m of monitors) {
    const previous = await storage.getLatestHeartbeat(m.id)
    // Skip if checked too recently
    if (previous) {
      const elapsed = Date.now() - Date.parse(previous.checkedAt)
      if (elapsed < m.intervalSeconds * 1000 * 0.8) continue
    }

    try {
      const result = await checkMonitor(m)

      const heartbeat: Heartbeat = {
        id: crypto.randomUUID(),
        monitorId: m.id,
        status: result.status,
        responseTimeMs: result.responseTimeMs,
        message: result.message,
        checkedAt: result.checkedAt
      }
      await storage.insertHeartbeat(heartbeat)

      await handleTransition(storage, notifier, m, previous, result)
    } catch (err) {
      console.error(`[cron] monitor ${m.id} (${m.url}) check failed:`, err)
    }
  }

  // Prune old heartbeats (keep 90 days)
  const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString()
  await storage.pruneHeartbeats(cutoff)
}

async function handleTransition(
  storage: D1Storage,
  notifier: Notifier,
  m: { id: string; name: string; url: string },
  previous: Heartbeat | null,
  result: HeartbeatResult
): Promise<void> {
  const inMaintenance = await storage.hasActiveMaintenanceWindow(m.id, result.checkedAt)

  if (result.status === "down" && previous?.status === "up") {
    if (inMaintenance) return
    if (notifier.isEventEnabled("onMonitorDown")) {
      await notifier.notify("onMonitorDown", {
        event: "onMonitorDown",
        title: `Monitor "${m.name}" is DOWN`,
        message: `Monitor "${m.name}" (${m.url}) is down: ${result.message ?? "Check failed"}`,
        url: m.url,
        meta: { monitorId: m.id, status: "down" }
      })
    }
  } else if (result.status === "up" && previous?.status === "down") {
    if (inMaintenance) return
    if (notifier.isEventEnabled("onMonitorRecovery")) {
      await notifier.notify("onMonitorRecovery", {
        event: "onMonitorRecovery",
        title: `Monitor "${m.name}" is UP again`,
        message: `Monitor "${m.name}" (${m.url}) recovered and is back online.`,
        url: m.url,
        meta: { monitorId: m.id, status: "up" }
      })
    }
  }
}

function buildNotifier(env: CronEnv): Notifier {
  const cfg: NotificationsConfig = {
    providers: {
      slack: {
        enabled: !!env.SLACK_WEBHOOK_URL,
        webhookUrl: env.SLACK_WEBHOOK_URL
      },
      telegram: {
        enabled: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
        botToken: env.TELEGRAM_BOT_TOKEN,
        chatId: env.TELEGRAM_CHAT_ID
      },
      teams: {
        enabled: !!env.TEAMS_WEBHOOK_URL,
        webhookUrl: env.TEAMS_WEBHOOK_URL
      },
      webhook: {
        enabled: !!env.WEBHOOK_URL,
        url: env.WEBHOOK_URL,
        secret: undefined
      },
      email: { enabled: false, smtp: {}, from: undefined, to: [] }
    }
  }
  return new Notifier(cfg)
}
