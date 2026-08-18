import { connect } from "node:net"
import type { HeartbeatResult, MonitorRecord } from "./types.js"

export interface MonitorCheckOptions {
  fetchImpl?: typeof fetch
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseTcpTarget(url: string): { host: string; port: number } {
  const trimmed = url.trim()
  const withoutScheme = trimmed.replace(/^tcp:\/\//i, "")
  const [host, portRaw] = withoutScheme.split(":")
  if (!host || !portRaw) throw new Error(`Invalid TCP target "${url}" (expected host:port)`)
  const port = Number(portRaw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid TCP port "${portRaw}"`)
  }
  return { host, port }
}

async function probeTcp(m: MonitorRecord): Promise<HeartbeatResult> {
  const checkedAt = new Date().toISOString()
  const start = performance.now()
  try {
    const { host, port } = parseTcpTarget(m.url)
    await new Promise<void>((resolve, reject) => {
      const socket = connect({ host, port })
      const onTimeout = () => {
        socket.destroy()
        reject(new Error(`Connection timed out after ${m.timeoutMs}ms`))
      }
      const timer = setTimeout(onTimeout, m.timeoutMs)
      socket.setTimeout(m.timeoutMs, onTimeout)
      socket.once("connect", () => {
        clearTimeout(timer)
        // Do not keep the socket open; close it as soon as we're done.
        socket.destroy()
        resolve()
      })
      socket.once("error", (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
    const responseTimeMs = Math.round(performance.now() - start)
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
  const probe = m.type === "tcp" ? probeTcp : (mm: MonitorRecord) => probeHttp(mm, fetchImpl)
  let lastDown: HeartbeatResult | null = null
  const attempts = Math.max(1, m.retryCount)
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(m.timeoutMs)
    const result = await probe(m)
    if (result.status === "up") return result
    lastDown = result
  }
  return lastDown!
}
