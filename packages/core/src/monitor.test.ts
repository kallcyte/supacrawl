import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest"
import { checkMonitor } from "./monitor.js"
import type { MonitorRecord } from "./types.js"

// ---------------------------------------------------------------------------
// node:net mock — fake socket whose outcome is controlled per-test
// ---------------------------------------------------------------------------

type NetBehavior =
  | { mode: "connect" }
  | { mode: "error"; message: string }
  | { mode: "hang" }

interface FakeSocket {
  once(event: string, cb: (...args: unknown[]) => void): FakeSocket
  setTimeout(ms: number, cb?: () => void): FakeSocket
  destroy: Mock
  __emit(event: string, ...args: unknown[]): void
}

const netState = vi.hoisted(() => ({
  behavior: { mode: "connect" } as NetBehavior,
  connections: [] as Array<{ opts: { host: string; port: number }; socket: FakeSocket }>
}))

vi.mock("node:net", () => {
  function makeFakeSocket(): FakeSocket {
    const handlers: Record<string, Array<(...args: unknown[]) => void>> = {}
    const socket: FakeSocket = {
      once(event: string, cb: (...args: unknown[]) => void) {
        ;(handlers[event] ??= []).push(cb)
        return socket
      },
      setTimeout(ms: number, cb?: () => void) {
        if (cb) socket.once("timeout", cb)
        return socket
      },
      destroy: vi.fn(),
      __emit(event: string, ...args: unknown[]) {
        for (const cb of [...(handlers[event] ?? [])]) cb(...args)
      }
    }
    return socket
  }

  return {
    connect: vi.fn((opts: { host: string; port: number }) => {
      const socket = makeFakeSocket()
      netState.connections.push({ opts, socket })
      const b = netState.behavior
      if (b.mode === "connect") {
        queueMicrotask(() => socket.__emit("connect"))
      } else if (b.mode === "error") {
        queueMicrotask(() => socket.__emit("error", new Error(b.message)))
      }
      // mode "hang": emit nothing; the module's own setTimeout must fire
      return socket
    })
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMonitor(overrides: Partial<MonitorRecord> = {}): MonitorRecord {
  return {
    id: "mon-1",
    name: "Test monitor",
    type: "http",
    url: "https://example.com/health",
    group: "",
    method: "GET",
    expectedStatus: 200,
    expectedBody: null,
    intervalSeconds: 60,
    retryCount: 0,
    timeoutMs: 10000,
    acceptedResponseTimeMs: 5000,
    enabled: true,
    source: "manual",
    jobId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  }
}

function jsonResponse(status: number, body = ""): Response {
  return new Response(body, { status })
}

beforeEach(() => {
  netState.behavior = { mode: "connect" }
  netState.connections.length = 0
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// TCP monitors (node:net)
// ---------------------------------------------------------------------------

describe("checkMonitor — tcp", () => {
  it("reports up with non-negative latency when the TCP handshake succeeds", async () => {
    const result = await checkMonitor(makeMonitor({ type: "tcp", url: "tcp://example.com:5432" }))

    expect(result.monitorId).toBe("mon-1")
    expect(result.status).toBe("up")
    expect(result.message).toBeNull()
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(result.responseTimeMs)).toBe(true)
    expect(new Date(result.checkedAt).getTime()).not.toBeNaN()

    const conn = netState.connections[0]! // probe always records one connection before asserting
    expect(conn.opts).toEqual({ host: "example.com", port: 5432 })
    expect(conn.socket.destroy).toHaveBeenCalled()
  })

  it("accepts targets without an explicit tcp:// scheme", async () => {
    const result = await checkMonitor(makeMonitor({ type: "tcp", url: "db.internal:6379" }))

    expect(result.status).toBe("up")
    expect(netState.connections[0]!.opts).toEqual({ host: "db.internal", port: 6379 })
  })

  it("reports down and captures the socket error message on connection failure", async () => {
    netState.behavior = { mode: "error", message: "connect ECONNREFUSED 127.0.0.1:5432" }

    const result = await checkMonitor(makeMonitor({ type: "tcp", url: "tcp://127.0.0.1:5432" }))

    expect(result.status).toBe("down")
    expect(result.message).toBe("connect ECONNREFUSED 127.0.0.1:5432")
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0)
  })

  it("times out and destroys the socket when nothing connects", async () => {
    vi.useFakeTimers()
    netState.behavior = { mode: "hang" }

    const pending = checkMonitor(
      makeMonitor({ type: "tcp", url: "tcp://blackhole.example.com:9000", timeoutMs: 1500 })
    )
    await vi.advanceTimersByTimeAsync(1500)
    const result = await pending

    expect(result.status).toBe("down")
    expect(result.message).toBe("Connection timed out after 1500ms")
    expect(netState.connections[0]!.socket.destroy).toHaveBeenCalled()
  })

  it("reports down for a target missing its port instead of throwing", async () => {
    const result = await checkMonitor(makeMonitor({ type: "tcp", url: "tcp://noport.example.com" }))

    expect(result.status).toBe("down")
    expect(result.message).toContain('Invalid TCP target')
    expect(netState.connections).toHaveLength(0)
  })

  it("rejects out-of-range ports", async () => {
    const result = await checkMonitor(makeMonitor({ type: "tcp", url: "tcp://example.com:99999" }))

    expect(result.status).toBe("down")
    expect(result.message).toContain('Invalid TCP port "99999"')
    expect(netState.connections).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// HTTP monitors (injectable fetchImpl)
// ---------------------------------------------------------------------------

describe("checkMonitor — http", () => {
  it("reports up when the response matches expectedStatus", async () => {
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
      expect(input).toBe("https://api.example.com/health")
      return jsonResponse(200, "ok")
    })

    const result = await checkMonitor(
      makeMonitor({ url: "https://api.example.com/health", method: "GET" }),
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    )

    expect(result.status).toBe("up")
    expect(result.message).toBeNull()
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [input, init] = fetchImpl.mock.calls[0]!
    expect(input).toBe("https://api.example.com/health")
    expect(init?.method).toBe("GET")
    expect(init?.redirect).toBe("follow")
  })

  it("sends the configured HTTP method", async () => {
    const fetchImpl = vi.fn(async (_input: string, init?: RequestInit): Promise<Response> =>
      new Response(null, { status: 201 }))

    const result = await checkMonitor(
      makeMonitor({ method: "POST", expectedStatus: 201 }),
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    )

    expect(result.status).toBe("up")
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe("POST")
  })

  it("reports down when the status differs from expectedStatus", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => jsonResponse(500))

    const result = await checkMonitor(makeMonitor(), {
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(result.status).toBe("down")
    expect(result.message).toBe("HTTP 500 (expected 200)")
  })

  it("verifies expectedBody keyword presence when configured", async () => {
    const goodFetch = vi.fn(async (): Promise<Response> => jsonResponse(200, "status: healthy"))
    const badFetch = vi.fn(async (): Promise<Response> => jsonResponse(200, "status: dead"))

    const upResult = await checkMonitor(
      makeMonitor({ expectedStatus: 200, expectedBody: "healthy" }),
      { fetchImpl: goodFetch as unknown as typeof fetch }
    )
    const downResult = await checkMonitor(
      makeMonitor({ expectedStatus: 200, expectedBody: "healthy" }),
      { fetchImpl: badFetch as unknown as typeof fetch }
    )

    expect(upResult.status).toBe("up")
    expect(downResult.status).toBe("down")
    expect(downResult.message).toBe("Expected body keyword not found")
  })

  it("skips body inspection when expectedBody is unset", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => jsonResponse(200))

    const result = await checkMonitor(makeMonitor({ expectedBody: null }), {
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(result.status).toBe("up")
  })
  it("retries a failed HTTP check within the same tick and reports up", async () => {
    vi.useFakeTimers()
    let calls = 0
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      calls++
      return calls === 1 ? jsonResponse(503) : jsonResponse(200)
    })

    const pending = checkMonitor(
      makeMonitor({ retryCount: 2, timeoutMs: 5 }),
      { fetchImpl: fetchImpl as unknown as typeof fetch } // fetch signature spans DOM lib types; unchecked cast needed
    )
    await vi.runAllTimersAsync()
    const result = await pending

    expect(result.status).toBe("up")
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("stops retrying early once a probe comes back up (one heartbeat per tick)", async () => {
    vi.useFakeTimers()
    let call = 0
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      call++
      return call < 3 ? jsonResponse(500) : jsonResponse(200)
    })

    const pending = checkMonitor(
      makeMonitor({ retryCount: 3, timeoutMs: 5 }),
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    )
    await vi.runAllTimersAsync()
    const result = await pending

    expect(result.status).toBe("up")
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it("reports the last failure after exhausting all attempts", async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(async (): Promise<Response> => jsonResponse(503))

    const pending = checkMonitor(
      makeMonitor({ retryCount: 3, timeoutMs: 5 }),
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    )
    await vi.runAllTimersAsync()
    const result = await pending

    expect(result.status).toBe("down")
    expect(result.message).toBe("HTTP 503 (expected 200)")
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
  it("reports down with the error message when fetch rejects", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      throw new TypeError("fetch failed")
    })

    const result = await checkMonitor(makeMonitor(), {
      fetchImpl: fetchImpl as unknown as typeof fetch // fetch signature spans DOM lib types; unchecked cast needed
    })

    expect(result.status).toBe("down")
    expect(result.message).toBe("fetch failed")
  })

  it("always performs at least one attempt even with retryCount 0", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => jsonResponse(200))

    const result = await checkMonitor(makeMonitor({ retryCount: 0 }), {
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(result.status).toBe("up")
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
