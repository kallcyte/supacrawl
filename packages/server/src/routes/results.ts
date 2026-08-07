import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { RouteDeps } from "./index.js"
import { requireAuth } from "../auth-helpers.js"

const listQuerySchema = z.object({
  brokenOnly: z.coerce.boolean().optional(),
  changedOnly: z.coerce.boolean().optional(),
  mojibakeOnly: z.coerce.boolean().optional(),
  llmGarbageOnly: z.coerce.boolean().optional()
})

export async function resultsRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get("/api/crawls/:id/results", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const { id } = req.params as { id: string }
    const query = listQuerySchema.parse(req.query)
    const results = deps.storage.listResults(id, query)
    return { crawlId: id, results }
  })

  app.get("/api/crawls/:id/results/:uid", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const { uid } = req.params as { id: string; uid: string }
    const result = deps.storage.getResult(uid)
    if (!result) return reply.code(404).send({ error: "Not found" })
    return result
  })

  app.get("/api/crawls/:id/status-distribution", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const { id } = req.params as { id: string }
    return deps.storage.getStatusDistribution(id)
  })
}
