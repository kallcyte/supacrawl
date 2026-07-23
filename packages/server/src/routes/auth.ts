import type { FastifyInstance } from "fastify"
import type { RouteDeps } from "./index.js"
import crypto from "node:crypto"
import { promisify } from "node:util"
import Database from "better-sqlite3"

const scryptAsync = promisify(crypto.scrypt)

function getDb(dbPath: string) {
  const db = new Database(dbPath)
  db.pragma("journal_mode = WAL")
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_token (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `)
  return db
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex")
  const key = (await scryptAsync(password.normalize("NFKC"), salt, 64, { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 })) as Buffer
  return `${salt}:${key.toString("hex")}`
}

export async function authRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.post("/api/auth/custom-forgot-password", async (req, reply) => {
    const { email } = req.body as { email?: string }
    if (!email) return reply.code(400).send({ error: "Email is required" })

    const db = getDb(deps.dbPath)
    const user = db.prepare("SELECT id, email FROM user WHERE email = ?").get(email) as { id: string; email: string } | undefined

    if (!user) {
      db.close()
      return { message: "If that email exists, a reset link has been sent" }
    }

    db.prepare("DELETE FROM password_reset_token WHERE user_id = ?").run(user.id)

    const token = crypto.randomBytes(32).toString("hex")
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex")
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()

    db.prepare("INSERT INTO password_reset_token (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").run(
      crypto.randomUUID(), user.id, tokenHash, expiresAt, new Date().toISOString()
    )
    db.close()

    const port = req.port ? `:${req.port}` : ""
    const resetUrl = `${req.protocol}://${req.hostname}${port}/reset-password?token=${token}`
    deps.app.log.info(`[supacrawl] Password reset for ${user.email}: ${resetUrl}`)
    console.log(`[supacrawl] Password reset for ${user.email}: ${resetUrl}`)

    return { message: "If that email exists, a reset link has been sent" }
  })

  app.post("/api/auth/custom-reset-password", async (req, reply) => {
    const { token, newPassword } = req.body as { token?: string; newPassword?: string }
    if (!token || !newPassword) {
      return reply.code(400).send({ error: "Token and new password are required" })
    }
    if (newPassword.length < 8) {
      return reply.code(400).send({ error: "Password must be at least 8 characters" })
    }

    const db = getDb(deps.dbPath)
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex")
    const row = db.prepare("SELECT * FROM password_reset_token WHERE token_hash = ? AND expires_at > ?").get(
      tokenHash, new Date().toISOString()
    ) as { user_id: string } | undefined

    if (!row) {
      db.close()
      return reply.code(400).send({ error: "Invalid or expired token" })
    }

    const hashedPassword = await hashPassword(newPassword)
    db.prepare("UPDATE account SET password = ? WHERE userId = ?").run(hashedPassword, row.user_id)
    db.prepare("DELETE FROM password_reset_token WHERE user_id = ?").run(row.user_id)
    db.close()

    return { message: "Password reset successfully" }
  })
}
