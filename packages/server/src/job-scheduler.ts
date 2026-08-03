import type { CrawlJob, Storage } from "@supacrawl/core"
import type { CrawlManager } from "./crawl-manager.js"

export interface JobSchedulerOptions {
  storage: Storage
  crawlManager: CrawlManager
  tickMs?: number
  staggerMs?: number
}

/**
 * Runs enabled crawl jobs on their configured interval (intervalValue +
 * intervalUnit). A poll loop checks every `tickMs` and starts any job whose
 * next run time has passed, skipping jobs that are still running. Scheduled
 * starts are staggered by `staggerMs` so many due jobs don't all fire at once.
 */
export class JobScheduler {
  private timer: NodeJS.Timeout | null = null
  private readonly tickMs: number
  private readonly staggerMs: number

  constructor(private opts: JobSchedulerOptions) {
    this.tickMs = opts.tickMs ?? 30_000
    this.staggerMs = opts.staggerMs ?? 2_000
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.tick()
    }, this.tickMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async tick(): Promise<void> {
    const now = Date.now()
    for (const job of this.opts.storage.listCrawlJobs()) {
      if (!job.enabled) continue
      if (this.opts.crawlManager.isJobRunning(job.id)) continue
      const next = nextRunAtMs(job, now)
      if (next === null || now < next) continue
      try {
        await this.opts.crawlManager.startCrawl({ job })
      } catch (err) {
        console.error(`[job-scheduler] failed to start job "${job.name}":`, err)
      }
      if (this.staggerMs > 0) await sleep(this.staggerMs)
    }
  }
}

export function toIntervalMs(value: number, unit: CrawlJob["intervalUnit"]): number {
  const perUnit = unit === "minutes" ? 60_000 : unit === "hours" ? 3_600_000 : 86_400_000
  return Math.max(value, 1) * perUnit
}

/**
 * Next scheduled run timestamp (ms) for a job, or null when disabled or when
 * the job has never been run manually. A job only starts auto-crawling after
 * it has been run once (lastRunAt set), so a fresh job never fires on its own.
 *
 * When `runAt` (a "HH:mm" clock time) is set, the run is anchored to that
 * time of day: the next run is the first occurrence of that clock time that is
 * at least one interval after the last run. Otherwise the run happens exactly
 * one interval after the last run.
 */
export function nextRunAtMs(job: CrawlJob, now = Date.now()): number | null {
  if (!job.enabled) return null
  if (!job.lastRunAt) return null
  const lastMs = Date.parse(job.lastRunAt)
  const earliest = lastMs + toIntervalMs(job.intervalValue, job.intervalUnit)
  if (!job.runAt) return earliest
  return nextOccurrenceOfTime(job.runAt, earliest)
}

/** Timestamp (ms) of the next occurrence of a "HH:mm" clock time at/after `afterMs`, in local time. */
export function nextOccurrenceOfTime(hhmm: string, afterMs: number): number {
  const [hours, minutes] = hhmm.split(":").map(Number)
  const d = new Date(afterMs)
  const candidate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hours, minutes, 0, 0).getTime()
  return candidate >= afterMs ? candidate : candidate + 86_400_000
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
