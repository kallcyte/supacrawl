import { z } from "zod"

export const CrawlConfigSchema = z.object({
  delayMs: z.number().int().nonnegative().default(2000),
  maxConcurrency: z.number().int().positive().default(2),
  timeoutMs: z.number().int().positive().default(30000),
  userAgent: z.string().min(1).default("supacrawl/0.1"),
  respectRobotsTxt: z.boolean().default(true),
  maxUrls: z.number().int().positive().default(10000),
  retryOnTransientError: z.boolean().default(true),
  maxRetries: z.number().int().nonnegative().default(2)
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
    onCrawlComplete: z.boolean().default(false)
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
  notifications: NotificationsConfigSchema,
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
}

export interface UrlStateRecord {
  url: string
  lastStatusCode: number | null
  lastContentHash: string | null
  lastResponseTimeMs: number | null
  sitemapLastmod: string | null
  lastCheckedAt: string
  consecutiveFailures: number
}

export type NotificationEvent =
  | "onCrawlFailure"
  | "onContentChange"
  | "onSslExpiring"
  | "onCrawlComplete"

export interface NotificationPayload {
  event: NotificationEvent
  title: string
  message: string
  crawlId?: string
  url?: string
  meta?: Record<string, unknown>
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
}
