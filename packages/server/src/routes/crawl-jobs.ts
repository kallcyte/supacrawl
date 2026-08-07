import { randomUUID } from "node:crypto"
import type { FastifyInstance } from "fastify"
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

export async function crawlJobsRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get("/api/crawl-jobs", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const jobs = deps.storage.listCrawlJobs()
    const running = new Set<string>()
    for (const j of jobs) {
      if (deps.crawlManager.isJobRunning(j.id)) running.add(j.id)
    }
    return { jobs: jobs.map(withNextRunAt), running: [...running] }
  })

  app.get("/api/crawl-jobs/:id", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const { id } = req.params as { id: string }
    const job = deps.storage.getCrawlJob(id)
    if (!job) return reply.code(404).send({ error: "Crawl job not found" })
    return job
  })

  app.post("/api/crawl-jobs", async (req, reply) => {
    const session = await requireAdmin(req, reply, deps.auth)
    if (!session) return
    const body = CrawlJobSchema.parse(req.body)
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
    return job
  })

  app.put("/api/crawl-jobs/:id", async (req, reply) => {
    const session = await requireAdmin(req, reply, deps.auth)
    if (!session) return
    const { id } = req.params as { id: string }
    const existing = deps.storage.getCrawlJob(id)
    if (!existing) return reply.code(404).send({ error: "Crawl job not found" })
    const body = updateJobSchema.parse(req.body)
    deps.storage.updateCrawlJob(id, { ...body, updatedAt: new Date().toISOString() })
    const updated = deps.storage.getCrawlJob(id)
    return updated
  })

  app.delete("/api/crawl-jobs/:id", async (req, reply) => {
    const session = await requireAdmin(req, reply, deps.auth)
    if (!session) return
    const { id } = req.params as { id: string }
    const existing = deps.storage.getCrawlJob(id)
    if (!existing) return reply.code(404).send({ error: "Crawl job not found" })
    deps.storage.deleteCrawlJob(id)
    return { ok: true }
  })

  app.post("/api/crawl-jobs/:id/start", async (req, reply) => {
    const session = await requireAdmin(req, reply, deps.auth)
    if (!session) return
    const { id } = req.params as { id: string }
    const job = deps.storage.getCrawlJob(id)
    if (!job) return reply.code(404).send({ error: "Crawl job not found" })
    if (deps.crawlManager.isJobRunning(id)) {
      return reply.code(409).send({ error: "A crawl is already running for this job" })
    }
    const crawlId = await deps.crawlManager.startCrawl({ job })
    return { crawlId, startedAt: new Date().toISOString() }
  })

  app.post("/api/crawl-jobs/:id/stop", async (req, reply) => {
    const session = await requireAdmin(req, reply, deps.auth)
    if (!session) return
    const { id } = req.params as { id: string }
    const ok = await deps.crawlManager.cancelJobCrawl(id)
    if (!ok) return reply.code(404).send({ error: "No active crawl for this job" })
    return { ok: true }
  })

  app.get("/api/crawl-jobs/export", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const jobs = deps.storage.exportCrawlJobs()
    return {
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      jobs
    }
  })

  app.post("/api/crawl-jobs/import", async (req, reply) => {
    const session = await requireAdmin(req, reply, deps.auth)
    if (!session) return
    const body = CrawlJobExportSchema.parse(req.body)
    const count = deps.storage.importCrawlJobs(body.jobs)
    return { imported: count }
  })

  app.post("/api/crawl-jobs/discover", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const { url } = z.object({ url: z.string().url() }).parse(req.body)
    const tree = await discoverSitemapTree(url)
    return tree
  })

  app.get("/api/crawl-jobs/:id/history", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const { id } = req.params as { id: string }
    const crawls = deps.storage.getCrawlsForJob(id)
    return { crawls }
  })
}
