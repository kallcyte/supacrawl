import Database from "better-sqlite3"
import { betterAuth } from "better-auth"
import { admin } from "better-auth/plugins"

export interface AuthOptions {
  databasePath: string
  github?: { clientId: string; clientSecret: string }
  smtp?: { host: string; port: number; user: string; pass: string; from: string }
  secret?: string
  baseUrl?: string
  trustedOrigins?: string[]
}

export function createAuth(opts: AuthOptions): ReturnType<typeof betterAuth> {
  const sqliteDb = new Database(opts.databasePath)
  sqliteDb.pragma("journal_mode = WAL")
  // Ensure better-auth tables exist (lazy migration may fail in concurrent setups)
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS user (
      id TEXT PRIMARY KEY, name TEXT, email TEXT, emailVerified INTEGER DEFAULT 0,
      image TEXT, createdAt TEXT, updatedAt TEXT, role TEXT DEFAULT 'user',
      banned INTEGER DEFAULT 0, banReason TEXT, banExpires TEXT
    );
    CREATE TABLE IF NOT EXISTS account (
      id TEXT PRIMARY KEY, accountId TEXT, providerId TEXT, userId TEXT NOT NULL,
      accessToken TEXT, refreshToken TEXT, idToken TEXT, accessTokenExpiresAt TEXT,
      refreshTokenExpiresAt TEXT, scope TEXT, password TEXT, createdAt TEXT, updatedAt TEXT,
      FOREIGN KEY (userId) REFERENCES user(id)
    );
    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY, expiresAt TEXT NOT NULL, token TEXT NOT NULL,
      createdAt TEXT, updatedAt TEXT, ipAddress TEXT, userAgent TEXT,
      userId TEXT NOT NULL, impersonatedBy TEXT,
      FOREIGN KEY (userId) REFERENCES user(id)
    );
    CREATE TABLE IF NOT EXISTS verification (
      id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL,
      expiresAt TEXT NOT NULL, createdAt TEXT, updatedAt TEXT
    );
  `)
  return betterAuth({
    database: sqliteDb,
    secret: opts.secret ?? process.env.BETTER_AUTH_SECRET ?? "dev-secret-change-me",
    baseURL: opts.baseUrl ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3456",
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
        if (opts.smtp) {
          const nodemailer = await import("nodemailer")
          const transport = nodemailer.default.createTransport({
            host: opts.smtp.host,
            port: opts.smtp.port,
            auth: { user: opts.smtp.user, pass: opts.smtp.pass }
          })
          await transport.sendMail({
            from: opts.smtp.from,
            to: user.email,
            subject: "Reset your supacrawl password",
            text: `Click to reset your password: ${url}`
          })
        } else {
          console.log(`[supacrawl] Password reset for ${user.email}: ${url}`)
        }
      }
    },
    socialProviders: opts.github
      ? {
          github: {
            clientId: opts.github.clientId,
            clientSecret: opts.github.clientSecret
          }
        }
      : undefined,
    trustedOrigins: opts.trustedOrigins,
    plugins: [admin()],
    user: {
      additionalFields: {}
    },
    advanced: {
      cookiePrefix: "supacrawl"
    }
  }) as unknown as ReturnType<typeof betterAuth>
}

export type Auth = ReturnType<typeof createAuth>
