import type { Context } from "hono"
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

export async function getSession(c: Context, auth: Auth): Promise<AuthSession | null> {
  try {
    const result = await auth.api.getSession({ headers: c.req.raw.headers })
    return result as unknown as AuthSession | null
  } catch {
    return null
  }
}

export async function requireAuth(c: Context, auth: Auth): Promise<AuthSession | null> {
  const session = await getSession(c, auth)
  if (!session) {
    c.status(401)
    return null
  }
  return session
}

export async function requireAdmin(c: Context, auth: Auth): Promise<AuthSession | null> {
  const session = await requireAuth(c, auth)
  if (!session) return null
  if (session.user.role !== "admin") {
    c.status(403)
    return null
  }
  return session
}
