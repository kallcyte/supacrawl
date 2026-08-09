import type { Hono } from "hono"
import { z } from "zod"
import type { RouteDeps } from "./index.js"
import { requireAdmin, requireAuth } from "../auth-helpers.js"

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0)
})

export function crawlsRoutes(app: Hono, deps: RouteDeps): void {
  app.get("/api/crawls", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const query = listQuerySchema.parse(c.req.query())
    const crawls = deps.storage.listCrawls(query.limit, query.offset)
    return c.json({ crawls, total: deps.storage.listCrawls(10000).length })
  })

  app.get("/api/crawls/active", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const active = deps.crawlManager.listActive()
    const crawls = active.map((id) => deps.storage.getCrawl(id)).filter(Boolean)
    return c.json({ crawls })
  })

  app.get("/api/crawls/:id", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    const crawl = deps.storage.getCrawl(id)
    if (!crawl) return c.json({ error: "Not found" }, 404)
    return c.json(crawl)
  })

  app.post("/api/crawls/start", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const id = await deps.crawlManager.startCrawl()
    return c.json({ crawlId: id, startedAt: new Date().toISOString() })
  })

  app.post("/api/crawls/:id/cancel", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const id = c.req.param("id")
    const ok = await deps.crawlManager.cancelCrawl(id)
    if (!ok) return c.json({ error: "Crawl not active" }, 404)
    return c.json({ ok: true })
  })

  app.get("/api/crawls/:id/summary", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    const summary = deps.storage.getCrawlSummary(id)
    if (!summary) return c.json({ error: "Not found" }, 404)
    const crawl = deps.storage.getCrawl(id)
    if (crawl?.jobId) {
      const job = deps.storage.getCrawlJob(crawl.jobId)
      if (job) summary.jobName = job.name
    }
    return c.json(summary)
  })

  app.delete("/api/crawls/:id", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    const crawl = deps.storage.getCrawl(id)
    if (!crawl) return c.json({ error: "Not found" }, 404)
    deps.storage.deleteCrawl(id)
    return c.json({ ok: true })
  })
}
