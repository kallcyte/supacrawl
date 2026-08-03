import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify"
import cookie from "@fastify/cookie"
import cors from "@fastify/cors"
import websocket from "@fastify/websocket"
import fastifyStatic from "@fastify/static"
import { dirname, join, resolve } from "node:path"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Storage, loadConfigFromFile, Notifier, MonitorScheduler, type Config, type CrawlProgress, type Heartbeat } from "@supacrawl/core"
import { createAuth, type Auth } from "./auth.js"
import { registerRoutes } from "./routes/index.js"
import { CrawlManager } from "./crawl-manager.js"
import { JobScheduler } from "./job-scheduler.js"

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
  app: FastifyInstance
  auth: Auth
  storage: Storage
  notifier: Notifier
  config: Config
  crawlManager: CrawlManager
  monitorScheduler: MonitorScheduler
  jobScheduler: JobScheduler
}

export async function buildApp(opts: ServerOptions): Promise<AppContext> {
  const config = loadConfigFromFile(opts.configPath)
  const storage = new Storage({ path: opts.dbPath })
  // Mark any stale running crawls from a previous session as failed
  storage.cleanupStaleCrawls()
  const notifier = new Notifier(config.notifications)
  const trustedOrigins = process.env.BETTER_AUTH_TRUSTED_ORIGINS
    ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(",").map(s => s.trim())
    : undefined
  const auth = createAuth({
    databasePath: opts.dbPath,
    secret: opts.authSecret,
    github: opts.github,
    baseUrl: process.env.BETTER_AUTH_URL ?? `http://localhost:${opts.port}`,
    trustedOrigins
  })

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      ...(process.env.NODE_ENV === "production" || !process.stdout.isTTY
        ? {}
        : { transport: { target: "pino-pretty", options: { colorize: true } } })
    }
  })

  await app.register(cookie, { secret: opts.authSecret ?? "dev-secret" })
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? true,
    credentials: true
  })
  await app.register(websocket)

  // Mount better-auth handler
  app.all("/api/auth/*", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`)
      const headers = new Headers()
      for (const [k, v] of Object.entries(req.headers)) {
        if (v !== undefined) {
          if (Array.isArray(v)) headers.set(k, v.join(", "))
          else headers.set(k, String(v))
        }
      }
      const body =
        req.method && !["GET", "HEAD"].includes(req.method)
          ? JSON.stringify(req.body)
          : undefined
      const webRequest = new Request(url.toString(), {
        method: req.method,
        headers,
        body
      })
      const webResponse = await auth.handler(webRequest)
      reply.code(webResponse.status)
      // Forward all headers. Multiple Set-Cookie headers must be collected as an array
      // since reply.header() overwrites on each call.
      const setCookieHeaders: string[] = []
      webResponse.headers.forEach((value, key) => {
        if (key.toLowerCase() === "set-cookie") {
          setCookieHeaders.push(value)
        } else {
          reply.header(key, value)
        }
      })
      if (setCookieHeaders.length > 0) {
        reply.raw.setHeader("Set-Cookie", setCookieHeaders)
      }
      const text = await webResponse.text()
      return reply.send(text)
    } catch (err) {
      req.log.error({ err }, "Auth handler error")
      return reply.code(500).send({ error: "Authentication service error" })
    }
  })

  const crawlManager = new CrawlManager(config, storage, notifier, (progress: CrawlProgress) => {
    const wsServer = (app as unknown as { websocketServer?: { clients: Set<{ readyState: number; send: (data: string) => void }> } }).websocketServer
    if (!wsServer) return
    wsServer.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: "progress", ...progress }))
      }
    })
  })

  const monitorScheduler = new MonitorScheduler({
    storage,
    notifier,
    onHeartbeat: (heartbeat: Heartbeat) => {
      const wsServer = (app as unknown as { websocketServer?: { clients: Set<{ readyState: number; send: (data: string) => void }> } }).websocketServer
      if (!wsServer) return
      wsServer.clients.forEach((client) => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ type: "heartbeat", ...heartbeat }))
        }
      })
    }
  })

  const jobScheduler = new JobScheduler({ storage, crawlManager })

  await registerRoutes({ app, auth, storage, notifier, config, crawlManager, monitorScheduler, jobScheduler, dbPath: opts.dbPath, configPath: opts.configPath })

  monitorScheduler.startAll()
  jobScheduler.start()

  if (opts.dashboardDist && existsSync(opts.dashboardDist)) {
    await app.register(fastifyStatic, {
      root: opts.dashboardDist,
      prefix: "/"
    })
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "Not found" })
      }
      const indexPath = join(opts.dashboardDist!, "index.html")
      if (existsSync(indexPath)) {
        reply.type("text/html").send(readFileSync(indexPath))
      } else {
        reply.code(404).send("Dashboard not built")
      }
    })
  } else {
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "Not found" })
      }
      reply.code(404).send("Dashboard not built. Run `pnpm --filter @supacrawl/dashboard build`.")
    })
  }

  app.get("/api/health", async () => ({ ok: true, timestamp: new Date().toISOString() }))

  return { app, auth, storage, notifier, config, crawlManager, monitorScheduler, jobScheduler }
}

export async function startServer(opts: ServerOptions): Promise<void> {
  const dashboardDist = opts.dashboardDist ?? resolve(__dirname, "../../dashboard/dist")
  const ctx = await buildApp({ ...opts, dashboardDist })
  try {
    await ctx.app.listen({ port: opts.port, host: opts.host })
    ctx.app.log.info(`supacrawl server ready at http://${opts.host}:${opts.port}`)
  } catch (err) {
    ctx.app.log.error(err)
    process.exit(1)
  }

  const shutdown = async () => {
    ctx.app.log.info("Shutting down...")
    ctx.monitorScheduler.stopAll()
    ctx.jobScheduler.stop()
    await ctx.app.close()
    ctx.storage.close()
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

function parseArgs() {
  const args = process.argv.slice(2)
  const out: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a && a.startsWith("--")) {
      const key = a.slice(2)
      const val = args[i + 1]
      if (val && !val.startsWith("--")) {
        out[key] = val
        i++
      } else {
        out[key] = "true"
      }
    }
  }
  return out
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = parseArgs()
  const port = Number(args.port ?? process.env.PORT ?? "3456")
  const host = args.host ?? process.env.HOST ?? "0.0.0.0"
  await startServer({
    configPath: resolve(args.config ?? "./supacrawl.config.json"),
    dbPath: resolve(args.db ?? "./data/supacrawl.db"),
    port,
    host,
    authSecret: process.env.BETTER_AUTH_SECRET,
    github:
      process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
        ? {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET
          }
        : undefined
  })
}
