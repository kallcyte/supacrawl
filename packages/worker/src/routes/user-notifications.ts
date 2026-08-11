import type { Hono } from "hono"
import { z } from "zod"
import { requireAuth } from "./auth-helpers.js"
import { getDeps } from "./route-deps.js"

const userNotifSchema = z.object({
  slack: z.object({
    enabled: z.boolean(),
    webhookUrl: z.string().optional()
  }),
  telegram: z.object({
    enabled: z.boolean(),
    botToken: z.string().optional(),
    chatId: z.string().optional()
  }),
  email: z.object({
    enabled: z.boolean(),
    smtp: z.object({
      host: z.string().optional(),
      port: z.number().int().positive().optional(),
      secure: z.boolean().optional(),
      user: z.string().optional(),
      pass: z.string().optional()
    }).optional(),
    from: z.string().optional(),
    to: z.array(z.string()).optional()
  }),
  webhook: z.object({
    enabled: z.boolean(),
    url: z.string().optional(),
    secret: z.string().optional()
  }),
  teams: z.object({
    enabled: z.boolean(),
    webhookUrl: z.string().optional()
  }).optional(),
  enabledEvents: z.object({
    onCrawlFailure: z.boolean(),
    onContentChange: z.boolean(),
    onSslExpiring: z.boolean(),
    onCrawlComplete: z.boolean(),
    onMojibakeDetected: z.boolean(),
    onLlmGarbageDetected: z.boolean(),
    onCrawlProgress: z.boolean(),
    onMonitorDown: z.boolean().optional(),
    onMonitorRecovery: z.boolean().optional()
  })
})

export function userNotificationsRoutes(app: Hono): void {
  app.get("/api/user/notifications", async (c) => {
    const deps = getDeps()
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const settings = await deps.storage.getUserNotificationSettings(session.user.id)
    if (!settings) {
      return c.json({
        slack: { enabled: false },
        telegram: { enabled: false },
        email: { enabled: false },
        webhook: { enabled: false },
        teams: { enabled: false },
        enabledEvents: {
          onCrawlFailure: false,
          onContentChange: false,
          onSslExpiring: false,
          onCrawlComplete: false,
          onMojibakeDetected: false,
          onLlmGarbageDetected: false,
          onCrawlProgress: false
        }
      })
    }
    return c.json(settings)
  })

  app.put("/api/user/notifications", async (c) => {
    const deps = getDeps()
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    const body = userNotifSchema.parse(await c.req.json())
    const full = {
      slack: body.slack,
      telegram: body.telegram,
      email: body.email,
      webhook: body.webhook,
      teams: body.teams ?? { enabled: false },
      enabledEvents: {
        onCrawlFailure: body.enabledEvents.onCrawlFailure,
        onContentChange: body.enabledEvents.onContentChange,
        onSslExpiring: body.enabledEvents.onSslExpiring,
        onCrawlComplete: body.enabledEvents.onCrawlComplete,
        onMojibakeDetected: body.enabledEvents.onMojibakeDetected,
        onLlmGarbageDetected: body.enabledEvents.onLlmGarbageDetected ?? false,
        onCrawlProgress: body.enabledEvents.onCrawlProgress ?? false,
        onMonitorDown: body.enabledEvents.onMonitorDown ?? false,
        onMonitorRecovery: body.enabledEvents.onMonitorRecovery ?? false
      }
    }
    await deps.storage.upsertUserNotificationSettings(session.user.id, full)
    return c.json({ ok: true })
  })
}