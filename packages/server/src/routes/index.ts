import type { FastifyInstance } from "fastify"
import type { Auth } from "../auth.js"
import { SetupService } from "../setup.js"
import type { Storage, Notifier, Config } from "@supacrawl/core"
import type { CrawlManager } from "../crawl-manager.js"
import { crawlsRoutes } from "./crawls.js"
import { crawlJobsRoutes } from "./crawl-jobs.js"
import { resultsRoutes } from "./results.js"
import { urlsRoutes } from "./urls.js"
import { statsRoutes } from "./stats.js"
import { settingsRoutes } from "./settings.js"
import { usersRoutes } from "./users.js"
import { notifiersRoutes } from "./notifiers.js"
import { authRoutes } from "./auth.js"
import { setupRoutes } from "./setup.js"
import { userNotificationsRoutes } from "./user-notifications.js"
import { monitorsRoutes } from "./monitors.js"
import type { MonitorScheduler } from "@supacrawl/core"
import type { JobScheduler } from "../job-scheduler.js"

export interface RouteDeps {
  app: FastifyInstance
  auth: Auth
  storage: Storage
  notifier: Notifier
  config: Config
  crawlManager: CrawlManager
  monitorScheduler: MonitorScheduler
  jobScheduler: JobScheduler
  dbPath: string
  configPath: string
}

export async function registerRoutes(deps: RouteDeps): Promise<void> {
  const setup = new SetupService(deps.dbPath, deps.auth, deps.storage)

  await deps.app.register(async (instance) => {
    await crawlsRoutes(instance, deps)
    await crawlJobsRoutes(instance, deps)
    await resultsRoutes(instance, deps)
    await urlsRoutes(instance, deps)
    await statsRoutes(instance, deps)
    await settingsRoutes(instance, deps)
    await usersRoutes(instance, deps)
    await notifiersRoutes(instance, deps)
    await authRoutes(instance, deps)
    await userNotificationsRoutes(instance, deps)
    await monitorsRoutes(instance, deps)
    await setupRoutes(instance, { ...deps, setup })

    instance.get("/api/ws/crawl/:id", { websocket: true }, (socket, req) => {
      const crawlId = (req.params as { id: string }).id
      deps.app.log.info(`WebSocket client connected for crawl ${crawlId}`)
      socket.on("close", () => {
        deps.app.log.info(`WebSocket client disconnected from crawl ${crawlId}`)
      })
    })

    instance.get("/api/ws/monitors", { websocket: true }, (socket) => {
      deps.app.log.info("WebSocket client connected for monitors")
      socket.on("close", () => {
        deps.app.log.info("WebSocket client disconnected from monitors")
      })
    })
  })
}
