import { resolve } from "node:path"
import { existsSync } from "node:fs"
import chalk from "chalk"
import cron from "node-cron"
import { loadConfigFromFile, Storage, Notifier, runCrawlWithPersistence } from "@supacrawl/core"

interface ScheduleOpts {
  config: string
  db: string
  expression?: string
}

export async function scheduleCommand(opts: ScheduleOpts): Promise<void> {
  const configPath = resolve(opts.config)
  if (!existsSync(configPath)) {
    console.error(chalk.red(`Config not found: ${configPath}`))
    process.exit(1)
  }
  const config = loadConfigFromFile(configPath)
  const expression = opts.expression ?? config.schedule
  if (!expression) {
    console.error(chalk.red("No cron expression provided (use --expression or set schedule in config)"))
    process.exit(1)
  }
  if (!cron.validate(expression)) {
    console.error(chalk.red(`Invalid cron expression: ${expression}`))
    process.exit(1)
  }
  console.log(chalk.blue(`[supacrawl] scheduling with expression: ${expression}`))
  const storage = new Storage({ path: resolve(opts.db) })
  const notifier = new Notifier(config.notifications)

  const run = async () => {
    console.log(chalk.gray(`[supacrawl] trigger at ${new Date().toISOString()}`))
    try {
      const { crawlId, record } = await runCrawlWithPersistence({ config, storage, notifier })
      console.log(
        chalk.green(
          `[supacrawl] crawl ${crawlId} done: ${record.urlsChecked}/${record.urlsTotal}, ${record.urlsBroken} broken, ${record.urlsChanged} changed`
        )
      )
    } catch (err) {
      console.error(chalk.red(`[supacrawl] scheduled crawl failed: ${(err as Error).message}`))
    }
  }

  await run()
  const task = cron.schedule(expression, run)
  console.log(chalk.green(`[supacrawl] scheduler running. Press Ctrl+C to stop.`))
  process.on("SIGINT", () => {
    task.stop()
    storage.close()
    process.exit(0)
  })
  await new Promise(() => {})
}
