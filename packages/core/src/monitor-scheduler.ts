import { randomUUID } from "node:crypto"
import { checkMonitor } from "./monitor.js"
import type { Storage } from "./storage.js"
import { Notifier } from "./notifier/index.js"
import type { Heartbeat, HeartbeatResult, MonitorRecord } from "./types.js"

export interface MonitorSchedulerOptions {
  storage: Storage
  notifier: Notifier
  onHeartbeat?: (h: Heartbeat) => void
  fetchImpl?: typeof fetch
}

/**
 * Long-running service that runs a heartbeat check per enabled monitor on its
 * configured interval, persists results, and fires down/recovery notifications
 * on status transitions.
 */
export class MonitorScheduler {
  private timers = new Map<string, NodeJS.Timeout>()
  private running = new Set<string>()

  constructor(private opts: MonitorSchedulerOptions) {}

  startAll(): void {
    for (const m of this.opts.storage.listEnabledMonitors()) {
      this.startMonitor(m.id)
    }
  }

  startMonitor(id: string): void {
    this.stopMonitor(id)
    const m = this.opts.storage.getMonitor(id)
    if (!m || !m.enabled) return
    const ms = Math.max(10, m.intervalSeconds) * 1000
    this.tick(id)
    const timer = setInterval(() => this.tick(id), ms)
    timer.unref?.()
    this.timers.set(id, timer)
  }

  stopMonitor(id: string): void {
    const timer = this.timers.get(id)
    if (timer) {
      clearInterval(timer)
      this.timers.delete(id)
    }
  }

  stopAll(): void {
    for (const id of [...this.timers.keys()]) this.stopMonitor(id)
  }

  isRunning(id: string): boolean {
    return this.timers.has(id)
  }

  async tick(id: string): Promise<void> {
    if (this.running.has(id)) return
    this.running.add(id)
    try {
      const m = this.opts.storage.getMonitor(id)
      if (!m || !m.enabled) {
        this.stopMonitor(id)
        return
      }
      const previous = this.opts.storage.getLatestHeartbeat(m.id)
      const result = await checkMonitor(m, { fetchImpl: this.opts.fetchImpl })
      const heartbeat: Heartbeat = {
        id: randomUUID(),
        monitorId: m.id,
        status: result.status,
        responseTimeMs: result.responseTimeMs,
        message: result.message,
        checkedAt: result.checkedAt
      }
      this.opts.storage.insertHeartbeat(heartbeat)
      await this.handleTransition(m, previous, result)
      this.opts.onHeartbeat?.(heartbeat)
    } catch (err) {
      console.error(`[monitor ${id}] check failed:`, err)
    } finally {
      this.running.delete(id)
    }
  }

  private async handleTransition(
    m: MonitorRecord,
    previous: Heartbeat | null,
    result: HeartbeatResult
  ): Promise<void> {
    const inMaintenance = this.opts.storage.hasActiveMaintenanceWindow(m.id, result.checkedAt)
    if (result.status === "down" && previous?.status === "up") {
      if (inMaintenance) return
      await this.opts.notifier.notify("onMonitorDown", {
        event: "onMonitorDown",
        title: `Monitor "${m.name}" is DOWN`,
        message: `Monitor "${m.name}" (${m.url}) is down: ${result.message ?? "Check failed"}`,
        url: m.url,
        meta: { monitorId: m.id, status: "down" }
      })
    } else if (result.status === "down" && m.notifyOnEveryDown) {
      if (inMaintenance) return
      await this.opts.notifier.notify("onMonitorDown", {
        event: "onMonitorDown",
        title: `Monitor "${m.name}" is still DOWN`,
        message: `Monitor "${m.name}" (${m.url}) is still down: ${result.message ?? "Check failed"}`,
        url: m.url,
        meta: { monitorId: m.id, status: "down" }
      })
    } else if (result.status === "up" && previous?.status === "down") {
      if (inMaintenance) return
      await this.opts.notifier.notify("onMonitorRecovery", {
        event: "onMonitorRecovery",
        title: `Monitor "${m.name}" is UP again`,
        message: `Monitor "${m.name}" (${m.url}) recovered and is back online.`,
        url: m.url,
        meta: { monitorId: m.id, status: "up" }
      })
    }
  }
}
