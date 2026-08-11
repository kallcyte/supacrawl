import type { Hono } from "hono"
import { requireAuth } from "./auth-helpers.js"
import { getDeps } from "./route-deps.js"

export function statsRoutes(app: Hono): void {
  app.get("/api/stats/overview", async (c) => {
    const deps = getDeps()
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    return c.json(await deps.storage.getOverviewStats())
  })

  app.get("/api/stats/timeline", async (c) => {
    const deps = getDeps()
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    return c.json({ timeline: await deps.storage.getTimeline(30) })
  })

  app.get("/api/stats/duration-trend", async (c) => {
    const deps = getDeps()
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const trend = await deps.storage.getCrawlDurationTrend(30)
    return c.json({ trend })
  })
}