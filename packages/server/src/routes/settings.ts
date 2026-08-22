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

    // Pull-based stream: one chunk per consumer pull (natural backpressure,
    // bounded memory). Rows come in fully-materialized batches via
    // backupTableBatches, and we only pause the event loop BETWEEN batches —
    // never while a SQLite statement is open. Holding better-sqlite3's
    // iterator across an await makes any interleaved statement on the shared
    // connection (resource monitor, heartbeats) throw "connection is busy",
    // which is what broke production backup downloads.
    const enc = new TextEncoder()

    async function* backupChunks(): AsyncGenerator<string> {
      yield `{"version":1,"exportedAt":${JSON.stringify(exportedAt)},"app":"supacrawl","tables":{`
      let firstTable = true
      for (const table of tableNames) {
        if (!firstTable) yield ","
        firstTable = false
        yield `${JSON.stringify(table)}:[`
        let first = true
        let count = 0
        for (const batch of storage.backupTableBatches(table)) {
          for (const row of batch) {
            if (!first) yield ","
            first = false
            yield JSON.stringify(row)
          }
          count += batch.length
          if (count % 2000 < batch.length) {
            // Yield between statements so timers (resource monitor snapshots,
            // heartbeat writes) can run without hitting an open query.
            const { promise, resolve } = Promise.withResolvers<void>()
            setImmediate(resolve)
            await promise
          }
        }
        yield "]"
      }
      yield "}}"
    }

    const chunks = backupChunks()
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { value, done } = await chunks.next()
          if (done) controller.close()
          else controller.enqueue(enc.encode(value))
        } catch (err) {
          controller.error(err)
        }
      },
      cancel() {
        chunks.return(undefined)
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
