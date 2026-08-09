import type { Hono } from "hono"
import { z } from "zod"
import type { RouteDeps } from "./index.js"
import { requireAuth } from "../auth-helpers.js"

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(2000).default(500),
  offset: z.coerce.number().int().nonnegative().default(0)
})

export function urlsRoutes(app: Hono, deps: RouteDeps): void {
  app.get("/api/urls", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const query = listQuerySchema.parse(c.req.query())
    const urls = deps.storage.listUrls(query.limit, query.offset)
    return c.json({ urls })
  })

  app.get("/api/urls/history", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const { url, limit } = z
      .object({ url: z.string().url(), limit: z.coerce.number().int().positive().max(500).default(100) })
      .parse(c.req.query())
    const history = deps.storage.getUrlHistory(url, limit)
    return c.json({ url, history })
  })
}
