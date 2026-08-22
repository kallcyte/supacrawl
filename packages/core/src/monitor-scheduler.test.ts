import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"

// Replace the real network-touching checkMonitor with a controllable mock.
vi.mock("./monitor.js", () => ({ checkMonitor: vi.fn() }))

import { checkMonitor } from "./monitor.js"
import { MonitorScheduler } from "./monitor-scheduler.js"
import { Storage } from "./storage.js"
import type { Notifier } from "./notifier/index.js"
import type { Heartbeat, HeartbeatResult, MonitorRecord } from "./types.js"

const checkMock = vi.mocked(checkMonitor)

function makeMonitor(overrides: Partial<MonitorRecord> = {}): MonitorRecord {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    name: "Example",
    type: "http",
    url: "https://example.com",
    group: "",
    method: "GET",
    expectedStatus: 200,
    expectedBody: null,
    intervalSeconds: 60,
    retryCount: 3,
    timeoutMs: 10000,
    acceptedResponseTimeMs: 5000,
    enabled: true,
    source: "manual",
    jobId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

function upResult(monitorId: string, responseTimeMs: number | null = 42): HeartbeatResult {
  return {
    monitorId,
    status: "up",
    responseTimeMs,
    message: null,
    checkedAt: new Date().toISOString()
  }
}

function downResult(monitorId: string, message = "connection refused"): HeartbeatResult {
  return {
    monitorId,
    status: "down",
    responseTimeMs: null,
    message,
    checkedAt: new Date().toISOString()
  }
}

describe("MonitorScheduler", () => {
  let dir: string
  let storage: Storage
  let notify: Mock
  let scheduler: MonitorScheduler

  beforeEach(() => {
    vi.useFakeTimers()
    checkMock.mockReset()
    // Benign default: each check resolves "up"; individual tests override.
    checkMock.mockImplementation(async (m) => upResult(m.id))
    dir = mkdtempSync(join(tmpdir(), "supacrawl-test-"))
    storage = new Storage({ path: join(dir, "test.db") })
    notify = vi.fn().mockResolvedValue(undefined)
    scheduler = new MonitorScheduler({
      storage,
      notifier: { notify } as unknown as Notifier
    })
  })

  afterEach(() => {
    scheduler.stopAll()
    vi.useRealTimers()
    storage.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** Flush microtasks (the fire-and-forget initial tick) under fake timers. */
  async function flush(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0)
  }

  it("startMonitor registers an interval, reports isRunning, and checks immediately", async () => {
    const m = makeMonitor({ intervalSeconds: 60 })
    storage.createMonitor(m)

    scheduler.startMonitor(m.id)
    await flush()

    expect(scheduler.isRunning(m.id)).toBe(true)
    expect(checkMock).toHaveBeenCalledTimes(1)
    expect(checkMock).toHaveBeenCalledWith(m, { fetchImpl: undefined })
  })

  it("repeats checks on the configured interval", async () => {
    const m = makeMonitor({ intervalSeconds: 10 })
    storage.createMonitor(m)
    checkMock.mockResolvedValue(upResult(m.id))

    scheduler.startMonitor(m.id)
    await flush()
    expect(checkMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(checkMock).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(checkMock).toHaveBeenCalledTimes(3)
  })

  it("persists each check result as a heartbeat retrievable from storage", async () => {
    const m = makeMonitor()
    storage.createMonitor(m)
    const result = downResult(m.id, "HTTP 500")
    checkMock.mockResolvedValue(result)

    scheduler.startMonitor(m.id)
    await flush()

    const hb = storage.getLatestHeartbeat(m.id)
    expect(hb).not.toBeNull()
    expect(hb!.monitorId).toBe(m.id)
    expect(hb!.status).toBe("down")
    expect(hb!.message).toBe("HTTP 500")
    expect(hb!.responseTimeMs).toBeNull()
    expect(hb!.checkedAt).toBe(result.checkedAt)
  })

  it("dispatches onMonitorDown through the notifier when a check is down", async () => {
    const m = makeMonitor({ name: "API Gateway" })
    storage.createMonitor(m)
    checkMock.mockResolvedValue(downResult(m.id))

    scheduler.startMonitor(m.id)
    await flush()

    const call = notify.mock.calls[0]!
    const [event, payload] = call
    expect(event).toBe("onMonitorDown")
    expect(payload.title).toBe('Monitor "API Gateway" is DOWN')
    expect(payload.url).toBe(m.url)
    expect(payload.meta).toEqual({ monitorId: m.id, status: "down" })
  })

  it("labels repeated down results as still DOWN", async () => {
    const m = makeMonitor({ name: "Legacy API" })
    storage.createMonitor(m)
    // Seed history so the previous known state is already "down".
    storage.insertHeartbeat({
      id: randomUUID(),
      monitorId: m.id,
      status: "down",
      responseTimeMs: null,
      message: null,
      checkedAt: new Date(Date.now() - 60_000).toISOString()
    })
    checkMock.mockResolvedValue(downResult(m.id))

    await scheduler.tick(m.id)

    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0]![0]).toBe("onMonitorDown")
    expect(notify.mock.calls[0]![1].title).toBe('Monitor "Legacy API" is still DOWN')
  })

  it("dispatches onMonitorRecovery on a down-to-up transition and not when already up", async () => {
    const m = makeMonitor()
    storage.createMonitor(m)
    storage.insertHeartbeat({
      id: randomUUID(),
      monitorId: m.id,
      status: "down",
      responseTimeMs: null,
      message: null,
      checkedAt: new Date(Date.now() - 60_000).toISOString()
    })
    checkMock.mockResolvedValue(upResult(m.id))

    await scheduler.tick(m.id)

    const recoveryCall = notify.mock.calls[0]!
    const [event, payload] = recoveryCall
    expect(event).toBe("onMonitorRecovery")
    expect(payload.title).toContain("is UP again")

    // Next tick with previous status "up": no further notification.
    notify.mockClear()
    await scheduler.tick(m.id)
    expect(notify).not.toHaveBeenCalled()
  })

  it("suppresses notifications while a maintenance window is active", async () => {
    const m = makeMonitor()
    storage.createMonitor(m)
    const now = new Date()
    storage.createMaintenanceWindow({
      id: randomUUID(),
      monitorId: m.id,
      title: "Deploy freeze",
      description: null,
      startAt: new Date(now.getTime() - 60_000).toISOString(),
      endAt: new Date(now.getTime() + 60_000).toISOString(),
      createdAt: now.toISOString()
    })
    checkMock.mockResolvedValue(downResult(m.id))

    await scheduler.tick(m.id)

    // Heartbeat is still recorded, but no notification fires during maintenance.
    expect(storage.getLatestHeartbeat(m.id)?.status).toBe("down")
    expect(notify).not.toHaveBeenCalled()
  })

  it("fires a throttled onMonitorSlow alert when responses exceed the accepted time", async () => {
    const m = makeMonitor({ intervalSeconds: 10, acceptedResponseTimeMs: 1000 })
    storage.createMonitor(m)
    checkMock.mockResolvedValue(upResult(m.id, 2500))

    scheduler.startMonitor(m.id)
    await flush()
    expect(notify).toHaveBeenCalledTimes(1)
    const [event, payload] = notify.mock.calls[0]!
    expect(event).toBe("onMonitorSlow")
    expect(payload.meta).toMatchObject({ monitorId: m.id, status: "slow", responseTimeMs: 2500, thresholdMs: 1000 })

    // Still slow 10s later, but throttled to one alert per 30 minutes.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(notify).toHaveBeenCalledTimes(1)

    // Fast responses never trigger the slow path.
    const fast = makeMonitor({ acceptedResponseTimeMs: 1000 })
    storage.createMonitor(fast)
    checkMock.mockResolvedValue(upResult(fast.id, 50))
    await scheduler.tick(fast.id)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it("stopAll stops every running monitor", async () => {
    const a = makeMonitor({ intervalSeconds: 10 })
    const b = makeMonitor({ intervalSeconds: 10 })
    storage.createMonitor(a)
    storage.createMonitor(b)
    checkMock.mockResolvedValue(upResult(a.id))

    scheduler.startAll()
    expect(scheduler.isRunning(a.id)).toBe(true)
    expect(scheduler.isRunning(b.id)).toBe(true)

    // startAll checks each monitor once, synchronously.
    expect(checkMock).toHaveBeenCalledTimes(2)

    scheduler.stopAll()
    expect(scheduler.isRunning(a.id)).toBe(false)
    expect(scheduler.isRunning(b.id)).toBe(false)

    const afterStop = checkMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(120_000)
    expect(checkMock.mock.calls.length).toBe(afterStop)
  })

  it("startAll starts only enabled monitors", async () => {
    const on1 = makeMonitor()
    const on2 = makeMonitor()
    const off = makeMonitor({ enabled: false })
    storage.createMonitor(on1)
    storage.createMonitor(on2)
    storage.createMonitor(off)

    scheduler.startAll()
    await flush()

    expect(scheduler.isRunning(on1.id)).toBe(true)
    expect(scheduler.isRunning(on2.id)).toBe(true)
    expect(scheduler.isRunning(off.id)).toBe(false)
    const checkedIds = checkMock.mock.calls.map(([m]) => m.id)
    expect(checkedIds).toEqual(expect.arrayContaining([on1.id, on2.id]))
    expect(checkedIds).not.toContain(off.id)
  })

  it("respects each monitor's own intervalSeconds independently", async () => {
    const fast = makeMonitor({ intervalSeconds: 10 })
    const slow = makeMonitor({ intervalSeconds: 60 })
    storage.createMonitor(fast)
    storage.createMonitor(slow)
    checkMock.mockResolvedValue(upResult(fast.id))

    scheduler.startAll()
    await flush()
    expect(checkMock).toHaveBeenCalledTimes(2)

    // One minute later: fast fired every 10s (initial + 6 ticks),
    // slow fired only its initial tick plus the 60s boundary tick.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(checkMock.mock.calls.filter(([m]) => m.id === fast.id)).toHaveLength(7)
    expect(checkMock.mock.calls.filter(([m]) => m.id === slow.id)).toHaveLength(2)
  })

  it("supports adding a monitor while the scheduler is already running", async () => {
    const first = makeMonitor({ intervalSeconds: 60 })
    storage.createMonitor(first)
    checkMock.mockResolvedValue(upResult(first.id))
    scheduler.startMonitor(first.id)
    await flush()
    expect(checkMock).toHaveBeenCalledTimes(1)

    const second = makeMonitor({ intervalSeconds: 60 })
    storage.createMonitor(second)
    scheduler.startMonitor(second.id)
    await flush()

    expect(scheduler.isRunning(second.id)).toBe(true)
    expect(checkMock).toHaveBeenCalledWith(second, { fetchImpl: undefined })
    expect(checkMock).toHaveBeenCalledTimes(2)
  })

  it("removes a monitor from rotation at the next tick once it is disabled", async () => {
    const m = makeMonitor({ intervalSeconds: 10 })
    storage.createMonitor(m)
    checkMock.mockResolvedValue(upResult(m.id))

    scheduler.startMonitor(m.id)
    await flush()
    expect(checkMock).toHaveBeenCalledTimes(1)

    storage.updateMonitor(m.id, { enabled: false })
    await vi.advanceTimersByTimeAsync(10_000)

    // The tick observed the disabled monitor, stopped its timer, and skipped the check.
    expect(checkMock).toHaveBeenCalledTimes(1)
    expect(scheduler.isRunning(m.id)).toBe(false)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(checkMock).toHaveBeenCalledTimes(1)
  })

  it("ignores ticks for unknown monitors and does not start disabled ones", async () => {
    await scheduler.tick("no-such-monitor")
    expect(checkMock).not.toHaveBeenCalled()

    const off = makeMonitor({ enabled: false })
    storage.createMonitor(off)
    scheduler.startMonitor(off.id)
    await flush()
    expect(scheduler.isRunning(off.id)).toBe(false)
    expect(checkMock).not.toHaveBeenCalled()
  })

  it("does not run concurrent ticks for the same monitor", async () => {
    const m = makeMonitor()
    storage.createMonitor(m)
    let release!: (r: HeartbeatResult) => void
    checkMock.mockImplementation(
      () =>
        new Promise<HeartbeatResult>((resolve) => {
          release = resolve
        })
    )

    const t1 = scheduler.tick(m.id)
    const t2 = scheduler.tick(m.id)
    expect(checkMock).toHaveBeenCalledTimes(1)

    release(downResult(m.id))
    await Promise.all([t1, t2])

    // After the slow check finished, a fresh tick runs normally again.
    checkMock.mockImplementation(async (m) => upResult(m.id))
    await vi.advanceTimersByTimeAsync(1_000)
    await scheduler.tick(m.id)
    expect(checkMock).toHaveBeenCalledTimes(2)
    expect(storage.getLatestHeartbeat(m.id)?.status).toBe("up")
  })

  it("invokes the onHeartbeat callback with the persisted heartbeat", async () => {
    const m = makeMonitor()
    storage.createMonitor(m)
    const result = upResult(m.id, 123)
    checkMock.mockResolvedValue(result)
    const onHeartbeat = vi.fn()
    const watched = new MonitorScheduler({ storage, notifier: { notify } as unknown as Notifier, onHeartbeat })

    await watched.tick(m.id)

    expect(onHeartbeat).toHaveBeenCalledTimes(1)
    const hb = onHeartbeat.mock.calls[0]![0] as Heartbeat
    expect(hb.monitorId).toBe(m.id)
    expect(hb.status).toBe("up")
    expect(hb.responseTimeMs).toBe(123)
    watched.stopAll()
  })
})
