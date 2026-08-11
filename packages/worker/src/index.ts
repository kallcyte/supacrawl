import { Hono } from "hono"
import { createAuthD1, type Auth } from "./auth-d1.js"
import { Storage as D1Storage } from "./storage-d1.js"
import { Notifier, ConfigSchema, type Config } from "@supacrawl/core"
import type { RouteDeps } from "./routes/route-deps.js"
import { setDeps } from "./routes/route-deps.js"
import { crawlsRoutes } from "./routes/crawls.js"
import { crawlJobsRoutes } from "./routes/crawl-jobs.js"
import { resultsRoutes } from "./routes/results.js"
import { urlsRoutes } from "./routes/urls.js"
import { statsRoutes } from "./routes/stats.js"
import { settingsRoutes } from "./routes/settings.js"
import { usersRoutes } from "./routes/users.js"
import { notifiersRoutes } from "./routes/notifiers.js"
import { authRoutes } from "./routes/auth.js"
import { userNotificationsRoutes } from "./routes/user-notifications.js"
import { monitorsRoutes } from "./routes/monitors.js"
import { setupRoutes } from "./routes/setup.js"
import { runCrawlExecutor } from "./crawl-executor.js"
import type { NotificationsConfig } from "@supacrawl/core"
import { scheduled as cronScheduled } from "./cron-handler.js"

export interface Env {
  DB: D1Database
  CRAWL_QUEUE: Queue
  CRAWL_DLQ: Queue
  CRAWL_SESSION: DurableObjectNamespace
  ASSETS: Fetcher
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  BETTER_AUTH_TRUSTED_ORIGINS: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  SLACK_WEBHOOK_URL?: string
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
  TEAMS_WEBHOOK_URL?: string
  WEBHOOK_URL?: string
}

interface CrawlMessage {
  type: "crawl:start"
  crawlId: string
  jobId?: string
  sitemaps: string[]
  crawlConfig?: Record<string, unknown>
  notificationProviders?: Record<string, { enabled?: boolean }>
}

// Module-level (lazy-init) singletons — Workers serializes requests per isolate,
// so a single set of deps is safe as long as we re-init on cold start (env ref change).
let _deps: RouteDeps | null = null
let _auth: Auth | null = null
let _lastDb: D1Database | null = null

// Default in-memory config (dummy sitemap — crawl jobs carry their own)
const DEFAULT_WORKER_CONFIG: Config = ConfigSchema.parse({
  sitemaps: [{ url: "https://example.com/sitemap.xml", enabled: true }],
  crawl: {
    delayMs: 2000,
    maxConcurrency: 2,
    timeoutMs: 30000,
    userAgent: "supacrawl/0.1",
    respectRobotsTxt: true,
    maxUrls: 999999,
    retryOnTransientError: true,
    maxRetries: 2,
    detectMojibake: true,
    detectLlmGarbage: true,
    maxBodyBytes: 256 * 1024,
    maxGlobalConcurrency: 32
  },
  checks: {
    ssl: { enabled: true, warnDays: 30 },
    contentDiff: true,
    responseTime: { warnMs: 3000 }
  }
})

async function initDeps(env: Env): Promise<RouteDeps> {
  // Re-init if DB reference changed (different isolate/cold start)
  if (_deps && _lastDb === env.DB) return _deps

  _lastDb = env.DB
  const storage = new D1Storage({ db: env.DB })

  // Load config from D1 or use defaults
  const configRaw = await storage.getSetting("config")
  const config: Config = configRaw
    ? { ...DEFAULT_WORKER_CONFIG, ...JSON.parse(configRaw) }
    : { ...DEFAULT_WORKER_CONFIG }

  const notifier = new Notifier(config.notifications ?? { providers: {} })

  const trustedOrigins = (env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
    .split(",").map((s: string) => s.trim()).filter(Boolean)

  const auth = createAuthD1({
    db: env.DB,
    github: env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
      : undefined,
    secret: env.BETTER_AUTH_SECRET,
    baseUrl: env.BETTER_AUTH_URL,
    trustedOrigins: trustedOrigins.length > 0 ? trustedOrigins : undefined,
  })

  _auth = auth
  _deps = { auth, storage, notifier, config, db: env.DB, crawlQueue: env.CRAWL_QUEUE }
  return _deps
}

// ─── App ───────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>()

// CORS middleware (uses env bindings, not process.env)
app.use("*", async (c, next) => {
  const trusted = (c.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
    .split(",").map((s: string) => s.trim()).filter(Boolean)
  const origin = c.req.header("origin")
  const allowed = trusted.length > 0 && origin
    ? (trusted.includes(origin) ? origin : trusted[0])
    : "*"

  c.res.headers.set("Access-Control-Allow-Origin", allowed)
  c.res.headers.set("Access-Control-Allow-Credentials", "true")
  c.res.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
  c.res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization")

  if (c.req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: c.res.headers })
  }

  await next()
})

// Init deps on every request (lazy-cached) + set global for route handlers
app.use("*", async (c, next) => {
  const deps = await initDeps(c.env)
  setDeps(deps)
  await next()
})

// Health check
app.get("/api/health", (c) => c.json({ status: "ok", ts: Date.now() }))

// Wire all route groups
crawlsRoutes(app)
crawlJobsRoutes(app)
resultsRoutes(app)
urlsRoutes(app)
statsRoutes(app)
settingsRoutes(app)
usersRoutes(app)
notifiersRoutes(app)
// Custom auth routes (forgot/reset password) must be registered BEFORE
// the better-auth catch-all below, otherwise Hono's first-match-wins will
// route /api/auth/custom-forgot-password to better-auth and return 404.
authRoutes(app)
userNotificationsRoutes(app)
monitorsRoutes(app)
setupRoutes(app)

// better-auth handler — catch-all for anything else under /api/auth/*.
// Registered LAST so the explicit custom routes above take precedence.
app.all("/api/auth/*", async (c) => {
  const deps = await initDeps(c.env)
  return deps.auth.handler(c.req.raw)
})

// SPA fallback: anything that isn't /api/* gets served from ASSETS.
// `not_found_handling = "single-page-application"` makes ASSETS return index.html
// for unknown paths so client-side routes work.
app.get("*", async (c) => {
  return c.env.ASSETS.fetch(c.req.raw)
})

// ─── Queue handler ──────────────────────────────────────────────────
// Must be a method on the default export for Wrangler to detect it.

async function handleQueue(
  batch: MessageBatch<CrawlMessage>,
  env: Env
): Promise<void> {
  const storage = new D1Storage({ db: env.DB })

  for (const msg of batch.messages) {
    const { crawlId, jobId, sitemaps, crawlConfig, notificationProviders } = msg.body

    try {
      const configRaw = await storage.getSetting("config")
      const storedConfig = configRaw ? JSON.parse(configRaw) : {}

      const crawlCfg = crawlConfig ?? storedConfig?.crawl ?? {
        delayMs: 2000,
        maxConcurrency: 2,
        timeoutMs: 30000,
        userAgent: "supacrawl/0.1",
        respectRobotsTxt: true,
        maxUrls: 999999,
        maxBodyBytes: 256 * 1024,
        maxGlobalConcurrency: 32,
        retryOnTransientError: true,
        maxRetries: 2,
        detectMojibake: true,
        detectLlmGarbage: true
      }

      const storedNotif: NotificationsConfig = storedConfig?.notifications ?? { providers: {} }
      const notifCfg: NotificationsConfig = {
        providers: {
          slack: {
            enabled: storedNotif.providers?.slack?.enabled ?? !!env.SLACK_WEBHOOK_URL,
            webhookUrl: env.SLACK_WEBHOOK_URL ?? storedNotif.providers?.slack?.webhookUrl
          },
          telegram: {
            enabled: storedNotif.providers?.telegram?.enabled ?? !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
            botToken: env.TELEGRAM_BOT_TOKEN ?? storedNotif.providers?.telegram?.botToken,
            chatId: env.TELEGRAM_CHAT_ID ?? storedNotif.providers?.telegram?.chatId
          },
          teams: {
            enabled: storedNotif.providers?.teams?.enabled ?? !!env.TEAMS_WEBHOOK_URL,
            webhookUrl: env.TEAMS_WEBHOOK_URL ?? storedNotif.providers?.teams?.webhookUrl
          },
          webhook: {
            enabled: storedNotif.providers?.webhook?.enabled ?? !!env.WEBHOOK_URL,
            url: env.WEBHOOK_URL ?? storedNotif.providers?.webhook?.url,
            secret: storedNotif.providers?.webhook?.secret
          },
          email: { enabled: false, smtp: {}, from: undefined, to: [] }
        },
        events: {
          onCrawlFailure: storedNotif.events?.onCrawlFailure ?? true,
          onContentChange: storedNotif.events?.onContentChange ?? true,
          onSslExpiring: storedNotif.events?.onSslExpiring ?? true,
          onCrawlComplete: storedNotif.events?.onCrawlComplete ?? true,
          onMojibakeDetected: storedNotif.events?.onMojibakeDetected ?? false,
          onLlmGarbageDetected: storedNotif.events?.onLlmGarbageDetected ?? false,
          onCrawlProgress: storedNotif.events?.onCrawlProgress ?? false,
          onMonitorDown: storedNotif.events?.onMonitorDown ?? true,
          onMonitorRecovery: storedNotif.events?.onMonitorRecovery ?? true
        }
      }

      let notifier: Notifier
      if (notificationProviders && Object.values(notificationProviders).some(p => p?.enabled)) {
        notifier = new Notifier(Notifier.configFromJob({
          notificationProviders,
          notifyOnComplete: true,
          notifyOnFailure: true,
          notifyOnChange: true,
          notifyOnMojibake: false,
          notifyOnLlmGarbage: false,
          notifySslExpiring: true,
          notifyOnProgress: false
        }))
      } else {
        notifier = new Notifier(notifCfg)
      }

      await runCrawlExecutor({
        crawlId,
        storage,
        notifier,
        config: crawlCfg as Parameters<typeof runCrawlExecutor>[0]["config"],
        sitemaps,
        jobId
      })

      if (jobId) {
        await storage.updateCrawlJob(jobId, {
          lastRunAt: new Date().toISOString(),
          lastRunStatus: "completed"
        })
      }

      msg.ack()
    } catch (err) {
      console.error(`[queue] crawl ${crawlId} failed:`, err)

      if (jobId) {
        try {
          await storage.updateCrawlJob(jobId, {
            lastRunAt: new Date().toISOString(),
            lastRunStatus: "failed"
          })
        } catch { /* best effort */ }
      }

      if (msg.attempts < 3) {
        msg.retry({ delaySeconds: 30 })
      } else {
        await env.CRAWL_DLQ.send(msg.body)
        msg.ack()
      }
    }
  }
}

// Default export: Hono app (fetch) + queue consumer + scheduled + DO
// Queue and scheduled handlers MUST be methods on the default export per Cloudflare spec.
export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<CrawlMessage>, env: Env, _ctx: ExecutionContext): Promise<void> {
    return handleQueue(batch, env)
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    return cronScheduled(event, env, ctx)
  }
}

// Durable Object for crawl progress streaming
export { CrawlSession } from "./crawl-session.js"
