import type { FastifyInstance } from "fastify"
import type { RouteDeps } from "./index.js"
import { requireAuth } from "../auth-helpers.js"

export async function statsRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get("/api/stats/overview", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    return deps.storage.getOverviewStats()
  })

  app.get("/api/stats/timeline", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    return { timeline: deps.storage.getTimeline(30) }
  })

  app.get("/api/stats/duration-trend", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const trend = deps.storage.getCrawlDurationTrend(30)
    return { trend }
  })
}
