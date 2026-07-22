import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { RouteDeps } from "./index.js"
import { SetupService } from "../setup.js"

const firstAdminSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional()
})

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional()
})

const registrationToggleSchema = z.object({
  allowRegistration: z.boolean()
})

export async function setupRoutes(app: FastifyInstance, deps: RouteDeps & { setup: SetupService }): Promise<void> {
  app.get("/api/setup/status", async () => {
    const hasUsers = await deps.setup.hasUsers()
    const allowRegistration = deps.setup.isRegistrationOpen()
    return { hasUsers, allowRegistration }
  })

  app.post("/api/setup/first-admin", async (req, reply) => {
    try {
      const body = firstAdminSchema.parse(req.body)
      const user = await deps.setup.createFirstAdmin(body.email, body.password, body.name)
      return { user }
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: "Validation failed", details: err.errors })
      }
      const msg = err instanceof Error ? err.message : String(err)
      return reply.code(400).send({ error: msg })
    }
  })

  app.post("/api/setup/register", async (req, reply) => {
    try {
      const body = registerSchema.parse(req.body)
      const user = await deps.setup.registerUser(body.email, body.password, body.name)
      return { user }
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: "Validation failed", details: err.errors })
      }
      const msg = err instanceof Error ? err.message : String(err)
      return reply.code(400).send({ error: msg })
    }
  })

  app.put("/api/setup/registration", async (req, reply) => {
    try {
      const session = await requireAdmin(req, reply, deps.auth)
      if (!session) return
      const body = registrationToggleSchema.parse(req.body)
      deps.setup.setRegistrationOpen(body.allowRegistration)
      return { allowRegistration: body.allowRegistration }
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: "Validation failed", details: err.errors })
      }
      throw err
    }
  })
}

async function requireAdmin(req: any, reply: any, auth: any) {
  const { requireAdmin: ra } = await import("../auth-helpers.js")
  return ra(req, reply, auth)
}
