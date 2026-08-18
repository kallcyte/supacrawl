import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { ConfigSchema, type Config } from "./types.js"

export function loadConfigFromFile(path: string): Config {
  if (!existsSync(path)) {
    console.warn(`[config] ${path} not found — using defaults`)
    return parseConfig(JSON.stringify(defaultConfig()))
  }
  const raw = readFileSync(path, "utf-8")
  return parseConfig(raw)
}

export function parseConfig(raw: string): Config {
  const data = JSON.parse(raw)
  return ConfigSchema.parse(data)
}

export function writeConfigToFile(path: string, config: Config): void {
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8")
}

export function defaultConfig(): Partial<Config> {
  return {
    sitemaps: [{ url: "https://example.com/sitemap.xml", enabled: false }],
    crawl: {
      delayMs: 2000,
      maxConcurrency: 2,
      timeoutMs: 30000,
      userAgent: "supacrawl/0.1",
      respectRobotsTxt: true,
      maxUrls: 999999,
      retryOnTransientError: true,
      maxRetries: 2,
      detectMojibake: true,
      detectLlmGarbage: true,
      maxBodyBytes: 256 * 1024,
      maxGlobalConcurrency: 32
    },
    checks: {
      ssl: { enabled: true, warnDays: 30 },
      contentDiff: true,
      responseTime: { warnMs: 3000 }
    }
  }
}
