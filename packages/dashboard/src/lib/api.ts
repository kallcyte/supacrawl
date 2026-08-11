export interface CrawlRecord {
  id: string
  jobId: string | null
  startedAt: string
  finishedAt: string | null
  status: "pending" | "running" | "completed" | "failed"
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

export interface CrawlResult {
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
  checkMethod: "GET" | "HEAD" | "skipped"
  mojibakeScore: number | null
  mojibakeFlagged: boolean
  llmGarbageScore: number | null
  llmGarbageFlagged: boolean
  seo: SeoInfo | null
}

export interface UrlState {
  url: string
  lastStatusCode: number | null
  lastContentHash: string | null
  lastResponseTimeMs: number | null
  sitemapLastmod: string | null
  lastCheckedAt: string
  consecutiveFailures: number
}

export interface OverviewStats {
  totalUrls: number
  totalCrawls: number
  lastCrawlAt: string | null
  lastCrawlBroken: number
  lastCrawlChanged: number
  brokenNow: number
}

export interface TimelinePoint {
  date: string
  healthy: number
  broken: number
}

export interface DurationPoint {
  id: string
  startedAt: string
  durationMs: number
}

export interface CrawlJob {
  id: string
  name: string
  sitemapUrl: string
  sitemapUrls: string[] | null
  enabled: boolean
  intervalValue: number
  intervalUnit: "minutes" | "hours" | "days"
  runAt: string | null
  notifyOnComplete: boolean
  notifyOnFailure: boolean
  notifyOnChange: boolean
  notifyOnMojibake: boolean
  notifyOnLlmGarbage: boolean
  detectMojibake: boolean
  detectLlmGarbage: boolean
  delayMs: number
  maxConcurrency: number
  timeoutMs: number
  userAgent: string
  respectRobotsTxt: boolean
  maxUrls: number
  createdAt: string
  updatedAt: string
  lastRunAt: string | null
  lastRunStatus: string | null
  nextRunAt?: string | null
  notifyOnProgress: boolean
  notificationProviders: Record<string, unknown> | null
}

export interface SitemapTreeNode {
  url: string
  leafCount: number
  children: SitemapTreeNode[]
}

export interface CrawlSummaryIssue {
  url: string
  detail: string
  severity: "high" | "medium" | "low"
}

export interface CrawlSummary {
  crawlId: string
  jobName?: string
  status: CrawlRecord["status"]
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  totalUrls: number
  checkedUrls: number
  healthScore: number
  avgResponseTimeMs: number | null
  slowestResponseTimeMs: number | null
  fastestResponseTimeMs: number | null
  issues: {
    broken: CrawlSummaryIssue[]
    changed: CrawlSummaryIssue[]
    sslExpiring: CrawlSummaryIssue[]
    mojibake: CrawlSummaryIssue[]
    llmGarbage: CrawlSummaryIssue[]
  }
}

export interface StatusBucket {
  status: string
  count: number
}

export type MonitorType = "http" | "tcp" | "ping" | "dns"
export type MonitorSource = "manual" | "crawl_job"
export type HeartbeatStatus = "up" | "down" | "pending"

export interface Monitor {
  id: string
  name: string
  type: MonitorType
  url: string
  method: string
  expectedStatus: number
  expectedBody: string | null
  intervalSeconds: number
  retryCount: number
  timeoutMs: number
  acceptedResponseTimeMs: number
  enabled: boolean
  source: MonitorSource
  jobId: string | null
  createdAt: string
  updatedAt: string
}

export interface Heartbeat {
  id: string
  monitorId: string
  status: HeartbeatStatus
  responseTimeMs: number | null
  message: string | null
  checkedAt: string
}

export interface MonitorWithStatus extends Monitor {
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

export interface User {
  id: string
  email: string
  name: string
  role: "admin" | "user"
}

class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API error ${status}`)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = Boolean(init?.body)
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {})
    }
  })
  if (!res.ok) {
    let body: unknown
    try {
      body = await res.json()
    } catch {
      body = await res.text()
    }
    throw new ApiError(res.status, body)
  }
  const ct = res.headers.get("content-type") ?? ""
  if (ct.includes("application/json")) {
    return (await res.json()) as T
  }
  return (await res.text()) as unknown as T
}

export const api = {
  health: () => request<{ ok: boolean }>("/api/health"),
  listCrawls: (limit = 50, offset = 0) =>
    request<{ crawls: CrawlRecord[]; total: number }>(
      `/api/crawls?limit=${limit}&offset=${offset}`
    ),
  getCrawl: (id: string) => request<CrawlRecord>(`/api/crawls/${id}`),
  startCrawl: () =>
    request<{ crawlId: string; startedAt: string }>("/api/crawls/start", { method: "POST" }),
  cancelCrawl: (id: string) =>
    request<{ ok: boolean }>(`/api/crawls/${id}/cancel`, { method: "POST" }),
  deleteCrawl: (id: string) =>
    request<{ ok: boolean }>(`/api/crawls/${id}`, { method: "DELETE" }),
  listResults: (id: string, opts?: { brokenOnly?: boolean; changedOnly?: boolean; mojibakeOnly?: boolean; llmGarbageOnly?: boolean }) => {
    const q = new URLSearchParams()
    if (opts?.brokenOnly) q.set("brokenOnly", "true")
    if (opts?.changedOnly) q.set("changedOnly", "true")
    if (opts?.mojibakeOnly) q.set("mojibakeOnly", "true")
    if (opts?.llmGarbageOnly) q.set("llmGarbageOnly", "true")
    const qs = q.toString()
    return request<{ crawlId: string; results: CrawlResult[] }>(
      `/api/crawls/${id}/results${qs ? "?" + qs : ""}`
    )
  },
  getStatusDistribution: (id: string) =>
    request<StatusBucket[]>(`/api/crawls/${id}/status-distribution`),
  listUrls: (limit = 500, offset = 0) =>
    request<{ urls: UrlState[] }>(`/api/urls?limit=${limit}&offset=${offset}`),
  getUrlHistory: (url: string, limit = 100) =>
    request<{ url: string; history: CrawlResult[] }>(
      `/api/urls/history?url=${encodeURIComponent(url)}&limit=${limit}`
    ),
  getOverview: () => request<OverviewStats>("/api/stats/overview"),
  getTimeline: () => request<{ timeline: TimelinePoint[] }>("/api/stats/timeline"),
  getDurationTrend: () => request<{ trend: DurationPoint[] }>("/api/stats/duration-trend"),
  getSettings: () => request<unknown>("/api/settings"),
  updateSettings: (body: unknown) =>
    request<{ ok: boolean }>("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  getNotifiers: () => request<{ enabled: string[]; config: unknown }>("/api/notifiers"),
  updateNotifiers: (body: unknown) =>
    request<{ ok: boolean; error?: string }>("/api/notifiers", { method: "PUT", body: JSON.stringify(body) }),
  testNotifier: (name: string, config?: unknown) =>
    request<{ ok: boolean; error?: string }>(`/api/notifiers/${name}/test`, {
      method: "POST",
      body: config ? JSON.stringify({ config }) : undefined
    }),
  listUsers: () => request<{ users: User[] } | User[]>("/api/admin/users"),
  createUser: (body: { email: string; password: string; name?: string; role: "admin" | "user" }) =>
    request<{ user: User }>("/api/admin/users", { method: "POST", body: JSON.stringify(body) }),
  setUserRole: (id: string, role: "admin" | "user") =>
    request<{ user: User }>(`/api/admin/users/${id}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role })
    }),
  deleteUser: (id: string) =>
    request<{ ok: boolean }>(`/api/admin/users/${id}`, { method: "DELETE" }),

  setupStatus: () =>
    request<{ hasUsers: boolean; allowRegistration: boolean }>("/api/setup/status"),

  createFirstAdmin: (body: { email: string; password: string; name?: string }) =>
    request<{ user: { id: string; email: string } }>("/api/setup/first-admin", {
      method: "POST",
      body: JSON.stringify(body)
    }),

  registerUser: (body: { email: string; password: string; name?: string }) =>
    request<{ user: { id: string; email: string } }>("/api/setup/register", {
      method: "POST",
      body: JSON.stringify(body)
    }),

  setRegistration: (allowRegistration: boolean) =>
    request<{ allowRegistration: boolean }>("/api/setup/registration", {
      method: "PUT",
      body: JSON.stringify({ allowRegistration })
    }),

  listCrawlJobs: () => request<{ jobs: CrawlJob[]; running: string[] }>("/api/crawl-jobs"),

  getCrawlJob: (id: string) => request<CrawlJob>(`/api/crawl-jobs/${id}`),

  createCrawlJob: (body: Partial<CrawlJob>) =>
    request<CrawlJob>("/api/crawl-jobs", { method: "POST", body: JSON.stringify(body) }),

  updateCrawlJob: (id: string, body: Partial<CrawlJob>) =>
    request<CrawlJob>(`/api/crawl-jobs/${id}`, { method: "PUT", body: JSON.stringify(body) }),

  deleteCrawlJob: (id: string) =>
    request<{ ok: boolean }>(`/api/crawl-jobs/${id}`, { method: "DELETE" }),

  startCrawlJob: (id: string) =>
    request<{ crawlId: string; startedAt: string }>(`/api/crawl-jobs/${id}/start`, { method: "POST" }),

  stopCrawlJob: (id: string) =>
    request<{ ok: boolean }>(`/api/crawl-jobs/${id}/stop`, { method: "POST" }),

  getCrawlJobHistory: (id: string) =>
    request<{ crawls: CrawlRecord[] }>(`/api/crawl-jobs/${id}/history`),

  getActiveCrawls: () =>
    request<{ crawls: CrawlRecord[] }>("/api/crawls/active"),

  getCrawlSummary: (id: string) =>
    request<CrawlSummary>(`/api/crawls/${id}/summary`),

  discoverSitemapTree: (url: string) =>
    request<SitemapTreeNode>("/api/crawl-jobs/discover", { method: "POST", body: JSON.stringify({ url }) }),

  exportCrawlJobs: () =>
    request<{ version: 1; exportedAt: string; jobs: CrawlJob[] }>("/api/crawl-jobs/export"),

  importCrawlJobs: (data: { version: 1; exportedAt: string; jobs: CrawlJob[] }) =>
    request<{ imported: number }>("/api/crawl-jobs/import", { method: "POST", body: JSON.stringify(data) }),

  getUserNotifications: () =>
    request<UserNotificationSettings>("/api/user/notifications"),

  updateUserNotifications: (body: Partial<UserNotificationSettings>) =>
    request<{ ok: boolean }>("/api/user/notifications", { method: "PUT", body: JSON.stringify(body) }),

  listMonitors: (params?: { page?: number; perPage?: number }) =>
    request<{
      monitors: MonitorWithStatus[]
      page: number
      perPage: number
      totalPages: number
      totalMonitors: number
      totalDomains: number
    }>(
      `/api/monitors${params ? `?page=${params.page ?? 1}&perPage=${params.perPage ?? 5}` : ""}`
    ),

  getMonitor: (id: string) =>
    request<{ monitor: Monitor; stats: MonitorStats; running: boolean }>(`/api/monitors/${id}`),

  createMonitor: (body: Partial<Monitor>) =>
    request<Monitor>("/api/monitors", { method: "POST", body: JSON.stringify(body) }),

  updateMonitor: (id: string, body: Partial<Monitor>) =>
    request<Monitor>(`/api/monitors/${id}`, { method: "PUT", body: JSON.stringify(body) }),

  deleteMonitor: (id: string) =>
    request<{ ok: boolean }>(`/api/monitors/${id}`, { method: "DELETE" }),

  bulkUpdateMonitors: (ids: string[], patch: Partial<Monitor>) =>
    request<{ updated: number }>("/api/monitors/bulk", {
      method: "POST",
      body: JSON.stringify({ ids, patch })
    }),

  bulkDeleteMonitors: (ids: string[]) =>
    request<{ deleted: number }>("/api/monitors/bulk/delete", {
      method: "POST",
      body: JSON.stringify({ ids })
    }),

  startMonitor: (id: string) =>
    request<{ ok: boolean }>(`/api/monitors/${id}/start`, { method: "POST" }),

  stopMonitor: (id: string) =>
    request<{ ok: boolean }>(`/api/monitors/${id}/stop`, { method: "POST" }),

  getMonitorHeartbeats: (id: string, range: "24h" | "7d" | "30d" = "24h") =>
    request<{ heartbeats: Heartbeat[] }>(`/api/monitors/${id}/heartbeats?range=${range}`),

  getMonitorUptime: (id: string) =>
    request<{ stats: MonitorStats }>(`/api/monitors/${id}/uptime`),

  getResourceNow: () =>
    request<{
      rssMb: number
      heapTotalMb: number
      heapUsedMb: number
      externalMb: number
      cpuUserMs: number
      cpuSystemMs: number
      diskUsedMb: number
      uptime: number
    }>("/api/resources/now"),

  getResourceHistory: (range: "15m" | "1h" | "6h" | "24h" = "1h") =>
    request<{ snapshots: ResourceSnapshot[] }>(`/api/resources/history?range=${range}`),
}

export interface ResourceSnapshot {
  id: string
  rssMb: number
  heapTotalMb: number
  heapUsedMb: number
  externalMb: number
  cpuPercent: number
  diskUsedMb: number
  recordedAt: string
}

export interface UserNotificationSettings {
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
    onLlmGarbageDetected: boolean
    onCrawlProgress: boolean
    onMonitorDown?: boolean
    onMonitorRecovery?: boolean
  }
}

export { ApiError }
