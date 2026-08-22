// Regression tests for GET /api/settings/backup. Production failed with
// "This database connection is busy executing a query": the old stream held a
// live better-sqlite3 iterator across event-loop yields while ResourceMonitor's
// interval wrote to the shared connection, killing the download mid-stream and
// poisoning the connection until restart.
import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import BetterSqlite3 from "better-sqlite3"
import { Storage } from "@supacrawl/core"
import { settingsRoutes } from "./settings.js"
import type { RouteDeps } from "./index.js"

vi.mock("../auth-helpers.js", () => ({
  requireAuth: vi.fn(async () => ({ user: { id: "u1", role: "admin" } })),
  requireAdmin: vi.fn(async () => ({ user: { id: "u1", role: "admin" } }))
}))

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function makeDeps(): { deps: RouteDeps; storage: Storage } {
  const dir = mkdtempSync(join(tmpdir(), "supacrawl-settings-test-"))
  dirs.push(dir)
  // Mirror production: better-auth owns user/account/session and creates them
  // on the same DB file outside Storage's migrations.
  const authDb = new BetterSqlite3(join(dir, "test.db"))
  authDb.exec(
    "CREATE TABLE IF NOT EXISTS user (id TEXT PRIMARY KEY, role TEXT DEFAULT 'user'); CREATE TABLE IF NOT EXISTS account (id TEXT PRIMARY KEY);"
  )
  authDb.close()
  const storage = new Storage({ path: join(dir, "test.db") })
  const deps = {
    storage,
    notifier: {} as RouteDeps["notifier"],
    config: {
      crawl: {},
      checks: {},
      notifications: {},
      schedule: {}
    } as unknown as RouteDeps["config"],
    crawlManager: {} as RouteDeps["crawlManager"],
    monitorScheduler: {} as RouteDeps["monitorScheduler"],
    jobScheduler: {} as RouteDeps["jobScheduler"],
    resourceMonitor: {} as RouteDeps["resourceMonitor"],
    dbPath: join(dir, "test.db"),
    configPath: join(dir, "config.json")
  } as unknown as RouteDeps
  return { deps, storage }
}

async function drain(res: Response): Promise<string> {
  const reader = res.body!.getReader()
  const parts: Uint8Array[] = []
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    parts.push(value!)
  }
  const len = parts.reduce((n, p) => n + p.length, 0)
  const buf = new Uint8Array(len)
  let off = 0
  for (const p of parts) {
    buf.set(p, off)
    off += p.length
  }
  return new TextDecoder().decode(buf)
}

describe("GET /api/settings/backup", () => {
  it("streams a parseable full backup with attachment headers", async () => {
    const { deps, storage } = makeDeps()
    try {
      storage.setSetting("alpha", "1")
      storage.setSetting("beta", "2")
      const app = new Hono()
      settingsRoutes(app, deps)

      const res = await app.request("/api/settings/backup")
      expect(res.status).toBe(200)
      expect(res.headers.get("content-disposition")).toContain("attachment;")
      expect(res.headers.get("content-disposition")).toMatch(/supacrawl-backup-\d{4}-\d{2}-\d{2}\.json/)

      const parsed = JSON.parse(await drain(res))
      expect(parsed.version).toBe(1)
      expect(parsed.app).toBe("supacrawl")
      expect(parsed.tables.settings).toEqual([
        { key: "alpha", value: "1" },
        { key: "beta", value: "2" }
      ])
      for (const table of deps.storage.getBackupTableNames()) {
        expect(Array.isArray(parsed.tables[table])).toBe(true)
      }
    } finally {
      storage.close()
    }
  })

  it("survives interleaved writes on the shared connection during streaming", async () => {
    const { deps, storage } = makeDeps()
    try {
      for (let i = 0; i < 50; i++) storage.setSetting(`k${i}`, `${i}`)
      const app = new Hono()
      settingsRoutes(app, deps)

      const res = await app.request("/api/settings/backup")
      const reader = res.body!.getReader()

      // Mirrors prod: ResourceMonitor fires between consumer reads while the
      // backup is still streaming. Must not throw "connection is busy".
      const chunks: string[] = []
      for (let read = 0; ; read++) {
        if (read === 2) {
          expect(() =>
            storage.insertResourceSnapshot({
              rssMb: 1,
              heapTotalMb: 1,
              heapUsedMb: 1,
              externalMb: 1,
              cpuPercent: 1,
              diskUsedMb: 1,
              recordedAt: new Date().toISOString()
            })
          ).not.toThrow(/busy executing a query/)
        }
        const { value, done } = await reader.read()
        if (done) break
        chunks.push(new TextDecoder().decode(value!))
      }

      const parsed = JSON.parse(chunks.join(""))
      expect(parsed.tables.settings).toHaveLength(50)
      // Connection still healthy afterwards.
      expect(() => storage.setSetting("post", "ok")).not.toThrow(/busy/)
    } finally {
      storage.close()
    }
  })
})
