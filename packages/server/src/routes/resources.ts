import type { Hono } from "hono"
import { readdirSync, statSync } from "node:fs"
import { join, dirname } from "node:path"
import type { RouteDeps } from "./index.js"
import { requireAuth } from "../auth-helpers.js"

export function resourcesRoutes(app: Hono, deps: RouteDeps): void {
  app.get("/api/resources/now", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const mem = process.memoryUsage()
    const cpu = process.cpuUsage()
    const dataDir = dirname(deps.dbPath)
    let diskUsedMb = 0
    try { diskUsedMb = Math.round((dirSize(dataDir) / 1024 / 1024) * 100) / 100 } catch { /* skip */ }
    return c.json({
      rssMb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
      heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
      heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
      externalMb: Math.round((mem.external / 1024 / 1024) * 100) / 100,
      cpuUserMs: Math.round((cpu.user / 1000) * 100) / 100,
      cpuSystemMs: Math.round((cpu.system / 1000) * 100) / 100,
      diskUsedMb,
      uptime: process.uptime()
    })
  })

  app.get("/api/resources/history", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const range = c.req.query("range") ?? "1h"
    const rangeMs: Record<string, number> = {
      "15m": 15 * 60 * 1000,
      "1h": 60 * 60 * 1000,
      "6h": 6 * 60 * 60 * 1000,
      "24h": 24 * 60 * 60 * 1000
    }
    const since = new Date(Date.now() - (rangeMs[range] ?? rangeMs["1h"])).toISOString()
    const snapshots = deps.storage.getResourceSnapshots(since)
    return c.json({ snapshots })
  })
}

function dirSize(dir: string): number {
  let total = 0
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) { total += dirSize(p) }
      else if (entry.isFile()) { try { total += statSync(p).size } catch { /* skip */ } }
    }
  } catch { /* dir gone */ }
  return total
}
