import { resolve } from "node:path"
import { existsSync, readFileSync } from "node:fs"
import chalk from "chalk"
import {
  loadConfigFromFile,
  Storage,
  Notifier,
  runCrawlWithPersistence,
  type CrawlProgress
} from "@supacrawl/core"
import { printReport } from "../reporter.js"

interface CrawlOpts {
  config: string
  db: string
  json?: boolean
}

export async function crawlCommand(opts: CrawlOpts): Promise<void> {
  const configPath = resolve(opts.config)
  if (!existsSync(configPath)) {
    console.error(chalk.red(`Config not found: ${configPath}`))
    process.exit(1)
  }
  const config = loadConfigFromFile(configPath)
  const storage = new Storage({ path: resolve(opts.db) })
  const notifier = new Notifier(config.notifications)

  console.log(chalk.blue(`[supacrawl] starting crawl`))
  console.log(chalk.gray(`  sitemaps: ${config.sitemaps.map((s) => `${s.url}${s.enabled ? "" : " (disabled)"}`).join(", ")}`))
  console.log(chalk.gray(`  delay: ${config.crawl.delayMs}ms, concurrency: ${config.crawl.maxConcurrency}`))

  const start = Date.now()
  const progressLines = new Map<number, string>()

  try {
    const { crawlId, record } = await runCrawlWithPersistence({
      config,
      storage,
      notifier,
      onProgress: (p: CrawlProgress) => {
        if (opts.json) {
          process.stdout.write(JSON.stringify({ type: "progress", ...p }) + "\n")
        } else {
          const pct = p.total > 0 ? Math.floor((p.checked / p.total) * 100) : 0
          const line = `[${pct.toString().padStart(3)}%] ${p.checked}/${p.total} checked, ${p.broken} broken, ${p.changed} changed`
          process.stdout.write(`\r${chalk.cyan(line.padEnd(80, " "))}`)
        }
      }
    })

    if (!opts.json) process.stdout.write("\n")
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(
      chalk.green(
        `[supacrawl] crawl ${crawlId} completed in ${elapsed}s — ${record.urlsChecked}/${record.urlsTotal} checked, ${record.urlsBroken} broken, ${record.urlsChanged} changed`
      )
    )

    if (opts.json) {
      console.log(
        JSON.stringify(
          { type: "complete", crawlId, record, results: storage.listResults(crawlId) },
          null,
          2
        )
      )
    } else {
      printReport(storage.listResults(crawlId, { brokenOnly: true }), {
        title: "Broken URLs",
        empty: "No broken URLs"
      })
      printReport(storage.listResults(crawlId, { changedOnly: true }), {
        title: "Changed URLs",
        empty: "No content changes"
      })
    }
  } catch (err) {
    console.error(chalk.red(`[supacrawl] crawl failed: ${(err as Error).message}`))
    process.exit(1)
  } finally {
    storage.close()
  }
  void progressLines
}
