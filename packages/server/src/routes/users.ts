import Database from "better-sqlite3"
import type { FastifyInstance } from "fastify"
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

export async function usersRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get("/api/admin/users", async (req, reply) => {
    const session = await requireAdmin(req, reply, deps.auth)
    if (!session) return
    try {
      const db = new Database(deps.dbPath)
      const users = db.prepare("SELECT id, name, email, role, createdAt, updatedAt FROM user ORDER BY createdAt DESC").all() as Pick<DbUser, "id" | "name" | "email" | "role" | "createdAt" | "updatedAt">[]
      db.close()
      return { users, total: users.length }
    } catch (err) {
      req.log.error(err)
      reply.code(500).send({ error: (err as Error).message })
    }
  })

  app.post("/api/admin/users", async (req, reply) => {
    const session = await requireAdmin(req, reply, deps.auth)
    if (!session) return
    const body = createUserSchema.parse(req.body)
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
        headers: new Headers({ cookie: req.headers.cookie ?? "" })
      })
      return result
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message })
    }
  })

  app.patch("/api/admin/users/:id/role", async (req, reply) => {
    const session = await requireAdmin(req, reply, deps.auth)
    if (!session) return
    const { id } = req.params as { id: string }
    const { role } = updateRoleSchema.parse(req.body)
    try {
      const authApi = deps.auth.api as unknown as {
        setRole: (args: { body: Record<string, unknown>; headers: Headers }) => Promise<unknown>
      }
      const result = await authApi.setRole({
        body: { userId: id, role },
        headers: new Headers({ cookie: req.headers.cookie ?? "" })
      })
      return result
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message })
    }
  })

  app.delete("/api/admin/users/:id", async (req, reply) => {
    const session = await requireAdmin(req, reply, deps.auth)
    if (!session) return
    const { id } = req.params as { id: string }
    try {
      const authApi = deps.auth.api as unknown as {
        removeUser: (args: { body: Record<string, unknown>; headers: Headers }) => Promise<unknown>
      }
      const result = await authApi.removeUser({
        body: { userId: id },
        headers: new Headers({ cookie: req.headers.cookie ?? "" })
      })
      return result
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message })
    }
  })
}
