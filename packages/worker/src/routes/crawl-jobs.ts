import type { Hono } from "hono"
import { z } from "zod"
import { CrawlJobSchema, CrawlJobExportSchema, discoverSitemapTree } from "@supacrawl/core"
import type { CrawlJob } from "@supacrawl/core"
import { requireAdmin, requireAuth } from "./auth-helpers.js"
import { nextRunAtMs } from "./scheduler-utils.js"
import { getDeps } from "./route-deps.js"

const updateJobSchema = CrawlJobSchema.partial()

function withNextRunAt(job: CrawlJob): CrawlJob & { nextRunAt: string | null } {
  const next = nextRunAtMs(job)
  return { ...job, nextRunAt: next === null ? null : new Date(Math.max(next, Date.now())).toISOString() }
}

export function crawlJobsRoutes(app: Hono): void {
  app.get("/api/crawl-jobs", async (c) => {
    const deps = getDeps()
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const jobs = await deps.storage.listCrawlJobs()
    const running = new Set<string>()
    return c.json({ jobs: jobs.map(withNextRunAt), running: [...running] })
  })

  // Static-path routes (export, import, discover) must be registered
  // BEFORE the :id param routes, otherwise Hono's first-match-wins
  // routing matches /api/crawl-jobs/export as id="export".
  app.get("/api/crawl-jobs/export", async (c) => {
    const deps = getDeps()
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const jobs = await deps.storage.exportCrawlJobs()
    return c.json({
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      jobs
    })
  })

  app.post("/api/crawl-jobs/import", async (c) => {
    const deps = getDeps()
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const body = CrawlJobExportSchema.parse(await c.req.json())
    const count = await deps.storage.importCrawlJobs(body.jobs)
    return c.json({ imported: count })
  })

  app.post("/api/crawl-jobs/discover", async (c) => {
    const deps = getDeps()
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const { url } = z.object({ url: z.string().url() }).parse(await c.req.json())
    const tree = await discoverSitemapTree(url)
    return c.json(tree)
  })

  app.get("/api/crawl-jobs/:id", async (c) => {
    const deps = getDeps()
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    const job = await deps.storage.getCrawlJob(id)
    if (!job) return c.json({ error: "Crawl job not found" }, 404)
    return c.json(job)
  })

  app.post("/api/crawl-jobs", async (c) => {
    const deps = getDeps()
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const body = CrawlJobSchema.parse(await c.req.json())
    const now = new Date().toISOString()
    const { sitemapUrls: rawUrls, ...rest } = body
    const job: CrawlJob = {
      ...rest,
      sitemapUrls: rawUrls ?? null,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      lastRunStatus: null
    }
    await deps.storage.createCrawlJob(job)
    return c.json(job)
  })

  app.put("/api/crawl-jobs/:id", async (c) => {
    const deps = getDeps()
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const id = c.req.param("id")
    const existing = await deps.storage.getCrawlJob(id)
    if (!existing) return c.json({ error: "Crawl job not found" }, 404)
    const body = updateJobSchema.parse(await c.req.json())
    await deps.storage.updateCrawlJob(id, { ...body, updatedAt: new Date().toISOString() })
    const updated = await deps.storage.getCrawlJob(id)
    return c.json(updated)
  })

  app.delete("/api/crawl-jobs/:id", async (c) => {
    const deps = getDeps()
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const id = c.req.param("id")
    const existing = await deps.storage.getCrawlJob(id)
    if (!existing) return c.json({ error: "Crawl job not found" }, 404)
    await deps.storage.deleteCrawlJob(id)
    return c.json({ ok: true })
  })

  app.post("/api/crawl-jobs/:id/start", async (c) => {
    const deps = getDeps()
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const id = c.req.param("id")
    const job = await deps.storage.getCrawlJob(id)
    if (!job) return c.json({ error: "Crawl job not found" }, 404)

    const crawlId = crypto.randomUUID()
    await deps.crawlQueue.send({
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

    return c.json({ crawlId, startedAt: new Date().toISOString() })
  })

  app.post("/api/crawl-jobs/:id/stop", async (c) => {
    const deps = getDeps()
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    // Queues don't support cross-request cancel; mark as cancelled in DB
    const id = c.req.param("id")
    const crawls = await deps.storage.getCrawlsForJob(id, 1)
    const running = crawls.find(c => c.status === "running" || c.status === "pending")
    if (running) {
      await deps.storage.updateCrawl(running.id, { status: "failed", finishedAt: new Date().toISOString(), errorMessage: "Cancelled by user" })
    }
    return c.json({ ok: true })
  })

  app.get("/api/crawl-jobs/:id/history", async (c) => {
    const deps = getDeps()
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    const crawls = await deps.storage.getCrawlsForJob(id)
    return c.json({ crawls })
  })
}