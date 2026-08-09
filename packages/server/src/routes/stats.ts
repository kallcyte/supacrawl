import type { Hono } from "hono"
import type { RouteDeps } from "./index.js"
import { requireAuth } from "../auth-helpers.js"

export function statsRoutes(app: Hono, deps: RouteDeps): void {
  app.get("/api/stats/overview", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    return c.json(deps.storage.getOverviewStats())
  })

  app.get("/api/stats/timeline", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    return c.json({ timeline: deps.storage.getTimeline(30) })
  })

  app.get("/api/stats/duration-trend", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const trend = deps.storage.getCrawlDurationTrend(30)
    return c.json({ trend })
  })
}
