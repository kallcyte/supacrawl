export interface CrawlRecord {
  id: string
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

export interface SitemapTreeNode {
  url: string
  leafCount: number
  children: SitemapTreeNode[]
}

export interface StatusBucket {
  status: string
  count: number
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
  listResults: (id: string, opts?: { brokenOnly?: boolean; changedOnly?: boolean }) => {
    const q = new URLSearchParams()
    if (opts?.brokenOnly) q.set("brokenOnly", "true")
    if (opts?.changedOnly) q.set("changedOnly", "true")
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
  getNotifiers: () => request<{ enabled: string[]; config: unknown }>("/api/notifiers"),
  testNotifier: (name: string) =>
    request<{ ok: boolean; error?: string }>(`/api/notifiers/${name}/test`, { method: "POST" }),
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

  addSitemap: (url: string) =>
    request<{ sitemaps: { url: string; enabled: boolean }[] }>("/api/settings/sitemaps", {
      method: "POST",
      body: JSON.stringify({ url })
    }),

  removeSitemap: (url: string) =>
    request<{ sitemaps: { url: string; enabled: boolean }[] }>("/api/settings/sitemaps", {
      method: "DELETE",
      body: JSON.stringify({ url })
    }),

  toggleSitemap: (url: string) =>
    request<{ sitemaps: { url: string; enabled: boolean }[] }>(
      `/api/settings/sitemaps/${encodeURIComponent(url)}/toggle`,
      { method: "PATCH" }
    ),

  discoverSitemapTree: (url: string) =>
    request<{ url: string; leafCount: number; children: SitemapTreeNode[] }>(
      "/api/settings/sitemaps/discover",
      { method: "POST", body: JSON.stringify({ url }) }
    )
}

export { ApiError }
