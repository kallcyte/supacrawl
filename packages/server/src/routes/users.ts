import Database from "better-sqlite3"
import type { Hono } from "hono"
import { z } from "zod"
import type { RouteDeps } from "./index.js"
import { requireAdmin } from "../auth-helpers.js"

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).optional(),
  role: z.enum(["admin", "user"]).default("user")
})

const updateRoleSchema = z.object({
  role: z.enum(["admin", "user"])
})

interface DbUser {
  id: string
  name: string
  email: string
  emailVerified: number
  image: string | null
  createdAt: string
  updatedAt: string
  role: string
  banned: number
  banReason: string | null
  banExpires: string | null
}

export function usersRoutes(app: Hono, deps: RouteDeps): void {
  app.get("/api/admin/users", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    try {
      const db = new Database(deps.dbPath)
      const users = db.prepare("SELECT id, name, email, role, createdAt, updatedAt FROM user ORDER BY createdAt DESC").all() as Pick<DbUser, "id" | "name" | "email" | "role" | "createdAt" | "updatedAt">[]
      db.close()
      return c.json({ users, total: users.length })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500)
    }
  })

  app.post("/api/admin/users", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const body = createUserSchema.parse(await c.req.json())
    try {
      const authApi = deps.auth.api as unknown as {
        createUser: (args: { body: Record<string, unknown>; headers: Headers }) => Promise<unknown>
      }
      const result = await authApi.createUser({
        body: {
          email: body.email,
          password: body.password,
          name: body.name ?? body.email.split("@")[0],
          role: body.role
        },
        headers: c.req.raw.headers
      })
      return c.json(result as Record<string, unknown>)
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
    }
  })

  app.patch("/api/admin/users/:id/role", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const id = c.req.param("id")
    const { role } = updateRoleSchema.parse(await c.req.json())
    try {
      const authApi = deps.auth.api as unknown as {
        setRole: (args: { body: Record<string, unknown>; headers: Headers }) => Promise<unknown>
      }
      const result = await authApi.setRole({
        body: { userId: id, role },
        headers: c.req.raw.headers
      })
      return c.json(result as Record<string, unknown>)
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
    }
  })

  app.delete("/api/admin/users/:id", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const id = c.req.param("id")
    try {
      const authApi = deps.auth.api as unknown as {
        removeUser: (args: { body: Record<string, unknown>; headers: Headers }) => Promise<unknown>
      }
      const result = await authApi.removeUser({
        body: { userId: id },
        headers: c.req.raw.headers
      })
      return c.json(result as Record<string, unknown>)
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
    }
  })
}
