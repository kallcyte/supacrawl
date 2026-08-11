import type { Hono } from "hono"
import { z } from "zod"
import { requireAdmin } from "./auth-helpers.js"
import { getDeps } from "./route-deps.js"

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
  role: string
  createdAt: string
  updatedAt: string
}

export function usersRoutes(app: Hono): void {
  app.get("/api/admin/users", async (c) => {
    const deps = getDeps()
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    try {
      const { results } = await deps.db
        .prepare("SELECT id, name, email, role, createdAt, updatedAt FROM user ORDER BY createdAt DESC")
        .all<DbUser>()
      return c.json({ users: results ?? [], total: (results ?? []).length })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500)
    }
  })

  app.post("/api/admin/users", async (c) => {
    const deps = getDeps()
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
    const deps = getDeps()
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
    const deps = getDeps()
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