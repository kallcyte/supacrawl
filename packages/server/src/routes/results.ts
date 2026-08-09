import type { Hono } from "hono"
import { z } from "zod"
import type { RouteDeps } from "./index.js"
import { requireAuth } from "../auth-helpers.js"

const listQuerySchema = z.object({
  brokenOnly: z.coerce.boolean().optional(),
  changedOnly: z.coerce.boolean().optional(),
  mojibakeOnly: z.coerce.boolean().optional(),
  llmGarbageOnly: z.coerce.boolean().optional()
})

export function resultsRoutes(app: Hono, deps: RouteDeps): void {
  app.get("/api/crawls/:id/results", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    const query = listQuerySchema.parse(c.req.query())
    const results = deps.storage.listResults(id, query)
    return c.json({ crawlId: id, results })
  })

  app.get("/api/crawls/:id/results/:uid", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const uid = c.req.param("uid")
    const result = deps.storage.getResult(uid)
    if (!result) return c.json({ error: "Not found" }, 404)
    return c.json(result)
  })

  app.get("/api/crawls/:id/status-distribution", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    return c.json(deps.storage.getStatusDistribution(id))
  })
}
