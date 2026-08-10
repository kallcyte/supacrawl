import { spawn, type ChildProcess } from "node:child_process"
import { createInterface } from "node:readline"
import type { CrawlJob, CrawlConfig, CheckResult, CrawlProgress } from "./types.js"

interface KnownHash {
  url: string
  hash: string
  has_seo: boolean
  last_checked_at: string | null
  sitemap_lastmod: string | null
  prev_seo?: unknown | null
}

interface RustCrawlRequest {
  type: "start_crawl"
  id: string
  config: CrawlConfig
  checks: {
    ssl: { enabled: boolean; warnDays: number }
    contentDiff: boolean
    responseTime: { warnMs: number }
  }
  sitemaps: string[]
  known_hashes: KnownHash[]
}

type RustMessage =
  | { type: "progress"; crawlId: string; checked: number; total: number }
  | { type: "result"; crawlId: string; result: CheckResult }
  | { type: "complete"; crawlId: string; record: { urlsChecked: number; urlsChanged: number; urlsBroken: number; urlsSkipped: number; urlsTotal: number; status: string; errorMessage?: string } }
  | { type: "error"; crawlId: string; error: string }
  | { type: "backpressure"; crawlId: string; queueDepth: number; paused: boolean }

export interface RustCrawlOptions {
  daemonBin: string
  config: {
    crawl: CrawlConfig
    checks: {
      ssl: { enabled: boolean; warnDays: number }
      contentDiff: boolean
      responseTime: { warnMs: number }
    }
  }
  sitemaps: string[]
  knownHashes: KnownHash[]
  dbPath: string
  abortSignal?: AbortSignal
  onProgress?: (p: CrawlProgress) => void
  onResult?: (r: CheckResult) => void
  onComplete?: (record: {
    crawlId: string
    urlsChecked: number
    urlsChanged: number
    urlsBroken: number
    urlsSkipped: number
    urlsTotal: number
    status: string
    errorMessage?: string
  }) => void
  onError?: (error: string) => void
}

export class RustCrawler {
  private process: ChildProcess | null = null
  private crawlId: string
  private options: RustCrawlOptions

  constructor(crawlId: string, opts: RustCrawlOptions) {
    this.crawlId = crawlId
    this.options = opts
  }

  async start(): Promise<{ crawlId: string; record: { urlsChecked: number; urlsChanged: number; urlsBroken: number; urlsSkipped: number; urlsTotal: number; status: string; errorMessage?: string } }> {
    return new Promise((resolve, reject) => {
      const bin = this.options.daemonBin
      const args = ["--json", "--db", this.options.dbPath]

      this.process = spawn(bin, args, {
        stdio: ["pipe", "pipe", "pipe"],
      })

      let resolved = false
      let killTimeout: NodeJS.Timeout

      const finish = () => {
        if (!resolved) return
        clearTimeout(killTimeout)
        this.process?.stdin?.end()
      }

      const fail = (err: Error) => {
        if (resolved) return
        resolved = true
        finish()
        reject(err)
      }

      this.process.on("error", (err) => {
        fail(err)
      })

      this.process.on("exit", (code, signal) => {
        fail(new Error(`Rust daemon exited with code ${code ?? "null"}${signal ? ` (signal ${signal})` : ""}${describeExit(signal)}`))
      })

      // Drain stderr: the daemon logs warnings/panics there. Not reading it
      // fills the 64KB pipe buffer and blocks the daemon mid-crawl.
      if (this.process.stderr) {
        this.process.stderr.on("data", (chunk: Buffer) => {
          const text = chunk.toString().trimEnd()
          if (text) console.error(`[crawl-daemon] ${text}`)
        })
      }

      this.options.abortSignal?.addEventListener("abort", () => {
        this.process?.kill("SIGTERM")
      })

      // Wall-clock cap. Report it as a timeout rather than the SIGTERM
      // exit below winning the race with a cryptic "exited with code null".
      killTimeout = setTimeout(() => {
        this.process?.kill("SIGTERM")
        setTimeout(() => this.process?.kill("SIGKILL"), 5000)
        fail(new Error("Crawl timeout after 30 minutes"))
      }, 30 * 60 * 1000)

      const rl = createInterface({ input: this.process.stdout! })

      rl.on("line", (line: string) => {
        try {
          const msg: RustMessage = JSON.parse(line)

          switch (msg.type) {
            case "progress":
              this.options.onProgress?.({
                crawlId: msg.crawlId,
                total: msg.total,
                checked: msg.checked,
                changed: 0,
                broken: 0,
                skipped: 0,
                status: "running",
                startedAt: new Date().toISOString(),
              })
              break

            case "result":
              this.options.onResult?.(msg.result)
              break

            case "complete":
              clearTimeout(killTimeout)
              if (!resolved) {
                resolved = true
                finish()
                const record = { crawlId: msg.crawlId, ...msg.record }
                this.options.onComplete?.(record)
                resolve({ crawlId: msg.crawlId, record })
              }
              break

            case "error":
              clearTimeout(killTimeout)
              if (!resolved) {
                resolved = true
                finish()
                this.options.onError?.(msg.error)
                reject(new Error(msg.error))
              }
              break

            case "backpressure":
              break
          }
        } catch {
          // Ignore malformed JSON lines
        }
      })

      const request: RustCrawlRequest = {
        type: "start_crawl",
        id: this.crawlId,
        config: this.options.config.crawl,
        checks: this.options.config.checks,
        sitemaps: this.options.sitemaps,
        known_hashes: this.options.knownHashes,
      }

      this.process.stdin!.write(JSON.stringify(request) + "\n")
    })
  }

  abort(): void {
    this.process?.kill("SIGTERM")
  }
}

export function getDefaultDaemonBin(): string {
  return process.env.CRAWLER_DAEMON_BIN ?? "./crawler/target/release/crawl-daemon"
}

export function isRustBackend(): boolean {
  return process.env.CRAWLER_BACKEND === "rust"
}

function describeExit(signal: string | null): string {
  switch (signal) {
    case "SIGKILL":
      return " — killed by SIGKILL, likely OOM or container limit"
    case "SIGSEGV":
      return " — segfault in the daemon"
    case "SIGABRT":
      return " — daemon panicked"
    case "SIGTERM":
      return " — terminated (crawl cancelled?)"
    default:
      return ""
  }
}
