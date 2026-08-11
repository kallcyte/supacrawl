import type { Hono } from "hono"
import { z } from "zod"
import { requireAdmin, requireAuth } from "./auth-helpers.js"
import { getDeps } from "./route-deps.js"

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0)
})

export function crawlsRoutes(app: Hono): void {
  app.get("/api/crawls", async (c) => {
    const deps = getDeps()
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const query = listQuerySchema.parse(c.req.query())
    const crawls = await deps.storage.listCrawls(query.limit, query.offset)
    const allCrawls = await deps.storage.listCrawls(10000, 0)
    return c.json({ crawls, total: allCrawls.length })
  })

  app.get("/api/crawls/active", async (c) => {
    const deps = getDeps()
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    return c.json({ crawls: [] })
  })

  app.get("/api/crawls/:id", async (c) => {
    const deps = getDeps()
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    const crawl = await deps.storage.getCrawl(id)
    if (!crawl) return c.json({ error: "Not found" }, 404)
    return c.json(crawl)
  })

  app.post("/api/crawls/start", async (c) => {
    const deps = getDeps()
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)

    const crawlId = crypto.randomUUID()
    await deps.crawlQueue.send({
      type: "crawl:start",
      crawlId,
      sitemaps: deps.config.sitemaps.filter((s: { enabled?: boolean }) => s.enabled !== false).map((s: { url: string }) => s.url),
      startedAt: new Date().toISOString()
    })

    return c.json({ crawlId, startedAt: new Date().toISOString() })
  })

  app.post("/api/crawls/:id/cancel", async (c) => {
    const deps = getDeps()
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    // Queues don't support cross-request abort; mark the crawl as cancelled in DB
    const id = c.req.param("id")
    const crawl = await deps.storage.getCrawl(id)
    if (!crawl) return c.json({ error: "Crawl not found" }, 404)
    if (crawl.status !== "running" && crawl.status !== "pending") {
      return c.json({ error: "Crawl is not active" }, 409)
    }
    await deps.storage.updateCrawl(id, { status: "failed", finishedAt: new Date().toISOString(), errorMessage: "Cancelled by user" })
    return c.json({ ok: true })
  })

  app.get("/api/crawls/:id/summary", async (c) => {
    const deps = getDeps()
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    const summary = await deps.storage.getCrawlSummary(id)
    if (!summary) return c.json({ error: "Not found" }, 404)
    const crawl = await deps.storage.getCrawl(id)
    if (crawl?.jobId) {
      const job = await deps.storage.getCrawlJob(crawl.jobId)
      if (job) summary.jobName = job.name
    }
    return c.json(summary)
  })

  app.delete("/api/crawls/:id", async (c) => {
    const deps = getDeps()
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    const crawl = await deps.storage.getCrawl(id)
    if (!crawl) return c.json({ error: "Not found" }, 404)
    await deps.storage.deleteCrawl(id)
    return c.json({ ok: true })
  })
}