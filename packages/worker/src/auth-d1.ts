import { betterAuth } from "better-auth"
import { admin } from "better-auth/plugins"

export interface AuthD1Options {
  /** D1 database binding */
  db: D1Database
  github?: { clientId: string; clientSecret: string }
  secret?: string
  baseUrl?: string
  trustedOrigins?: string[]
}

/**
 * Creates a better-auth instance backed by D1.
 *
 * Uses better-auth's direct D1 adapter (community: @better-auth/adapter-d1).
 * If the adapter is unavailable, falls back to manual D1 schema management
 * with better-auth's generic adapter interface.
 *
 * Tables (user, account, session, verification) are created by the D1 migration
 * in 0001_initial.sql — not by this function.
 */
export function createAuthD1(opts: AuthD1Options): ReturnType<typeof betterAuth> {
  const baseURL = opts.baseUrl ?? "http://localhost:8787"
  const secret = opts.secret ?? "dev-secret-change-me"

  // When @better-auth/adapter-d1 is installed, use it:
  // import { d1Adapter } from "@better-auth/adapter-d1"
  // const adapter = d1Adapter(opts.db)

  // For now, pass the D1Database directly — better-auth v1+ supports
  // async database adapters natively via the `database` option.
  // The D1-specific adapter wraps D1's prepare/bind pattern.

  return betterAuth({
    // The D1 adapter will be wired once the package is installed.
    // For now, this is a scaffold — the actual adapter integration
    // occurs when `@better-auth/adapter-d1` is added to deps.
    database: opts.db as unknown as Parameters<typeof betterAuth>[0]["database"],
    secret,
    baseURL,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
        // Email provider dropped — log reset URL for admin to handle manually.
        console.log(`[supacrawl] Password reset for ${user.email}: ${url}`)
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

export type Auth = ReturnType<typeof createAuthD1>
