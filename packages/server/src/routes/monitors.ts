import { randomUUID } from "node:crypto"
import type { Hono } from "hono"
import { z } from "zod"
import { MonitorSchema, MaintenanceWindowSchema, MonitorsExportSchema, MaintenanceWindowsExportSchema } from "@supacrawl/core"
import type { MonitorRecord, MaintenanceWindowRecord } from "@supacrawl/core"
import type { RouteDeps } from "./index.js"
import { requireAdmin, requireAuth } from "../auth-helpers.js"

const createMonitorSchema = MonitorSchema
const updateMonitorSchema = MonitorSchema.partial()

const createMaintenanceWindowSchema = MaintenanceWindowSchema
const updateMaintenanceWindowSchema = MaintenanceWindowSchema.partial()

const bulkPatchSchema = z.object({
  name: z.string().min(1).optional(),
  group: z.string().optional(),
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

export function monitorsRoutes(app: Hono, deps: RouteDeps): void {
  app.get("/api/monitors", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const { page: pageRaw, perPage: perPageRaw } = c.req.query()
    const perPage = Math.min(Math.max(Number(perPageRaw) || 5, 1), 50)
    const domains = deps.storage.listMonitorDomains()
    const totalDomains = domains.length
    const totalMonitors = domains.reduce((sum, d) => sum + d.count, 0)
    const totalPages = Math.max(1, Math.ceil(totalDomains / perPage))
    const page = Math.min(Math.max(Number(pageRaw) || 1, 1), totalPages)
    const pageDomains = domains.slice((page - 1) * perPage, page * perPage)
    const monitors = deps.storage.listMonitorsInDomains(pageDomains.map((d) => d.domain))
    return c.json({ monitors, page, perPage, totalPages, totalMonitors, totalDomains })
  })

  // Flat list of ALL monitors (no pagination) — used by the grouped Monitors page
  app.get("/api/monitors/all", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const monitors = deps.storage.listMonitors()
    return c.json({ monitors })
  })

  app.get("/api/monitors/export", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const { monitors, heartbeats } = deps.storage.exportMonitors()
    return c.json({
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      monitors,
      heartbeats
    })
  })

  app.post("/api/monitors/import", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const body = MonitorsExportSchema.parse(await c.req.json())
    const records: MonitorRecord[] = body.monitors.map((m) => ({
      ...m,
      expectedBody: m.expectedBody ?? null,
      jobId: m.jobId ?? null
    }))
    const heartbeats = (body.heartbeats ?? []).map((h) => ({
      ...h,
      status: h.status,
      responseTimeMs: h.responseTimeMs ?? null,
      message: h.message ?? null
    }))
    const result = deps.storage.importMonitors(records, heartbeats)
    // Restart the scheduler for any freshly enabled monitors so checks resume.
    for (const m of deps.storage.listMonitors()) {
      if (m.enabled) deps.monitorScheduler.startMonitor(m.id)
    }
    if (globalThis.gc) globalThis.gc()
    return c.json(result)
  })

  app.post("/api/monitors/bulk", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const body = bulkUpdateSchema.parse(await c.req.json())
    const updated = deps.storage.updateMonitors(body.ids, {
      ...body.patch,
      updatedAt: new Date().toISOString()
    })
    for (const id of body.ids) {
      const current = deps.storage.getMonitor(id)
      if (!current) continue
      if (current.enabled) deps.monitorScheduler.startMonitor(id)
      else deps.monitorScheduler.stopMonitor(id)
    }
    return c.json({ updated })
  })

  app.post("/api/monitors/bulk/delete", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const body = bulkDeleteSchema.parse(await c.req.json())
    for (const id of body.ids) deps.monitorScheduler.stopMonitor(id)
    const deleted = deps.storage.deleteMonitors(body.ids)
    return c.json({ deleted })
  })

  app.post("/api/monitors", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const body = createMonitorSchema.parse(await c.req.json())
    const now = new Date().toISOString()
    const monitor: MonitorRecord = {
      ...body,
      expectedBody: body.expectedBody ?? null,
      jobId: body.jobId ?? null,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now
    }
    deps.storage.createMonitor(monitor)
    if (monitor.enabled) deps.monitorScheduler.startMonitor(monitor.id)
    return c.json(monitor)
  })

  app.get("/api/monitors/:id", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    const monitor = deps.storage.getMonitor(id)
    if (!monitor) return c.json({ error: "Monitor not found" }, 404)
    const stats = deps.storage.getMonitorStats(id)
    return c.json({ monitor, stats, running: deps.monitorScheduler.isRunning(id) })
  })

  app.put("/api/monitors/:id", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const id = c.req.param("id")
    const existing = deps.storage.getMonitor(id)
    if (!existing) return c.json({ error: "Monitor not found" }, 404)
    const body = updateMonitorSchema.parse(await c.req.json())
    deps.storage.updateMonitor(id, { ...body, updatedAt: new Date().toISOString() })
    const updated = deps.storage.getMonitor(id)
    if (updated?.enabled) deps.monitorScheduler.startMonitor(id)
    else deps.monitorScheduler.stopMonitor(id)
    return c.json(updated)
  })

  app.delete("/api/monitors/:id", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const id = c.req.param("id")
    const existing = deps.storage.getMonitor(id)
    if (!existing) return c.json({ error: "Monitor not found" }, 404)
    deps.monitorScheduler.stopMonitor(id)
    deps.storage.deleteMonitor(id)
    return c.json({ ok: true })
  })

  app.post("/api/monitors/:id/start", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    const existing = deps.storage.getMonitor(id)
    if (!existing) return c.json({ error: "Monitor not found" }, 404)
    deps.storage.updateMonitor(id, { enabled: true, updatedAt: new Date().toISOString() })
    deps.monitorScheduler.startMonitor(id)
    return c.json({ ok: true })
  })

  app.post("/api/monitors/:id/stop", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    const existing = deps.storage.getMonitor(id)
    if (!existing) return c.json({ error: "Monitor not found" }, 404)
    deps.storage.updateMonitor(id, { enabled: false, updatedAt: new Date().toISOString() })
    deps.monitorScheduler.stopMonitor(id)
    return c.json({ ok: true })
  })

  app.get("/api/monitors/:id/heartbeats", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    const monitor = deps.storage.getMonitor(id)
    if (!monitor) return c.json({ error: "Monitor not found" }, 404)
    const { range } = c.req.query()
    const parsed = rangeSchema.parse(range ?? "24h")
    const since = new Date(Date.now() - rangeToMs[parsed]).toISOString()
    const heartbeats = deps.storage.listHeartbeatsSince(id, since)
    return c.json({ heartbeats })
  })

  app.get("/api/monitors/:id/uptime", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    const monitor = deps.storage.getMonitor(id)
    if (!monitor) return c.json({ error: "Monitor not found" }, 404)
    return c.json({ stats: deps.storage.getMonitorStats(id) })
  })

  // ─── Maintenance windows ───

  app.get("/api/maintenance-windows", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    return c.json({ windows: deps.storage.listMaintenanceWindows() })
  })

  app.post("/api/maintenance-windows", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const body = createMaintenanceWindowSchema.parse(await c.req.json())
    const monitor = deps.storage.getMonitor(body.monitorId)
    if (!monitor) return c.json({ error: "Monitor not found" }, 404)
    if (new Date(body.endAt) <= new Date(body.startAt)) {
      return c.json({ error: "End time must be after start time" }, 400)
    }
    const window: MaintenanceWindowRecord = {
      ...body,
      description: body.description ?? null,
      id: randomUUID(),
      createdAt: new Date().toISOString()
    }
    deps.storage.createMaintenanceWindow(window)
    return c.json(window)
  })

  app.get("/api/maintenance-windows/export", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const windows = deps.storage.exportMaintenanceWindows()
    return c.json({
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      windows
    })
  })

  app.post("/api/maintenance-windows/import", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const body = MaintenanceWindowsExportSchema.parse(await c.req.json())
    const result = deps.storage.importMaintenanceWindows(body.windows)
    if (globalThis.gc) globalThis.gc()
    return c.json(result)
  })

  app.delete("/api/maintenance-windows/:id", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const id = c.req.param("id")
    const existing = deps.storage.listMaintenanceWindows().find((w) => w.id === id)
    if (!existing) return c.json({ error: "Maintenance window not found" }, 404)
    deps.storage.deleteMaintenanceWindow(id)
    return c.json({ ok: true })
  })

  // Per-monitor maintenance windows (for MonitorDetail page)
  app.get("/api/monitors/:id/maintenance-windows", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const id = c.req.param("id")
    const monitor = deps.storage.getMonitor(id)
    if (!monitor) return c.json({ error: "Monitor not found" }, 404)
    return c.json({ windows: deps.storage.listMaintenanceWindowsForMonitor(id) })
  })
}
