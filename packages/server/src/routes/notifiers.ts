import type { FastifyInstance } from "fastify"
import type { RouteDeps } from "./index.js"
import { requireAdmin, requireAuth } from "../auth-helpers.js"
import { NotificationsConfigSchema, Notifier, writeConfigToFile } from "@supacrawl/core"

export async function notifiersRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get("/api/notifiers", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    return {
      enabled: deps.notifier.enabledProviders,
      config: deps.config.notifications
    }
  })

  app.put("/api/notifiers", async (req, reply) => {
    const session = await requireAdmin(req, reply, deps.auth)
    if (!session) return
    try {
      const parsed = NotificationsConfigSchema.parse(req.body)
      deps.config.notifications = parsed
      const newNotifier = new Notifier(parsed)
      deps.notifier = newNotifier
      deps.crawlManager.setNotifier(newNotifier)
      writeConfigToFile(deps.configPath, deps.config)
      return { ok: true }
    } catch (err) {
      return reply.code(400).send({ ok: false, error: (err as Error).message })
    }
  })

  app.post("/api/notifiers/:name/test", async (req, reply) => {
    const session = await requireAdmin(req, reply, deps.auth)
    if (!session) return
    const { name } = req.params as { name: string }
    const provider = deps.notifier.enabledProviders.includes(name)
      ? name
      : null
    if (!provider) return reply.code(400).send({ error: "Provider not enabled" })
    const providers = {
      slack: deps.config.notifications.providers.slack,
      telegram: deps.config.notifications.providers.telegram,
      email: deps.config.notifications.providers.email,
      webhook: deps.config.notifications.providers.webhook
    }
    const cfg = providers[name as keyof typeof providers]
    if (!cfg) return reply.code(400).send({ error: "Unknown provider" })
    try {
      const mod = await import("@supacrawl/core")
      const Cls = (mod as Record<string, unknown>)[`${name.charAt(0).toUpperCase() + name.slice(1)}Provider`] as
        | (new (c: unknown) => { testConnection: () => Promise<{ ok: boolean; error?: string }> })
        | undefined
      if (!Cls) return reply.code(400).send({ error: "Provider not available" })
      const instance = new Cls(cfg)
      const r = await instance.testConnection()
      return r
    } catch (err) {
      return reply.code(500).send({ ok: false, error: (err as Error).message })
    }
  })
}
