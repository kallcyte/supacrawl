import Database from "better-sqlite3"
import { betterAuth } from "better-auth"
import { admin } from "better-auth/plugins"

export interface AuthOptions {
  databasePath: string
  github?: { clientId: string; clientSecret: string }
  smtp?: { host: string; port: number; user: string; pass: string; from: string }
  secret?: string
  baseUrl?: string
}

export function createAuth(opts: AuthOptions): ReturnType<typeof betterAuth> {
  const sqliteDb = new Database(opts.databasePath)
  sqliteDb.pragma("journal_mode = WAL")
  return betterAuth({
    database: sqliteDb,
    secret: opts.secret ?? process.env.BETTER_AUTH_SECRET ?? "dev-secret-change-me",
    baseURL: opts.baseUrl ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      ...(opts.smtp
        ? {
            sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
              const nodemailer = await import("nodemailer")
              const transport = nodemailer.default.createTransport({
                host: opts.smtp!.host,
                port: opts.smtp!.port,
                auth: { user: opts.smtp!.user, pass: opts.smtp!.pass }
              })
              await transport.sendMail({
                from: opts.smtp!.from,
                to: user.email,
                subject: "Reset your supacrawl password",
                text: `Click to reset your password: ${url}`
              })
            }
          }
        : {})
    },
    socialProviders: opts.github
      ? {
          github: {
            clientId: opts.github.clientId,
            clientSecret: opts.github.clientSecret
          }
        }
      : undefined,
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
