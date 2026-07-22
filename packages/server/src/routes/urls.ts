import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { RouteDeps } from "./index.js"
import { requireAuth } from "../auth-helpers.js"

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(2000).default(500),
  offset: z.coerce.number().int().nonnegative().default(0)
})

export async function urlsRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get("/api/urls", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const query = listQuerySchema.parse(req.query)
    const urls = deps.storage.listUrls(query.limit, query.offset)
    return { urls }
  })

  app.get("/api/urls/history", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const { url, limit } = z
      .object({ url: z.string().url(), limit: z.coerce.number().int().positive().max(500).default(100) })
      .parse(req.query)
    const history = deps.storage.getUrlHistory(url, limit)
    return { url, history }
  })
}
