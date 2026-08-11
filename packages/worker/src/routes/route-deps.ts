import type { Auth } from "../auth-d1.js"
import type { Storage } from "../storage-d1.js"
import type { Notifier, Config } from "@supacrawl/core"

/**
 * Worker-compatible RouteDeps — stripped of Node-specific deps.
 * - No `crawlManager`, `monitorScheduler`, `jobScheduler` (→ M4 cron/Queues)
 * - No `resourceMonitor`, `wsServer`, `dbPath`, `configPath`
 * - `storage` is async (D1-backed)
 */
export interface RouteDeps {
  auth: Auth
  storage: Storage
  notifier: Notifier
  config: Config
  db: D1Database
  crawlQueue: Queue
}

/** Per-request deps store. Set by middleware before route handlers run. */
let _current: RouteDeps | null = null

export function setDeps(deps: RouteDeps): void {
  _current = deps
}

export function getDeps(): RouteDeps {
  return _current!
}