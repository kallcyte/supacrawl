import type { Hono } from "hono"
import { getDeps } from "./route-deps.js"

/**
 * Custom forgot-password / reset-password routes for Workers.
 * Uses Web Crypto (no node:crypto) and D1 (no better-sqlite3).
 */
export function authRoutes(app: Hono): void {
  app.post("/api/auth/custom-forgot-password", async (c) => {
    const deps = getDeps()
    const { email } = await c.req.json() as { email?: string }
    if (!email) return c.json({ error: "Email is required" }, 400)

    const user = await deps.db
      .prepare("SELECT id, email FROM user WHERE email = ?")
      .bind(email)
      .first<{ id: string; email: string }>()

    if (!user) {
      return c.json({ message: "If that email exists, a reset link has been sent" })
    }

    // Clean old tokens
    await deps.db.prepare("DELETE FROM password_reset_token WHERE user_id = ?").bind(user.id).run()

    // Generate token using Web Crypto
    const tokenBytes = new Uint8Array(32)
    crypto.getRandomValues(tokenBytes)
    const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, "0")).join("")

    // Hash token with SHA-256
    const tokenHashBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
    const tokenHash = Array.from(new Uint8Array(tokenHashBytes)).map(b => b.toString(16).padStart(2, "0")).join("")

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()

    await deps.db.prepare(
      "INSERT INTO password_reset_token (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), user.id, tokenHash, expiresAt, new Date().toISOString()).run()

    const url = new URL(c.req.url)
    const resetUrl = `${url.protocol}//${url.host}/reset-password?token=${token}`
    console.log(`[supacrawl] Password reset for ${user.email}: ${resetUrl}`)

    return c.json({ message: "If that email exists, a reset link has been sent" })
  })

  app.post("/api/auth/custom-reset-password", async (c) => {
    const deps = getDeps()
    const { token, newPassword } = await c.req.json() as { token?: string; newPassword?: string }
    if (!token || !newPassword) {
      return c.json({ error: "Token and new password are required" }, 400)
    }
    if (newPassword.length < 8) {
      return c.json({ error: "Password must be at least 8 characters" }, 400)
    }

    // Hash incoming token
    const tokenHashBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
    const tokenHash = Array.from(new Uint8Array(tokenHashBytes)).map(b => b.toString(16).padStart(2, "0")).join("")

    // Find valid token
    const row = await deps.db
      .prepare("SELECT * FROM password_reset_token WHERE token_hash = ? AND expires_at > ?")
      .bind(tokenHash, new Date().toISOString())
      .first<{ user_id: string }>()

    if (!row) {
      return c.json({ error: "Invalid or expired token" }, 400)
    }

    // Hash new password with PBKDF2 (Web Crypto scrypt alternative)
    const hashedPassword = await hashPasswordPBKDF2(newPassword)

    await deps.db.prepare("UPDATE account SET password = ? WHERE userId = ?").bind(hashedPassword, row.user_id).run()
    await deps.db.prepare("DELETE FROM password_reset_token WHERE user_id = ?").bind(row.user_id).run()

    return c.json({ message: "Password reset successfully" })
  })
}

/**
 * PBKDF2-based password hashing (replaces node:crypto scrypt for Workers).
 * Format: salt:hash similar to scrypt output.
 */
async function hashPasswordPBKDF2(password: string): Promise<string> {
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, "0")).join("")

  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]
  )
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial, 512
  )
  const hashHex = Array.from(new Uint8Array(derived)).map(b => b.toString(16).padStart(2, "0")).join("")

  return `${saltHex}:${hashHex}`
}