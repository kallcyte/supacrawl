import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { RouteDeps } from "./index.js"
import { requireAuth } from "../auth-helpers.js"

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
  enabledEvents: z.object({
    onCrawlFailure: z.boolean(),
    onContentChange: z.boolean(),
    onSslExpiring: z.boolean(),
    onCrawlComplete: z.boolean(),
    onMojibakeDetected: z.boolean(),
    onCrawlProgress: z.boolean()
  })
})

export async function userNotificationsRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get("/api/user/notifications", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const settings = deps.storage.getUserNotificationSettings(session.user.id)
    if (!settings) {
      return {
        slack: { enabled: false },
        telegram: { enabled: false },
        email: { enabled: false },
        webhook: { enabled: false },
        enabledEvents: {
          onCrawlFailure: false,
          onContentChange: false,
          onSslExpiring: false,
          onCrawlComplete: false,
          onMojibakeDetected: false,
          onCrawlProgress: false
        }
      }
    }
    return settings
  })

  app.put("/api/user/notifications", async (req, reply) => {
    const session = await requireAuth(req, reply, deps.auth)
    if (!session) return
    const body = userNotifSchema.parse(req.body)
    deps.storage.upsertUserNotificationSettings(session.user.id, body)
    return { ok: true }
  })
}
