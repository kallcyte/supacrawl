import type { Hono } from "hono"
import type { RouteDeps } from "./index.js"
import { z } from "zod"
import { SetupService } from "../setup.js"
import { requireAdmin } from "../auth-helpers.js"

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

export function setupRoutes(app: Hono, deps: RouteDeps): void {
  const setup = new SetupService(deps.dbPath, deps.auth, deps.storage)

  app.get("/api/setup/status", async (c) => {
    const hasUsers = await setup.hasUsers()
    const allowRegistration = setup.isRegistrationOpen()
    return c.json({ hasUsers, allowRegistration })
  })

  app.post("/api/setup/first-admin", async (c) => {
    try {
      const body = firstAdminSchema.parse(await c.req.json())
      const user = await setup.createFirstAdmin(body.email, body.password, body.name)
      return c.json({ user })
    } catch (err) {
      if (err instanceof z.ZodError) {
        return c.json({ error: "Validation failed", details: err.errors }, 400)
      }
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: msg }, 400)
    }
  })

  app.post("/api/setup/register", async (c) => {
    try {
      const body = registerSchema.parse(await c.req.json())
      const user = await setup.registerUser(body.email, body.password, body.name)
      return c.json({ user })
    } catch (err) {
      if (err instanceof z.ZodError) {
        return c.json({ error: "Validation failed", details: err.errors }, 400)
      }
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: msg }, 400)
    }
  })

  app.put("/api/setup/registration", async (c) => {
    try {
      const session = await requireAdmin(c, deps.auth)
      if (!session) return c.json({ error: "Forbidden" }, 403)
      const body = registrationToggleSchema.parse(await c.req.json())
      setup.setRegistrationOpen(body.allowRegistration)
      return c.json({ allowRegistration: body.allowRegistration })
    } catch (err) {
      if (err instanceof z.ZodError) {
        return c.json({ error: "Validation failed", details: err.errors }, 400)
      }
      throw err
    }
  })
}
