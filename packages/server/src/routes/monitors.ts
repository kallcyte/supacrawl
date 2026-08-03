import { randomUUID } from "node:crypto"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { MonitorSchema } from "@supacrawl/core"
import type { MonitorRecord } from "@supacrawl/core"
import type { RouteDeps } from "./index.js"
import { requireAdmin, requireAuth } from "../auth-helpers.js"

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

export async function monitorsRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get("/api/monitors", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const { page: pageRaw, perPage: perPageRaw } = req.query as { page?: string; perPage?: string }
    const perPage = Math.min(Math.max(Number(perPageRaw) || 5, 1), 50)
    const domains = deps.storage.listMonitorDomains()
    const totalDomains = domains.length
    const totalMonitors = domains.reduce((sum, d) => sum + d.count, 0)
    const totalPages = Math.max(1, Math.ceil(totalDomains / perPage))
    const page = Math.min(Math.max(Number(pageRaw) || 1, 1), totalPages)
    const pageDomains = domains.slice((page - 1) * perPage, page * perPage)
    const monitors = deps.storage.listMonitorsInDomains(pageDomains.map((d) => d.domain))
    return { monitors, page, perPage, totalPages, totalMonitors, totalDomains }
  })

  app.post("/api/monitors/bulk", async (req, reply) => {
    const session = await requireAdmin(req, reply, deps.auth)
    if (!session) return
    const body = bulkUpdateSchema.parse(req.body)
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
    return { updated }
  })

  app.post("/api/monitors/bulk/delete", async (req, reply) => {
    const session = await requireAdmin(req, reply, deps.auth)
    if (!session) return
    const body = bulkDeleteSchema.parse(req.body)
    for (const id of body.ids) deps.monitorScheduler.stopMonitor(id)
    const deleted = deps.storage.deleteMonitors(body.ids)
    return { deleted }
  })

  app.post("/api/monitors", async (req, reply) => {
    const session = await requireAdmin(req, reply, deps.auth)
    if (!session) return
    const body = createMonitorSchema.parse(req.body)
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
    return monitor
  })

  app.get("/api/monitors/:id", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const { id } = req.params as { id: string }
    const monitor = deps.storage.getMonitor(id)
    if (!monitor) return reply.code(404).send({ error: "Monitor not found" })
    const stats = deps.storage.getMonitorStats(id)
    return { monitor, stats, running: deps.monitorScheduler.isRunning(id) }
  })

  app.put("/api/monitors/:id", async (req, reply) => {
    const session = await requireAdmin(req, reply, deps.auth)
    if (!session) return
    const { id } = req.params as { id: string }
    const existing = deps.storage.getMonitor(id)
    if (!existing) return reply.code(404).send({ error: "Monitor not found" })
    const body = updateMonitorSchema.parse(req.body)
    deps.storage.updateMonitor(id, { ...body, updatedAt: new Date().toISOString() })
    const updated = deps.storage.getMonitor(id)
    if (updated?.enabled) deps.monitorScheduler.startMonitor(id)
    else deps.monitorScheduler.stopMonitor(id)
    return updated
  })

  app.delete("/api/monitors/:id", async (req, reply) => {
    const session = await requireAdmin(req, reply, deps.auth)
    if (!session) return
    const { id } = req.params as { id: string }
    const existing = deps.storage.getMonitor(id)
    if (!existing) return reply.code(404).send({ error: "Monitor not found" })
    deps.monitorScheduler.stopMonitor(id)
    deps.storage.deleteMonitor(id)
    return { ok: true }
  })

  app.post("/api/monitors/:id/start", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const { id } = req.params as { id: string }
    const existing = deps.storage.getMonitor(id)
    if (!existing) return reply.code(404).send({ error: "Monitor not found" })
    deps.storage.updateMonitor(id, { enabled: true, updatedAt: new Date().toISOString() })
    deps.monitorScheduler.startMonitor(id)
    return { ok: true }
  })

  app.post("/api/monitors/:id/stop", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const { id } = req.params as { id: string }
    const existing = deps.storage.getMonitor(id)
    if (!existing) return reply.code(404).send({ error: "Monitor not found" })
    deps.storage.updateMonitor(id, { enabled: false, updatedAt: new Date().toISOString() })
    deps.monitorScheduler.stopMonitor(id)
    return { ok: true }
  })

  app.get("/api/monitors/:id/heartbeats", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const { id } = req.params as { id: string }
    const monitor = deps.storage.getMonitor(id)
    if (!monitor) return reply.code(404).send({ error: "Monitor not found" })
    const { range } = req.query as { range?: string }
    const parsed = rangeSchema.parse(range ?? "24h")
    const since = new Date(Date.now() - rangeToMs[parsed]).toISOString()
    const heartbeats = deps.storage.listHeartbeatsSince(id, since)
    return { heartbeats }
  })

  app.get("/api/monitors/:id/uptime", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const { id } = req.params as { id: string }
    const monitor = deps.storage.getMonitor(id)
    if (!monitor) return reply.code(404).send({ error: "Monitor not found" })
    return { stats: deps.storage.getMonitorStats(id) }
  })
}
