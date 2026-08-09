import type { Hono } from "hono"
import type { Auth } from "../auth.js"
import type { Storage, Notifier, Config, MonitorScheduler } from "@supacrawl/core"
import type { CrawlManager } from "../crawl-manager.js"
import type { JobScheduler } from "../job-scheduler.js"
import type { ResourceMonitor } from "../resource-monitor.js"

export interface RouteDeps {
  auth: Auth
  storage: Storage
  notifier: Notifier
  config: Config
  crawlManager: CrawlManager
  monitorScheduler: MonitorScheduler
  jobScheduler: JobScheduler
  resourceMonitor: ResourceMonitor
  dbPath: string
  configPath: string
  wsServer: { clients: Set<{ readyState: number; send: (data: string) => void }> }
}
