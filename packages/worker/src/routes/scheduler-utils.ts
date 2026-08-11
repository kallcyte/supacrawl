import type { Hono } from "hono"
import type { CrawlJob } from "@supacrawl/core"

/**
 * nextRunAtMs — ported from server's job-scheduler.ts.
 * Used by the crawl-jobs route to display next scheduled run time.
 */
export function toIntervalMs(value: number, unit: CrawlJob["intervalUnit"]): number {
  const perUnit = unit === "minutes" ? 60_000 : unit === "hours" ? 3_600_000 : 86_400_000
  return Math.max(value, 1) * perUnit
}

export function nextRunAtMs(job: CrawlJob, now = Date.now()): number | null {
  if (!job.enabled) return null
  if (!job.lastRunAt) return null
  const lastMs = Date.parse(job.lastRunAt)
  const earliest = lastMs + toIntervalMs(job.intervalValue, job.intervalUnit)
  if (!job.runAt) return earliest
  return nextOccurrenceOfTime(job.runAt, earliest)
}

function nextOccurrenceOfTime(hhmm: string, afterMs: number): number {
  const [hours, minutes] = hhmm.split(":").map(Number)
  const d = new Date(afterMs)
  const candidate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hours, minutes, 0, 0).getTime()
  return candidate >= afterMs ? candidate : candidate + 86_400_000
}