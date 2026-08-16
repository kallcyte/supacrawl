import { randomUUID } from "node:crypto"
import type { Hono } from "hono"
import { z } from "zod"
import { StatusPageSchema } from "@supacrawl/core"
import type { StatusPageRecord } from "@supacrawl/core"
import type { RouteDeps } from "./index.js"
import { requireAdmin } from "../auth-helpers.js"

const updateStatusPageSchema = StatusPageSchema.partial()

const setMonitorsSchema = z.object({
  monitors: z.array(z.object({
    id: z.string().min(1),
    groupName: z.string().optional()
  })).min(1)
})

export function statusPagesRoutes(app: Hono, deps: RouteDeps): void {
  // List all status pages (admin)
  app.get("/api/status-pages", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const pages = deps.storage.listStatusPages()
    const pagesWithCount = pages.map((p) => ({
      ...p,
      monitorCount: deps.storage.getStatusPageMonitors(p.id).length
    }))
    return c.json({ pages: pagesWithCount })
  })

  // Create status page (admin)
  app.post("/api/status-pages", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const body = StatusPageSchema.parse(await c.req.json())

    // Check slug uniqueness
    const existing = deps.storage.getStatusPageBySlug(body.slug)
    if (existing) return c.json({ error: "Slug already taken" }, 409)

    const now = new Date().toISOString()
    const page: StatusPageRecord = {
      ...body,
      description: body.description ?? null,
      id: randomUUID(),
      createdAt: now
    }
    deps.storage.createStatusPage(page)
    return c.json(page)
  })

  // Get single status page with its monitors (admin)
  app.get("/api/status-pages/:id", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const id = c.req.param("id")
    const page = deps.storage.getStatusPage(id)
    if (!page) return c.json({ error: "Status page not found" }, 404)
    const monitors = deps.storage.getStatusPageMonitors(id)
    return c.json({ page, monitors })
  })

  // Update status page (admin)
  app.put("/api/status-pages/:id", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const id = c.req.param("id")
    const existing = deps.storage.getStatusPage(id)
    if (!existing) return c.json({ error: "Status page not found" }, 404)
    const body = updateStatusPageSchema.parse(await c.req.json())

    // If slug is changing, check uniqueness
    if (body.slug && body.slug !== existing.slug) {
      const slugExists = deps.storage.getStatusPageBySlug(body.slug)
      if (slugExists) return c.json({ error: "Slug already taken" }, 409)
    }

    deps.storage.updateStatusPage(id, body)
    const updated = deps.storage.getStatusPage(id)
    return c.json(updated)
  })

  // Delete status page (admin)
  app.delete("/api/status-pages/:id", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const id = c.req.param("id")
    const existing = deps.storage.getStatusPage(id)
    if (!existing) return c.json({ error: "Status page not found" }, 404)
    deps.storage.deleteStatusPage(id)
    return c.json({ ok: true })
  })

  // Set monitors for a status page (admin)
  app.put("/api/status-pages/:id/monitors", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const id = c.req.param("id")
    const existing = deps.storage.getStatusPage(id)
    if (!existing) return c.json({ error: "Status page not found" }, 404)
    const body = setMonitorsSchema.parse(await c.req.json())
    deps.storage.setStatusPageMonitors(id, body.monitors.map((m) => ({ monitorId: m.id, groupName: m.groupName })))
    return c.json({ ok: true })
  })

  // List all monitors for selection (admin)
  app.get("/api/status-pages/monitors/all", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const monitors = deps.storage.listMonitors()
    return c.json({ monitors })
  })

  // ─── Public endpoint (no auth) ───

  app.get("/api/public/status/:slug", async (c) => {
    const slug = c.req.param("slug")
    const page = deps.storage.getStatusPageBySlug(slug)
    if (!page || !page.public) return c.json({ error: "Status page not found" }, 404)

    const monitors = deps.storage.getStatusPageMonitors(page.id)

    // Enrich with stats (avg/max response time)
    const enriched = monitors.map((m) => {
      const stats = deps.storage.getMonitorStats(m.id)
      return {
        id: m.id,
        name: m.name,
        url: m.url,
        type: m.type,
        groupName: m.groupName ?? "",
        currentStatus: m.currentStatus,
        uptime24h: m.uptime24h,
        uptime7d: m.uptime7d,
        uptime30d: m.uptime30d,
        avgResponseTimeMs: stats.avgResponseTimeMs,
        maxResponseTimeMs: stats.maxResponseTimeMs,
        recentHeartbeats: m.recentHeartbeats
      }
    })

    // Compute overall summary
    const statuses = enriched.map((m) => m.currentStatus)
    const hasDown = statuses.some((s) => s === "down")
    const allDown = statuses.every((s) => s === "down" || s === null)
    const allUp = statuses.every((s) => s === "up" || s === null)
    let summary: "operational" | "degraded" | "outage"
    if (allDown && enriched.length > 0) {
      summary = "outage"
    } else if (hasDown) {
      summary = "degraded"
    } else {
      summary = "operational"
    }

    return c.json({
      page: {
        title: page.title,
        description: page.description,
        showResponseTimes: page.showResponseTimes
      },
      summary,
      monitors: enriched,
      generatedAt: new Date().toISOString()
    })
  })
}