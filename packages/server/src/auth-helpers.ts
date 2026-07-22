import type { FastifyReply, FastifyRequest } from "fastify"
import type { Auth } from "./auth.js"

export interface AuthSession {
  user: {
    id: string
    email: string
    name: string
    role: "admin" | "user" | string
  }
  session: {
    id: string
    token: string
    expiresAt: Date
  }
}

export async function getSession(req: FastifyRequest, auth: Auth): Promise<AuthSession | null> {
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (v !== undefined) {
      if (Array.isArray(v)) headers.set(k, v.join(", "))
      else headers.set(k, String(v))
    }
  }
  const result = await auth.api.getSession({ headers })
  return result as unknown as AuthSession | null
}

export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
  auth: Auth
): Promise<AuthSession | null> {
  const session = await getSession(req, auth)
  if (!session) {
    reply.code(401).send({ error: "Unauthorized" })
    return null
  }
  return session
}

export async function requireAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
  auth: Auth
): Promise<AuthSession | null> {
  const session = await requireAuth(req, reply, auth)
  if (!session) return null
  if (session.user.role !== "admin") {
    reply.code(403).send({ error: "Forbidden" })
    return null
  }
  return session
}
