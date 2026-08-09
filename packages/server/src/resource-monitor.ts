import { readdirSync, statSync } from "node:fs"
import { join, dirname } from "node:path"
import type { Storage } from "@supacrawl/core"

export class ResourceMonitor {
  private interval?: ReturnType<typeof setInterval>
  private purgeInterval?: ReturnType<typeof setInterval>
  private lastCpuUsage = process.cpuUsage()
  private dataDir: string

  constructor(private storage: Storage, dbPath: string) {
    this.dataDir = dirname(dbPath)
  }

  start(): void {
    this.interval = setInterval(() => this.snapshot(), 10_000)
    this.purgeInterval = setInterval(() => this.purge(), 300_000)
    this.snapshot()
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = undefined
    }
    if (this.purgeInterval) {
      clearInterval(this.purgeInterval)
      this.purgeInterval = undefined
    }
  }

  private snapshot(): void {
    const mem = process.memoryUsage()
    const cpu = process.cpuUsage(this.lastCpuUsage)
    const cpuElapsedMs = 10_000
    const cpuPercent = Math.min(
      ((cpu.user + cpu.system) / 1000 / cpuElapsedMs) * 100,
      100
    )

    const diskUsedMb = this.getDataDirSize()

    this.storage.insertResourceSnapshot({
      rssMb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
      heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
      heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
      externalMb: Math.round((mem.external / 1024 / 1024) * 100) / 100,
      cpuPercent: Math.round(cpuPercent * 100) / 100,
      diskUsedMb,
      recordedAt: new Date().toISOString()
    })

    this.lastCpuUsage = process.cpuUsage()
  }

  private getDataDirSize(): number {
    try {
      return Math.round((dirSize(this.dataDir) / 1024 / 1024) * 100) / 100
    } catch {
      return 0
    }
  }

  private purge(): void {
    const before = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString()
    this.storage.purgeOldResourceSnapshots(before)
  }
}

function dirSize(dir: string): number {
  let total = 0
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) {
        total += dirSize(p)
      } else if (entry.isFile()) {
        try { total += statSync(p).size } catch { /* skip */ }
      }
    }
  } catch { /* dir gone */ }
  return total
}
