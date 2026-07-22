import { resolve } from "node:path"
import chalk from "chalk"
import { startServer } from "@supacrawl/server"

interface ServeOpts {
  config: string
  db: string
  port: string
  host: string
}

export async function serveCommand(opts: ServeOpts): Promise<void> {
  const port = Number(opts.port)
  if (!Number.isFinite(port) || port <= 0) {
    console.error(chalk.red("Invalid port"))
    process.exit(1)
  }
  console.log(chalk.blue(`[supacrawl] starting server on http://${opts.host}:${port}`))
  await startServer({
    configPath: resolve(opts.config),
    dbPath: resolve(opts.db),
    port,
    host: opts.host,
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
