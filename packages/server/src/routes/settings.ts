import { writeFileSync } from "node:fs"
import type { Hono } from "hono"
import { z } from "zod"
import type { RouteDeps } from "./index.js"
import { requireAdmin, requireAuth } from "../auth-helpers.js"
import { writeConfigToFile, FullBackupSchema } from "@supacrawl/core"

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

  // Full database backup. Streamed table-by-table so a large crawl_results
  // table doesn't get buffered into one giant object (keeps RSS bounded).
  app.get("/api/settings/backup", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const storage = deps.storage
    const tableNames = storage.getBackupTableNames()
    const exportedAt = new Date().toISOString()
    const filename = `supacrawl-backup-${exportedAt.slice(0, 10)}.json`

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder()
        const write = (s: string) => controller.enqueue(enc.encode(s))
        write(`{"version":1,"exportedAt":${JSON.stringify(exportedAt)},"app":"supacrawl","tables":{`)
        let firstTable = true
        for (const table of tableNames) {
          if (!firstTable) write(",")
          firstTable = false
          write(`${JSON.stringify(table)}:[`)
          let first = true
          let count = 0
          for (const row of storage.iterateBackupTable(table)) {
            if (!first) write(",")
            first = false
            write(JSON.stringify(row))
            count++
            if (count % 2000 === 0) await new Promise((r) => setTimeout(r)) // yield to the event loop
          }
          write("]")
        }
        write("}}")
        controller.close()
      }
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`
      }
    })
  })

  app.post("/api/settings/restore", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    let parsed
    try {
      parsed = FullBackupSchema.parse(await c.req.json())
    } catch (err) {
      if (err instanceof z.ZodError) {
        return c.json({ error: "Invalid backup file", details: err.errors }, 400)
      }
      throw err
    }
    const result = deps.storage.restoreFromBackup(parsed.tables)
    if (globalThis.gc) globalThis.gc()
    if (result.errors.length > 0) {
      return c.json({ ok: false, ...result }, 422)
    }
    return c.json({ ok: true, ...result })
  })
}
