import type { Hono } from "hono"
import { z } from "zod"
import type { Auth } from "../auth-d1.js"
import { requireAdmin } from "./auth-helpers.js"
import { getDeps, type RouteDeps } from "./route-deps.js"

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

class SetupService {
  constructor(
    private db: D1Database,
    private auth: Auth,
    private storage: RouteDeps["storage"]
  ) {}

  async hasUsers(): Promise<boolean> {
    try {
      const row = await this.db
        .prepare("SELECT COUNT(*) AS cnt FROM user")
        .first<{ cnt: number }>()
      return (row?.cnt ?? 0) > 0
    } catch {
      return false
    }
  }

  async isRegistrationOpen(): Promise<boolean> {
    const val = await this.storage.getSetting("allowRegistration")
    return val === "true"
  }

  async setRegistrationOpen(open: boolean): Promise<void> {
    await this.storage.setSetting("allowRegistration", open ? "true" : "false")
  }

  async createFirstAdmin(email: string, password: string, name?: string): Promise<{ id: string; email: string }> {
    const has = await this.hasUsers()
    if (has) {
      throw new Error("Admin user already exists")
    }

    const result = await this.auth.api.signUpEmail({
      body: { email, password, name: name ?? email.split("@")[0] },
      headers: new Headers()
    })

    await this.db
      .prepare("UPDATE user SET role = ? WHERE email = ?")
      .bind("admin", email)
      .run()

    return { id: (result.user as { id: string }).id, email }
  }

  async registerUser(email: string, password: string, name?: string): Promise<{ id: string; email: string }> {
    if (!(await this.isRegistrationOpen())) {
      throw new Error("Registration is closed")
    }

    const result = await this.auth.api.signUpEmail({
      body: { email, password, name: name ?? email.split("@")[0] },
      headers: new Headers()
    })

    return { id: (result.user as { id: string }).id, email }
  }
}

export function setupRoutes(app: Hono): void {
  app.get("/api/setup/status", async (c) => {
    const deps = getDeps()
    const setup = new SetupService(deps.db, deps.auth, deps.storage)
    const hasUsers = await setup.hasUsers()
    const allowRegistration = await setup.isRegistrationOpen()
    return c.json({ hasUsers, allowRegistration })
  })

  app.post("/api/setup/first-admin", async (c) => {
    const deps = getDeps()
    const setup = new SetupService(deps.db, deps.auth, deps.storage)
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
    const deps = getDeps()
    const setup = new SetupService(deps.db, deps.auth, deps.storage)
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
    const deps = getDeps()
    const setup = new SetupService(deps.db, deps.auth, deps.storage)
    try {
      const session = await requireAdmin(c, deps.auth)
      if (!session) return c.json({ error: "Forbidden" }, 403)
      const body = registrationToggleSchema.parse(await c.req.json())
      await setup.setRegistrationOpen(body.allowRegistration)
      return c.json({ allowRegistration: body.allowRegistration })
    } catch (err) {
      if (err instanceof z.ZodError) {
        return c.json({ error: "Validation failed", details: err.errors }, 400)
      }
      throw err
    }
  })
}