import chalk from "chalk"
import type { CrawlResultRecord } from "@supacrawl/core"

export function printReport(
  results: CrawlResultRecord[],
  opts: { title: string; empty: string }
): void {
  console.log(chalk.bold(`\n${opts.title} (${results.length})`))
  if (results.length === 0) {
    console.log(chalk.gray(`  ${opts.empty}`))
    return
  }
  const maxLen = Math.max(20, ...results.map((r) => Math.min(r.url.length, 80)))
  for (const r of results) {
    const url = r.url.length > 80 ? r.url.slice(0, 77) + "..." : r.url
    const status = r.statusCode !== null ? colorStatus(r.statusCode) : chalk.red("ERR")
    const time = r.responseTimeMs !== null ? `${r.responseTimeMs}ms` : "-"
    console.log(`  ${url.padEnd(maxLen)}  ${status}  ${chalk.gray(time)}`)
    if (r.error) console.log(chalk.red(`    error: ${r.error}`))
  }
}

function colorStatus(code: number): string {
  if (code < 300) return chalk.green(code.toString())
  if (code < 400) return chalk.yellow(code.toString())
  if (code < 500) return chalk.red(code.toString())
  return chalk.bgRed.white(code.toString())
}
