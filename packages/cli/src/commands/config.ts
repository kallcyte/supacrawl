import { resolve } from "node:path"
import { existsSync, writeFileSync, readFileSync } from "node:fs"
import chalk from "chalk"
import { loadConfigFromFile, ConfigSchema } from "@supacrawl/core"

interface ConfigOpts {
  config: string
  key?: string
  value?: string
}

const STARTER_CONFIG = {
  sitemaps: ["https://example.com/sitemap.xml"],
  crawl: {
    delayMs: 2000,
    maxConcurrency: 2,
    timeoutMs: 30000,
    userAgent: "supacrawl/0.1 (+https://github.com/yourname/supacrawl)",
    respectRobotsTxt: true,
    maxUrls: 10000,
    retryOnTransientError: true,
    maxRetries: 2
  },
  checks: {
    ssl: { enabled: true, warnDays: 30 },
    contentDiff: true,
    responseTime: { warnMs: 3000 }
  },
  notifications: {
    providers: {
      slack: { enabled: false, webhookUrl: "" },
      telegram: { enabled: false, botToken: "", chatId: "" },
      email: { enabled: false, smtp: {}, from: "", to: [] },
      webhook: { enabled: false, url: "", secret: "" }
    },
    events: {
      onCrawlFailure: true,
      onContentChange: true,
      onSslExpiring: true,
      onCrawlComplete: false
    }
  },
  schedule: "0 */6 * * *"
}

export async function configCommand(
  action: "show" | "get" | "set" | "init",
  opts: ConfigOpts
): Promise<void> {
  const configPath = resolve(opts.config)
  switch (action) {
    case "init": {
      if (existsSync(configPath)) {
        console.error(chalk.yellow(`Already exists: ${configPath}`))
        process.exit(1)
      }
      writeFileSync(configPath, JSON.stringify(STARTER_CONFIG, null, 2))
      console.log(chalk.green(`Wrote ${configPath}`))
      return
    }
    case "show": {
      if (!existsSync(configPath)) {
        console.error(chalk.red(`Not found: ${configPath}`))
        process.exit(1)
      }
      console.log(readFileSync(configPath, "utf-8"))
      return
    }
    case "get":
    case "set": {
      if (!existsSync(configPath)) {
        console.error(chalk.red(`Not found: ${configPath}`))
        process.exit(1)
      }
      const raw = JSON.parse(readFileSync(configPath, "utf-8"))
      const key = opts.key
      if (!key) {
        console.error(chalk.red("Missing key"))
        process.exit(1)
      }
      if (action === "get") {
        const value = key.split(".").reduce<unknown>((o: unknown, k: string) => {
          if (o && typeof o === "object") {
            return (o as Record<string, unknown>)[k]
          }
          return undefined
        }, raw)
        console.log(JSON.stringify(value, null, 2))
        return
      }
      if (opts.value === undefined) {
        console.error(chalk.red("Missing value"))
        process.exit(1)
      }
      setNested(raw, key.split("."), parseValue(opts.value))
      ConfigSchema.parse(raw)
      writeFileSync(configPath, JSON.stringify(raw, null, 2))
      console.log(chalk.green(`Set ${key} = ${opts.value}`))
      return
    }
  }
}

function setNested(obj: Record<string, unknown>, path: string[], value: unknown): void {
  if (path.length === 0) return
  const [head, ...rest] = path
  if (!head) return
  if (rest.length === 0) {
    obj[head] = value
    return
  }
  if (typeof obj[head] !== "object" || obj[head] === null) {
    obj[head] = {}
  }
  setNested(obj[head] as Record<string, unknown>, rest, value)
}

function parseValue(v: string): unknown {
  try {
    return JSON.parse(v)
  } catch {
    return v
  }
}

void loadConfigFromFile
