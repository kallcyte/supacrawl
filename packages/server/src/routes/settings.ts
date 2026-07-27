import { writeFileSync } from "node:fs"
import type { FastifyInstance } from "fastify"
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
    detectMojibake: z.boolean()
  }),
  checks: z.object({
    ssl: z.object({ enabled: z.boolean(), warnDays: z.number().int().positive() }),
    contentDiff: z.boolean(),
    responseTime: z.object({ warnMs: z.number().int().positive() })
  }),
  notifications: z.any(),
  schedule: z.string().optional()
})

export async function settingsRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get("/api/settings", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const { sitemaps: _, ...rest } = deps.config
    return rest
  })

  app.put("/api/settings", async (req, reply) => {
    const session = await requireAdmin(req, reply, deps.auth)
    if (!session) return
    const parsed = configSchema.parse(req.body)
    deps.config.crawl = parsed.crawl
    deps.config.checks = parsed.checks
    deps.config.notifications = parsed.notifications
    deps.config.schedule = parsed.schedule
    deps.storage.setSetting("config", JSON.stringify(deps.config))
    writeConfigToFile(deps.configPath, deps.config)
    return { ok: true }
  })
}
