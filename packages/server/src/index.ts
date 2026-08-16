import { Hono } from "hono"
import { cors } from "hono/cors"
import { serveStatic } from "@hono/node-server/serve-static"
import { dirname, join, resolve } from "node:path"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createServer } from "node:http"
import type { IncomingMessage, Server as HttpServer } from "node:http"
import type { Duplex } from "node:stream"
import { WebSocketServer, WebSocket } from "ws"
import {
  Storage, loadConfigFromFile, Notifier, MonitorScheduler,
  type Config, type CrawlProgress, type Heartbeat,
} from "@supacrawl/core"
import { createAuth, type Auth } from "./auth.js"
import { CrawlManager } from "./crawl-manager.js"
import { JobScheduler } from "./job-scheduler.js"
import { ResourceMonitor } from "./resource-monitor.js"
import { crawlsRoutes } from "./routes/crawls.js"
import { crawlJobsRoutes } from "./routes/crawl-jobs.js"
import { resultsRoutes } from "./routes/results.js"
import { urlsRoutes } from "./routes/urls.js"
import { seoRoutes } from "./routes/seo.js"
import { statsRoutes } from "./routes/stats.js"
import { settingsRoutes } from "./routes/settings.js"
import { usersRoutes } from "./routes/users.js"
import { notifiersRoutes } from "./routes/notifiers.js"
import { authRoutes } from "./routes/auth.js"
import { userNotificationsRoutes } from "./routes/user-notifications.js"
import { monitorsRoutes } from "./routes/monitors.js"
import { resourcesRoutes } from "./routes/resources.js"
import { setupRoutes } from "./routes/setup.js"
import { statusPagesRoutes } from "./routes/status-pages.js"
import type { RouteDeps } from "./routes/index.js"

export { createAuth }
export type { AuthOptions } from "./auth.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export interface ServerOptions {
  configPath: string
  dbPath: string
  port: number
  host: string
  dashboardDist?: string
  authSecret?: string
  github?: { clientId: string; clientSecret: string }
}

export interface AppContext {
  app: Hono
  auth: Auth
  storage: Storage
  notifier: Notifier
  config: Config
  crawlManager: CrawlManager
  monitorScheduler: MonitorScheduler
  jobScheduler: JobScheduler
  resourceMonitor: ResourceMonitor
  server: HttpServer
}

export async function buildApp(opts: ServerOptions): Promise<AppContext> {
  const config = loadConfigFromFile(opts.configPath)
  const storage = new Storage({ path: opts.dbPath })
  storage.cleanupStaleCrawls()
  const notifier = new Notifier(config.notifications)

  const auth = createAuth({
    databasePath: opts.dbPath,
    secret: opts.authSecret,
    github: opts.github,
    baseUrl: process.env.BETTER_AUTH_URL ?? `http://localhost:${opts.port}`,
    trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS
      ?.split(",").map(s => s.trim()),
  })

  const app = new Hono()

  app.use("*", cors({
    origin: process.env.CORS_ORIGIN ?? "*",
    credentials: true,
  }))

  // WebSocket server
  const wsClients = new Set<WebSocket>()
  const wss = new WebSocketServer({ noServer: true })
  wss.on("connection", (ws) => {
    wsClients.add(ws)
    ws.on("close", () => wsClients.delete(ws))
  })

  const broadcast = (data: Record<string, unknown>) => {
    const msg = JSON.stringify(data)
    for (const client of wsClients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg)
    }
  }

  const crawlManager = new CrawlManager(config, storage, notifier, (progress: CrawlProgress) => {
    broadcast({ type: "progress", ...progress })
  })

  const monitorScheduler = new MonitorScheduler({
    storage,
    notifier,
    onHeartbeat: (heartbeat: Heartbeat) => {
      broadcast({ type: "heartbeat", ...heartbeat })
    },
  })

  const jobScheduler = new JobScheduler({ storage, crawlManager })
  const resourceMonitor = new ResourceMonitor(storage, opts.dbPath)

  // Auth bridge — Hono natively uses Web Request/Response, no conversion
  app.all("/api/auth/*", (c) => auth.handler(c.req.raw))

  const deps: RouteDeps = {
    auth, storage, notifier, config, crawlManager, monitorScheduler,
    jobScheduler, resourceMonitor,
    dbPath: opts.dbPath, configPath: opts.configPath,
    wsServer: { clients: wsClients as unknown as Set<{ readyState: number; send: (data: string) => void }> },
  }

  crawlsRoutes(app, deps)
  crawlJobsRoutes(app, deps)
  resultsRoutes(app, deps)
  urlsRoutes(app, deps)
  seoRoutes(app, deps)
  statsRoutes(app, deps)
  settingsRoutes(app, deps)
  usersRoutes(app, deps)
  notifiersRoutes(app, deps)
  authRoutes(app, deps)
  userNotificationsRoutes(app, deps)
  monitorsRoutes(app, deps)
  resourcesRoutes(app, deps)
  setupRoutes(app, deps)
  statusPagesRoutes(app, deps)

  monitorScheduler.startAll()
  jobScheduler.start()
  resourceMonitor.start()

  // Static + SPA fallback
  const dashboardRoot = opts.dashboardDist ?? resolve(__dirname, "../../dashboard/dist")
  if (dashboardRoot && existsSync(dashboardRoot)) {
    const appUrl = (process.env.BETTER_AUTH_URL ?? `http://localhost:${opts.port}`).replace(/\/$/, "")
    const renderIndex = () => {
      const indexPath = join(dashboardRoot, "index.html")
      if (!existsSync(indexPath)) return null
      return readFileSync(indexPath, "utf-8").replaceAll("__APP_URL__", appUrl)
    }
    app.use("/*", async (c, next) => {
      const path = c.req.path
      if (path === "/" || path === "/index.html") {
        c.header("Cache-Control", "no-cache")
      } else if (/\.(?:js|css|woff2?|png|jpe?g|gif|webp|svg|ico)$/.test(path)) {
        c.header("Cache-Control", "public, max-age=31536000, immutable")
      }
      await next()
    })
    app.on(["GET"], ["/", "/index.html"], (c) => {
      const html = renderIndex()
      if (html === null) return c.notFound()
      return c.html(html)
    })
    app.use("/*", serveStatic({ root: dashboardRoot }))
    app.notFound((c) => {
      if (c.req.path.startsWith("/api/")) return c.json({ error: "Not found" }, 404)
      const html = renderIndex()
      if (html === null) return c.text("Dashboard not built")
      return c.html(html)
    })
  } else {
    app.notFound((c) => {
      if (c.req.path.startsWith("/api/")) return c.json({ error: "Not found" }, 404)
      return c.text("Dashboard not built. Run `pnpm --filter @supacrawl/dashboard build`.")
    })
  }

  app.get("/api/health", (c) => c.json({ ok: true, timestamp: new Date().toISOString() }))

  // Create Node HTTP server
  // Hono returns spec-compliant Response — convert to Node ServerResponse
  const server = createServer((req, res) => {
    const handler = async () => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`)
      const r = new Request(url, {
        method: req.method ?? "GET",
        headers: Object.entries(req.headers).reduce((h, [k, v]) => {
          if (v !== undefined && v !== null) {
            h.set(k, Array.isArray(v) ? v.join(", ") : String(v))
          }
          return h
        }, new Headers()),
        ...((req.method !== "GET" && req.method !== "HEAD") ? { body: req, duplex: "half" as const } : {}),
      })

      const resp = await app.fetch(r)
      const headers: Record<string, string | string[]> = {}
      resp.headers.forEach((v, k) => {
        if (k.toLowerCase() === "set-cookie") {
          if (!headers[k]) headers[k] = []
          ;(headers[k] as string[]).push(v)
        } else {
          headers[k] = v
        }
      })

      res.writeHead(resp.status, headers)
      if (resp.body) {
        const buf = Buffer.from(await resp.arrayBuffer())
        res.end(buf)
      } else {
        res.end()
      }
    }
    handler().catch((err) => {
      console.error("Server error:", err)
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: "Internal server error" }))
      }
    })
  })

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`)
    if (url.pathname.startsWith("/api/ws/")) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req)
      })
    } else {
      socket.destroy()
    }
  })

  return { app, auth, storage, notifier, config, crawlManager, monitorScheduler, jobScheduler, resourceMonitor, server }
}

export async function startServer(opts: ServerOptions): Promise<void> {
  const dashboardDist = opts.dashboardDist ?? resolve(__dirname, "../../dashboard/dist")
  const ctx = await buildApp({ ...opts, dashboardDist })

  await new Promise<void>((resolve) => {
    ctx.server.listen(opts.port, opts.host, () => {
      console.log(`supacrawl server ready at http://${opts.host}:${opts.port}`)
      resolve()
    })
  })

  const shutdown = () => {
    console.log("Shutting down...")
    ctx.monitorScheduler.stopAll()
    ctx.jobScheduler.stop()
    ctx.resourceMonitor.stop()
    ctx.server.close()
    ctx.storage.close()
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

// CLI entry
if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args: Record<string, string> = {}
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a.startsWith("--")) {
      const key = a.slice(2)
      const val = argv[i + 1]
      if (val && !val.startsWith("--")) { args[key] = val; i++ }
      else { args[key] = "true" }
    }
  }

  await startServer({
    configPath: resolve(args.config ?? "./supacrawl.config.json"),
    dbPath: resolve(args.db ?? "./data/supacrawl.db"),
    port: Number(args.port ?? process.env.PORT ?? "3456"),
    host: args.host ?? process.env.HOST ?? "0.0.0.0",
    authSecret: process.env.BETTER_AUTH_SECRET,
    github: process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET }
      : undefined,
  })
}
