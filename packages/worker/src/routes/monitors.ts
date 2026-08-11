import type { Hono } from "hono"
import { z } from "zod"
import { MonitorSchema } from "@supacrawl/core"
import type { MonitorRecord } from "@supacrawl/core"
import { requireAdmin, requireAuth } from "./auth-helpers.js"
import { getDeps } from "./route-deps.js"

const createMonitorSchema = MonitorSchema
const updateMonitorSchema = MonitorSchema.partial()

const bulkPatchSchema = z.object({
  name: z.string().min(1).optional(),
  method: z.string().optional(),
  expectedStatus: z.number().int().optional(),
  expectedBody: z.string().nullable().optional(),
  intervalSeconds: z.number().int().positive().optional(),
  retryCount: z.number().int().nonnegative().optional(),
  timeoutMs: z.number().int().positive().optional(),
  acceptedResponseTimeMs: z.number().int().positive().optional(),
  enabled: z.boolean().optional()
})

const bulkUpdateSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  patch: bulkPatchSchema
})

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1)
})

const rangeSchema = z.enum(["24h", "7d", "30d"]).default("24h")
const rangeToMs: Record<z.infer<typeof rangeSchema>, number> = {
  "24h": 24 * 3600 * 1000,
  "7d": 7 * 24 * 3600 * 1000,
  "30d": 30 * 24 * 3600 * 1000
}

export function monitorsRoutes(app: Hono): void {
  app.get("/api/monitors", async (c) => {
    const deps = getDeps()
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const { page: pageRaw, perPage: perPageRaw } = c.req.query()
    const perPage = Math.min(Math.max(Number(perPageRaw) || 5, 1), 50)
    const domains = await deps.storage.listMonitorDomains()
    const totalDomains = domains.length
    const totalMonitors = domains.reduce((sum, d) => sum + d.count, 0)
    const totalPages = Math.max(1, Math.ceil(totalDomains / perPage))
    const page = Math.min(Math.max(Number(pageRaw) || 1, 1), totalPages)
    const pageDomains = domains.slice((page - 1) * perPage, page * perPage)
    const monitors = await deps.storage.listMonitorsInDomains(pageDomains.map((d) => d.domain))
    return c.json({ monitors, page, perPage, totalPages, totalMonitors, totalDomains })
  })

  app.post("/api/monitors/bulk", async (c) => {
    const deps = getDeps()
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const body = bulkUpdateSchema.parse(await c.req.json())
    const updated = await deps.storage.updateMonitors(body.ids, {
      ...body.patch,
      updatedAt: new Date().toISOString()
    })
    return c.json({ updated })
  })

  app.post("/api/monitors/bulk/delete", async (c) => {
    const deps = getDeps()
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const body = bulkDeleteSchema.parse(await c.req.json())
    const deleted = await deps.storage.deleteMonitors(body.ids)
    return c.json({ deleted })
  })

  app.post("/api/monitors", async (c) => {
    const deps = getDeps()
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const body = createMonitorSchema.parse(await c.req.json())
    const now = new Date().toISOString()
    const monitor: MonitorRecord = {
      ...body,
      expectedBody: body.expectedBody ?? null,
      jobId: body.jobId ?? null,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now
    }
    await deps.storage.createMonitor(monitor)
    return c.json(monitor)
  })

  app.get("/api/monitors/:id", async (c) => {
    const deps = getDeps()
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    const monitor = await deps.storage.getMonitor(id)
    if (!monitor) return c.json({ error: "Monitor not found" }, 404)
    const stats = await deps.storage.getMonitorStats(id)
    return c.json({ monitor, stats, running: false })
  })

  app.put("/api/monitors/:id", async (c) => {
    const deps = getDeps()
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const id = c.req.param("id")
    const existing = await deps.storage.getMonitor(id)
    if (!existing) return c.json({ error: "Monitor not found" }, 404)
    const body = updateMonitorSchema.parse(await c.req.json())
    await deps.storage.updateMonitor(id, { ...body, updatedAt: new Date().toISOString() })
    const updated = await deps.storage.getMonitor(id)
    return c.json(updated)
  })

  app.delete("/api/monitors/:id", async (c) => {
    const deps = getDeps()
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const id = c.req.param("id")
    const existing = await deps.storage.getMonitor(id)
    if (!existing) return c.json({ error: "Monitor not found" }, 404)
    await deps.storage.deleteMonitor(id)
    return c.json({ ok: true })
  })

  app.post("/api/monitors/:id/start", async (c) => {
    const deps = getDeps()
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    const existing = await deps.storage.getMonitor(id)
    if (!existing) return c.json({ error: "Monitor not found" }, 404)
    await deps.storage.updateMonitor(id, { enabled: true, updatedAt: new Date().toISOString() })
    return c.json({ ok: true })
  })

  app.post("/api/monitors/:id/stop", async (c) => {
    const deps = getDeps()
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    const existing = await deps.storage.getMonitor(id)
    if (!existing) return c.json({ error: "Monitor not found" }, 404)
    await deps.storage.updateMonitor(id, { enabled: false, updatedAt: new Date().toISOString() })
    return c.json({ ok: true })
  })

  app.get("/api/monitors/:id/heartbeats", async (c) => {
    const deps = getDeps()
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    const monitor = await deps.storage.getMonitor(id)
    if (!monitor) return c.json({ error: "Monitor not found" }, 404)
    const { range } = c.req.query()
    const parsed = rangeSchema.parse(range ?? "24h")
    const since = new Date(Date.now() - rangeToMs[parsed]).toISOString()
    const heartbeats = await deps.storage.listHeartbeatsSince(id, since)
    return c.json({ heartbeats })
  })

  app.get("/api/monitors/:id/uptime", async (c) => {
    const deps = getDeps()
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    const monitor = await deps.storage.getMonitor(id)
    if (!monitor) return c.json({ error: "Monitor not found" }, 404)
    return c.json({ stats: await deps.storage.getMonitorStats(id) })
  })
}