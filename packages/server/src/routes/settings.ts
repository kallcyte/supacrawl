import { writeFileSync } from "node:fs"
import type { Hono } from "hono"
import { z } from "zod"
import type { RouteDeps } from "./index.js"
import { requireAdmin, requireAuth } from "../auth-helpers.js"
import { writeConfigToFile } from "@supacrawl/core"

const configSchema = z.object({
  crawl: z.object({
    delayMs: z.number().int().nonnegative(),
    maxConcurrency: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
    userAgent: z.string().min(1),
    respectRobotsTxt: z.boolean(),
    maxUrls: z.number().int().positive(),
    retryOnTransientError: z.boolean(),
    maxRetries: z.number().int().nonnegative(),
    detectMojibake: z.boolean(),
    detectLlmGarbage: z.boolean(),
    maxBodyBytes: z.number().int().positive().default(5 * 1024 * 1024),
    maxGlobalConcurrency: z.number().int().positive().default(100)
  }),
  checks: z.object({
    ssl: z.object({ enabled: z.boolean(), warnDays: z.number().int().positive() }),
    contentDiff: z.boolean(),
    responseTime: z.object({ warnMs: z.number().int().positive() })
  }),
  notifications: z.any(),
  schedule: z.string().optional()
})

export function settingsRoutes(app: Hono, deps: RouteDeps): void {
  app.get("/api/settings", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const { sitemaps: _, ...rest } = deps.config
    return c.json(rest)
  })

  app.put("/api/settings", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const parsed = configSchema.parse(await c.req.json())
    deps.config.crawl = parsed.crawl
    deps.config.checks = parsed.checks
    deps.config.notifications = parsed.notifications
    deps.config.schedule = parsed.schedule
    deps.storage.setSetting("config", JSON.stringify(deps.config))
    writeConfigToFile(deps.configPath, deps.config)
    return c.json({ ok: true })
  })
}
