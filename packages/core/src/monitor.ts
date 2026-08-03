import type { HeartbeatResult, MonitorRecord } from "./types.js"

export interface MonitorCheckOptions {
  fetchImpl?: typeof fetch
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function probeHttp(m: MonitorRecord, fetchImpl: typeof fetch): Promise<HeartbeatResult> {
  const checkedAt = new Date().toISOString()
  const start = performance.now()
  try {
    const res = await fetchImpl(m.url, {
      method: m.method,
      redirect: "follow",
      headers: { "User-Agent": "supacrawl-monitor/0.1" },
      signal: AbortSignal.timeout(m.timeoutMs)
    })
    const responseTimeMs = Math.round(performance.now() - start)
    if (res.status !== m.expectedStatus) {
      return {
        monitorId: m.id,
        status: "down",
        responseTimeMs,
        message: `HTTP ${res.status} (expected ${m.expectedStatus})`,
        checkedAt
      }
    }
    if (m.expectedBody) {
      const text = await res.text()
      if (!text.includes(m.expectedBody)) {
        return {
          monitorId: m.id,
          status: "down",
          responseTimeMs,
          message: "Expected body keyword not found",
          checkedAt
        }
      }
    }
    return {
      monitorId: m.id,
      status: "up",
      responseTimeMs,
      message: null,
      checkedAt
    }
  } catch (err) {
    return {
      monitorId: m.id,
      status: "down",
      responseTimeMs: Math.round(performance.now() - start),
      message: (err as Error).message ?? "Check failed",
      checkedAt
    }
  }
}

/**
 * Check a single monitor. For HTTP monitors the probe is retried up to
 * `retryCount` times within a single tick before reporting "down", so each
 * tick produces exactly one heartbeat.
 */
export async function checkMonitor(
  m: MonitorRecord,
  opts: MonitorCheckOptions = {}
): Promise<HeartbeatResult> {
  const fetchImpl = opts.fetchImpl ?? fetch
  let lastDown: HeartbeatResult | null = null
  const attempts = Math.max(1, m.retryCount)
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(m.timeoutMs)
    const result = await probeHttp(m, fetchImpl)
    if (result.status === "up") return result
    lastDown = result
  }
  return lastDown!
}
