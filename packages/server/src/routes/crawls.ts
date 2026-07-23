import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { RouteDeps } from "./index.js"
import { requireAuth } from "../auth-helpers.js"

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0)
})

export async function crawlsRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get("/api/crawls", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const query = listQuerySchema.parse(req.query)
    const crawls = deps.storage.listCrawls(query.limit, query.offset)
    return { crawls, total: deps.storage.listCrawls(10000).length }
  })

  app.get("/api/crawls/active", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const active = deps.crawlManager.listActive()
    const crawls = active.map((id) => deps.storage.getCrawl(id)).filter(Boolean)
    return { crawls }
  })

  app.get("/api/crawls/:id", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const { id } = req.params as { id: string }
    const crawl = deps.storage.getCrawl(id)
    if (!crawl) return reply.code(404).send({ error: "Not found" })
    return crawl
  })

  app.post("/api/crawls/start", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const id = await deps.crawlManager.startCrawl()
    return { crawlId: id, startedAt: new Date().toISOString() }
  })

  app.post("/api/crawls/:id/cancel", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const { id } = req.params as { id: string }
    const ok = await deps.crawlManager.cancelCrawl(id)
    if (!ok) return reply.code(404).send({ error: "Crawl not active" })
    return { ok: true }
  })

  app.delete("/api/crawls/:id", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const { id } = req.params as { id: string }
    const crawl = deps.storage.getCrawl(id)
    if (!crawl) return reply.code(404).send({ error: "Not found" })
    deps.storage.deleteCrawl(id)
    return { ok: true }
  })
}
