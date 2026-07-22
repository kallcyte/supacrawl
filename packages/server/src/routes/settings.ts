import { writeFileSync } from "node:fs"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { RouteDeps } from "./index.js"
import { requireAdmin, requireAuth } from "../auth-helpers.js"
import { writeConfigToFile, discoverSitemapTree } from "@supacrawl/core"

const sitemapSchema = z.object({ url: z.string().url(), enabled: z.boolean().default(true) })

const configSchema = z.object({
  sitemaps: z.array(sitemapSchema),
  crawl: z.object({
    delayMs: z.number().int().nonnegative(),
    maxConcurrency: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
    userAgent: z.string().min(1),
    respectRobotsTxt: z.boolean(),
    maxUrls: z.number().int().positive(),
    retryOnTransientError: z.boolean(),
    maxRetries: z.number().int().nonnegative()
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
    return deps.config
  })

  app.put("/api/settings", async (req, reply) => {
    const session = await requireAdmin(req, reply, deps.auth)
    if (!session) return
    const parsed = configSchema.parse(req.body)
    deps.storage.setSetting("config", JSON.stringify(parsed))
    return { ok: true }
  })

  app.post("/api/settings/sitemaps", async (req, reply) => {
    const session = await requireAdmin(req, reply, deps.auth)
    if (!session) return
    const { url } = z.object({ url: z.string().url() }).parse(req.body)
    if (deps.config.sitemaps.some((s) => s.url === url)) {
      return reply.code(409).send({ error: "Sitemap already exists" })
    }
    deps.config.sitemaps.push({ url, enabled: true })
    deps.storage.setSetting("config", JSON.stringify(deps.config))
    writeConfigToFile(deps.configPath, deps.config)
    return { sitemaps: deps.config.sitemaps }
  })

  app.delete("/api/settings/sitemaps", async (req, reply) => {
    const session = await requireAdmin(req, reply, deps.auth)
    if (!session) return
    const { url } = z.object({ url: z.string().url() }).parse(req.body)
    const idx = deps.config.sitemaps.findIndex((s) => s.url === url)
    if (idx === -1) {
      return reply.code(404).send({ error: "Sitemap not found" })
    }
    deps.config.sitemaps.splice(idx, 1)
    deps.storage.setSetting("config", JSON.stringify(deps.config))
    writeConfigToFile(deps.configPath, deps.config)
    return { sitemaps: deps.config.sitemaps }
  })

  app.patch("/api/settings/sitemaps/:url/toggle", async (req, reply) => {
    const session = await requireAdmin(req, reply, deps.auth)
    if (!session) return
    const url = decodeURIComponent((req.params as { url: string }).url)
    const entry = deps.config.sitemaps.find((s) => s.url === url)
    if (!entry) return reply.code(404).send({ error: "Sitemap not found" })
    entry.enabled = !entry.enabled
    deps.storage.setSetting("config", JSON.stringify(deps.config))
    writeConfigToFile(deps.configPath, deps.config)
    return { sitemaps: deps.config.sitemaps }
  })

  app.post("/api/settings/sitemaps/discover", async (req, reply) => {
    const session = await requireAdmin(req, reply, deps.auth)
    if (!session) return
    const { url } = z.object({ url: z.string().url() }).parse(req.body)
    const tree = await discoverSitemapTree(url)
    return tree
  })
}
