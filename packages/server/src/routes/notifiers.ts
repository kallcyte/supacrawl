import type { Hono } from "hono"
import type { RouteDeps } from "./index.js"
import { requireAdmin, requireAuth } from "../auth-helpers.js"
import { NotificationsConfigSchema, Notifier, writeConfigToFile } from "@supacrawl/core"

export function notifiersRoutes(app: Hono, deps: RouteDeps): void {
  app.get("/api/notifiers", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    return c.json({
      enabled: deps.notifier.enabledProviders,
      config: deps.config.notifications
    })
  })

  app.put("/api/notifiers", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    try {
      const parsed = NotificationsConfigSchema.parse(await c.req.json())
      deps.config.notifications = parsed
      const newNotifier = new Notifier(parsed)
      deps.notifier = newNotifier
      deps.crawlManager.setNotifier(newNotifier)
      writeConfigToFile(deps.configPath, deps.config)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 400)
    }
  })

  app.post("/api/notifiers/:name/test", async (c) => {
    const session = await requireAdmin(c, deps.auth)
    if (!session) return c.json({ error: "Forbidden" }, 403)
    const name = c.req.param("name")
    const provider = deps.notifier.enabledProviders.includes(name) ? name : null
    if (!provider) return c.json({ error: "Provider not enabled" }, 400)
    const providers = {
      slack: deps.config.notifications.providers.slack,
      telegram: deps.config.notifications.providers.telegram,
      email: deps.config.notifications.providers.email,
      webhook: deps.config.notifications.providers.webhook
    }
    const cfg = providers[name as keyof typeof providers]
    if (!cfg) return c.json({ error: "Unknown provider" }, 400)
    try {
      const mod = await import("@supacrawl/core")
      const Cls = (mod as Record<string, unknown>)[`${name.charAt(0).toUpperCase() + name.slice(1)}Provider`] as
        | (new (c: unknown) => { testConnection: () => Promise<{ ok: boolean; error?: string }> })
        | undefined
      if (!Cls) return c.json({ error: "Provider not available" }, 400)
      const instance = new Cls(cfg)
      const r = await instance.testConnection()
      return c.json(r)
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })
}
