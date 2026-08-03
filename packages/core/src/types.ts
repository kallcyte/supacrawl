import { z } from "zod"

export const CrawlConfigSchema = z.object({
  delayMs: z.number().int().nonnegative().default(2000),
  maxConcurrency: z.number().int().positive().default(2),
  timeoutMs: z.number().int().positive().default(30000),
  userAgent: z.string().min(1).default("supacrawl/0.1"),
  respectRobotsTxt: z.boolean().default(true),
  maxUrls: z.number().int().positive().default(999999),
  retryOnTransientError: z.boolean().default(true),
  maxRetries: z.number().int().nonnegative().default(2),
  detectMojibake: z.boolean().default(true)
})
export type CrawlConfig = z.infer<typeof CrawlConfigSchema>

export const ChecksConfigSchema = z.object({
  ssl: z.object({
    enabled: z.boolean().default(true),
    warnDays: z.number().int().positive().default(30)
  }),
  contentDiff: z.boolean().default(true),
  responseTime: z.object({
    warnMs: z.number().int().positive().default(3000)
  })
})
export type ChecksConfig = z.infer<typeof ChecksConfigSchema>

export const SlackConfigSchema = z.object({
  enabled: z.boolean(),
  webhookUrl: z.string().optional()
})
export type SlackConfig = z.infer<typeof SlackConfigSchema>

export const TelegramConfigSchema = z.object({
  enabled: z.boolean(),
  botToken: z.string().optional(),
  chatId: z.string().optional()
})
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>

export const EmailConfigSchema = z.object({
  enabled: z.boolean(),
  smtp: z.object({
    host: z.string().optional(),
    port: z.number().int().positive().optional(),
    secure: z.boolean().optional(),
    user: z.string().optional(),
    pass: z.string().optional()
  }),
  from: z.string().optional(),
  to: z.array(z.string()).default([])
})
export type EmailConfig = z.infer<typeof EmailConfigSchema>

export const WebhookConfigSchema = z.object({
  enabled: z.boolean(),
  url: z.string().optional(),
  secret: z.string().optional()
})
export type WebhookConfig = z.infer<typeof WebhookConfigSchema>

export const NotificationsConfigSchema = z.object({
  providers: z.object({
    slack: SlackConfigSchema,
    telegram: TelegramConfigSchema,
    email: EmailConfigSchema,
    webhook: WebhookConfigSchema
  }),
  events: z.object({
    onCrawlFailure: z.boolean().default(true),
    onContentChange: z.boolean().default(true),
    onSslExpiring: z.boolean().default(true),
    onCrawlComplete: z.boolean().default(false),
    onMojibakeDetected: z.boolean().default(false),
    onCrawlProgress: z.boolean().default(false),
    onMonitorDown: z.boolean().default(true),
    onMonitorRecovery: z.boolean().default(true)
  })
})
export type NotificationsConfig = z.infer<typeof NotificationsConfigSchema>

export const SitemapConfigSchema = z.object({
  url: z.string().url(),
  enabled: z.boolean().default(true)
})
export type SitemapConfig = z.infer<typeof SitemapConfigSchema>

export const ConfigSchema = z.object({
  sitemaps: z.array(
    z.union([
      z.string().url().transform((url) => ({ url, enabled: true })),
      SitemapConfigSchema
    ])
  ).min(1),
  crawl: CrawlConfigSchema,
  checks: ChecksConfigSchema,
  notifications: NotificationsConfigSchema.default({
    providers: {
      slack: { enabled: false, webhookUrl: undefined },
      telegram: { enabled: false, botToken: undefined, chatId: undefined },
      email: {
        enabled: false,
        smtp: { host: undefined, port: 587, secure: undefined, user: undefined, pass: undefined },
        from: undefined,
        to: []
      },
      webhook: { enabled: false, url: undefined, secret: undefined }
    },
    events: {
      onCrawlFailure: true,
      onContentChange: true,
      onSslExpiring: true,
      onCrawlComplete: false,
      onMojibakeDetected: false,
      onCrawlProgress: false,
      onMonitorDown: true,
      onMonitorRecovery: true
    }
  }),
  schedule: z.string().optional()
})
export type Config = z.infer<typeof ConfigSchema>

export type CrawlStatus = "pending" | "running" | "completed" | "failed"
export type CheckMethod = "GET" | "HEAD" | "skipped"

export interface SitemapEntry {
  loc: string
  lastmod?: string
  changefreq?: string
  priority?: number
}

export interface SitemapResult {
  urls: SitemapEntry[]
  errors: string[]
}

export interface CrawlRecord {
  id: string
  jobId: string | null
  startedAt: string
  finishedAt: string | null
  status: CrawlStatus
  urlsTotal: number
  urlsChecked: number
  urlsChanged: number
  urlsBroken: number
  urlsSkipped: number
  errorMessage: string | null
}

export interface SeoInfo {
  title: string | null
  titleLength: number
  description: string | null
  descriptionLength: number
  canonical: string | null
  canonicalSelfReference: boolean | null
  noindex: boolean
  nofollow: boolean
  h1Count: number
  wordCount: number
  pageWeightBytes: number
  jsonLdTypes: string[]
  ogTitle: string | null
  ogDescription: string | null
  ogImage: string | null
  publishedAt: string | null
}

export interface CrawlResultRecord {
  id: string
  crawlId: string
  url: string
  statusCode: number | null
  responseTimeMs: number | null
  contentHash: string | null
  contentChanged: boolean
  error: string | null
  redirectChain: string | null
  sslValidUntil: string | null
  sitemapLastmod: string | null
  checkedAt: string
  checkMethod: CheckMethod
  mojibakeScore: number | null
  mojibakeFlagged: boolean
  seo: SeoInfo | null
}

export interface UrlStateRecord {
  url: string
  lastStatusCode: number | null
  lastContentHash: string | null
  lastResponseTimeMs: number | null
  sitemapLastmod: string | null
  lastCheckedAt: string
  consecutiveFailures: number
  hasSeo: boolean
}

export type NotificationEvent =
  | "onCrawlFailure"
  | "onContentChange"
  | "onSslExpiring"
  | "onCrawlComplete"
  | "onMojibakeDetected"
  | "onCrawlProgress"
  | "onMonitorDown"
  | "onMonitorRecovery"

export interface CrawlSummaryIssue {
  url: string
  detail: string
  severity: "high" | "medium" | "low"
}

export interface CrawlSummary {
  crawlId: string
  jobName?: string
  status: CrawlStatus
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  totalUrls: number
  checkedUrls: number
  healthScore: number // 0-100
  avgResponseTimeMs: number | null
  slowestResponseTimeMs: number | null
  fastestResponseTimeMs: number | null
  issues: {
    broken: CrawlSummaryIssue[]
    changed: CrawlSummaryIssue[]
    sslExpiring: CrawlSummaryIssue[]
    mojibake: CrawlSummaryIssue[]
  }
}

export interface CrawlReportUrls {
  broken: { url: string; detail?: string }[]
  changed: { url: string; detail?: string }[]
  sslExpiring: { url: string; detail?: string }[]
  mojibake: { url: string; detail?: string }[]
}

export interface CrawlReportStats {
  healthScore: number
  totalChecked: number
  totalFound: number
  brokenCount: number
  changedCount: number
  sslCount: number
  mojibakeCount: number
  avgResponseTimeMs: number | null
  fastestResponseTimeMs: number | null
  slowestResponseTimeMs: number | null
}

export interface NotificationPayload {
  event: NotificationEvent
  title: string
  message: string
  htmlBody?: string
  crawlId?: string
  url?: string
  meta?: Record<string, unknown>
  reportStats?: CrawlReportStats
  reportUrls?: CrawlReportUrls
}

export interface CrawlProgress {
  crawlId: string
  total: number
  checked: number
  changed: number
  broken: number
  skipped: number
  currentUrl?: string
  status: CrawlStatus
  startedAt: string
  finishedAt?: string
}

export const IntervalUnitSchema = z.enum(["minutes", "hours", "days"])
export type IntervalUnit = z.infer<typeof IntervalUnitSchema>

export const JobNotificationProvidersSchema = z.object({
  slack: z.object({
    enabled: z.boolean(),
    webhookUrl: z.string().optional()
  }).optional(),
  telegram: z.object({
    enabled: z.boolean(),
    botToken: z.string().optional(),
    chatId: z.string().optional()
  }).optional(),
  email: z.object({
    enabled: z.boolean(),
    smtp: z.object({
      host: z.string().optional(),
      port: z.number().int().positive().optional(),
      secure: z.boolean().optional(),
      user: z.string().optional(),
      pass: z.string().optional()
    }).optional(),
    from: z.string().optional(),
    to: z.array(z.string()).optional()
  }).optional(),
  webhook: z.object({
    enabled: z.boolean(),
    url: z.string().optional(),
    secret: z.string().optional()
  }).optional()
})

export type JobNotificationProviders = z.infer<typeof JobNotificationProvidersSchema>

export const CrawlJobSchema = z.object({
  name: z.string().min(1, "Name is required"),
  sitemapUrl: z.string().url("Valid URL (site or sitemap) is required"),
  sitemapUrls: z.array(z.string().url()).nullable().optional(),
  enabled: z.boolean().default(true),
  intervalValue: z.number().int().positive().default(60),
  intervalUnit: IntervalUnitSchema.default("minutes"),
  runAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional().default(null),
  notifyOnComplete: z.boolean().default(false),
  notifyOnFailure: z.boolean().default(true),
  notifyOnChange: z.boolean().default(true),
  notifyOnMojibake: z.boolean().default(false),
  notifySslExpiring: z.boolean().default(true),
  notifyOnProgress: z.boolean().default(false),
  detectMojibake: z.boolean().optional().default(true),
  delayMs: z.number().int().nonnegative().default(2000),
  maxConcurrency: z.number().int().positive().default(2),
  timeoutMs: z.number().int().positive().default(30000),
  userAgent: z.string().min(1).default("supacrawl/0.1"),
  respectRobotsTxt: z.boolean().default(true),
  maxUrls: z.number().int().positive().default(999999),
  notificationProviders: JobNotificationProvidersSchema.nullable().optional()
})

export interface CrawlJob {
  id: string
  name: string
  sitemapUrl: string
  sitemapUrls: string[] | null
  enabled: boolean
  intervalValue: number
  intervalUnit: IntervalUnit
  runAt: string | null
  notifyOnComplete: boolean
  notifyOnFailure: boolean
  notifyOnChange: boolean
  notifyOnMojibake: boolean
  notifySslExpiring: boolean
  notifyOnProgress: boolean
  detectMojibake: boolean
  delayMs: number
  maxConcurrency: number
  timeoutMs: number
  userAgent: string
  respectRobotsTxt: boolean
  maxUrls: number
  notificationProviders: JobNotificationProviders | null
  createdAt: string
  updatedAt: string
  lastRunAt: string | null
  lastRunStatus: CrawlStatus | null
}

export const CrawlJobExportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  jobs: z.array(CrawlJobSchema.extend({
    id: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    lastRunAt: z.string().nullable().optional(),
    lastRunStatus: z.string().nullable().optional()
  }))
})
export type CrawlJobExport = z.infer<typeof CrawlJobExportSchema>

export interface CheckResult {
  url: string
  statusCode: number | null
  responseTimeMs: number | null
  contentHash: string | null
  contentChanged: boolean
  error: string | null
  redirectChain: string[]
  sslValidUntil: string | null
  checkMethod: CheckMethod
  mojibakeScore: number | null
  mojibakeFlagged: boolean
  seo: SeoInfo | null
}

export interface UserNotificationSettings {
  userId: string
  slack: { enabled: boolean; webhookUrl?: string }
  telegram: { enabled: boolean; botToken?: string; chatId?: string }
  email: { enabled: boolean; smtp?: { host?: string; port?: number; secure?: boolean; user?: string; pass?: string }; from?: string; to?: string[] }
  webhook: { enabled: boolean; url?: string; secret?: string }
  enabledEvents: {
    onCrawlFailure: boolean
    onContentChange: boolean
    onSslExpiring: boolean
    onCrawlComplete: boolean
    onMojibakeDetected: boolean
    onCrawlProgress: boolean
    onMonitorDown: boolean
    onMonitorRecovery: boolean
  }
  updatedAt: string
}

export const MonitorTypeSchema = z.enum(["http", "tcp", "ping", "dns"])
export type MonitorType = z.infer<typeof MonitorTypeSchema>

export const MonitorSourceSchema = z.enum(["manual", "crawl_job"])
export type MonitorSource = z.infer<typeof MonitorSourceSchema>

export const MonitorSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: MonitorTypeSchema.default("http"),
  url: z.string().min(1, "Target URL is required"),
  method: z.string().default("GET"),
  expectedStatus: z.number().int().default(200),
  expectedBody: z.string().nullable().optional(),
  intervalSeconds: z.number().int().positive().default(60),
  retryCount: z.number().int().nonnegative().default(3),
  timeoutMs: z.number().int().positive().default(10000),
  acceptedResponseTimeMs: z.number().int().positive().default(5000),
  enabled: z.boolean().default(true),
  source: MonitorSourceSchema.default("manual"),
  jobId: z.string().nullable().optional()
})
export type Monitor = z.infer<typeof MonitorSchema>

export interface MonitorRecord extends Monitor {
  id: string
  jobId: string | null
  createdAt: string
  updatedAt: string
}

export const HeartbeatStatusSchema = z.enum(["up", "down", "pending"])
export type HeartbeatStatus = z.infer<typeof HeartbeatStatusSchema>

export interface Heartbeat {
  id: string
  monitorId: string
  status: HeartbeatStatus
  responseTimeMs: number | null
  message: string | null
  checkedAt: string
}

export interface HeartbeatResult {
  monitorId: string
  status: HeartbeatStatus
  responseTimeMs: number | null
  message: string | null
  checkedAt: string
}

export interface MonitorWithStatus extends MonitorRecord {
  latestHeartbeat: Heartbeat | null
  currentStatus: HeartbeatStatus | null
  recentHeartbeats: Heartbeat[]
  uptime24h: number | null
  uptime7d: number | null
  uptime30d: number | null
}

export interface MonitorStats {
  uptime24h: number | null
  uptime7d: number | null
  uptime30d: number | null
  uptime365d: number | null
  avgResponseTimeMs: number | null
  minResponseTimeMs: number | null
  maxResponseTimeMs: number | null
}

export const StatusPageSchema = z.object({
  slug: z.string().min(1, "Slug is required").regex(/^[a-z0-9-]+$/i, "Slug may only contain letters, numbers and dashes"),
  title: z.string().min(1, "Title is required"),
  description: z.string().nullable().optional(),
  showResponseTimes: z.boolean().default(true),
  public: z.boolean().default(true)
})
export type StatusPage = z.infer<typeof StatusPageSchema>

export interface StatusPageRecord extends StatusPage {
  id: string
  createdAt: string
}

export interface StatusPageMonitor {
  statusPageId: string
  monitorId: string
  sortOrder: number
}

export const MaintenanceWindowSchema = z.object({
  monitorId: z.string(),
  title: z.string().min(1, "Title is required"),
  description: z.string().nullable().optional(),
  startAt: z.string(),
  endAt: z.string()
})
export type MaintenanceWindow = z.infer<typeof MaintenanceWindowSchema>

export interface MaintenanceWindowRecord extends MaintenanceWindow {
  id: string
  createdAt: string
}
