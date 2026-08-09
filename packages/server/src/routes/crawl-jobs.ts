import { randomUUID } from "node:crypto"
import type { Hono } from "hono"
import { z } from "zod"
import { CrawlJobSchema, CrawlJobExportSchema, discoverSitemapTree } from "@supacrawl/core"
import type { CrawlJob } from "@supacrawl/core"
import type { RouteDeps } from "./index.js"
import { requireAdmin, requireAuth } from "../auth-helpers.js"
import { nextRunAtMs } from "../job-scheduler.js"

const updateJobSchema = CrawlJobSchema.partial()

function withNextRunAt(job: CrawlJob): CrawlJob & { nextRunAt: string | null } {
  const next = nextRunAtMs(job)
  return { ...job, nextRunAt: next === null ? null : new Date(Math.max(next, Date.now())).toISOString() }
}

export function crawlJobsRoutes(app: Hono, deps: RouteDeps): void {
  app.get("/api/crawl-jobs", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const jobs = deps.storage.listCrawlJobs()
    const running = new Set<string>()
    for (const j of jobs) {
      if (deps.crawlManager.isJobRunning(j.id)) running.add(j.id)
    }
    return c.json({ jobs: jobs.map(withNextRunAt), running: [...running] })
  })

  app.get("/api/crawl-jobs/:id", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    const job = deps.storage.getCrawlJob(id)
    if (!job) return c.json({ error: "Crawl job not found" }, 404)
    return c.json(job)
  })

  app.post("/api/crawl-jobs", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const body = CrawlJobSchema.parse(await c.req.json())
    const now = new Date().toISOString()
    const { sitemapUrls: rawUrls, ...rest } = body
    const job: CrawlJob = {
      ...rest,
      sitemapUrls: rawUrls ?? null,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      lastRunStatus: null
    }
    deps.storage.createCrawlJob(job)
    return c.json(job)
  })

  app.put("/api/crawl-jobs/:id", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const id = c.req.param("id")
    const existing = deps.storage.getCrawlJob(id)
    if (!existing) return c.json({ error: "Crawl job not found" }, 404)
    const body = updateJobSchema.parse(await c.req.json())
    deps.storage.updateCrawlJob(id, { ...body, updatedAt: new Date().toISOString() })
    const updated = deps.storage.getCrawlJob(id)
    return c.json(updated)
  })

  app.delete("/api/crawl-jobs/:id", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const id = c.req.param("id")
    const existing = deps.storage.getCrawlJob(id)
    if (!existing) return c.json({ error: "Crawl job not found" }, 404)
    deps.storage.deleteCrawlJob(id)
    return c.json({ ok: true })
  })

  app.post("/api/crawl-jobs/:id/start", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const id = c.req.param("id")
    const job = deps.storage.getCrawlJob(id)
    if (!job) return c.json({ error: "Crawl job not found" }, 404)
    if (deps.crawlManager.isJobRunning(id)) {
      return c.json({ error: "A crawl is already running for this job" }, 409)
    }
    const crawlId = await deps.crawlManager.startCrawl({ job })
    return c.json({ crawlId, startedAt: new Date().toISOString() })
  })

  app.post("/api/crawl-jobs/:id/stop", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const id = c.req.param("id")
    const ok = await deps.crawlManager.cancelJobCrawl(id)
    if (!ok) return c.json({ error: "No active crawl for this job" }, 404)
    return c.json({ ok: true })
  })

  app.get("/api/crawl-jobs/export", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const jobs = deps.storage.exportCrawlJobs()
    return c.json({
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      jobs
    })
  })

  app.post("/api/crawl-jobs/import", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const body = CrawlJobExportSchema.parse(await c.req.json())
    const count = deps.storage.importCrawlJobs(body.jobs)
    return c.json({ imported: count })
  })

  app.post("/api/crawl-jobs/discover", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const { url } = z.object({ url: z.string().url() }).parse(await c.req.json())
    const tree = await discoverSitemapTree(url)
    return c.json(tree)
  })

  app.get("/api/crawl-jobs/:id/history", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    const crawls = deps.storage.getCrawlsForJob(id)
    return c.json({ crawls })
  })
}
