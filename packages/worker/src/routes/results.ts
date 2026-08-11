import type { Hono } from "hono"
import { z } from "zod"
import { requireAuth } from "./auth-helpers.js"
import { getDeps } from "./route-deps.js"

const listQuerySchema = z.object({
  brokenOnly: z.coerce.boolean().optional(),
  changedOnly: z.coerce.boolean().optional(),
  mojibakeOnly: z.coerce.boolean().optional(),
  llmGarbageOnly: z.coerce.boolean().optional()
})

export function resultsRoutes(app: Hono): void {
  app.get("/api/crawls/:id/results", async (c) => {
    const deps = getDeps()
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    const query = listQuerySchema.parse(c.req.query())
    const results = await deps.storage.listResults(id, query)
    return c.json({ crawlId: id, results })
  })

  app.get("/api/crawls/:id/results/:uid", async (c) => {
    const deps = getDeps()
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const uid = c.req.param("uid")
    const result = await deps.storage.getResult(uid)
    if (!result) return c.json({ error: "Not found" }, 404)
    return c.json(result)
  })

  app.get("/api/crawls/:id/status-distribution", async (c) => {
    const deps = getDeps()
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    const dist = await deps.storage.getStatusDistribution(id)
    return c.json(dist)
  })
}