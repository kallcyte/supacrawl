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
    const flags: string[] = []
    if (r.error) flags.push(chalk.red(`error: ${r.error}`))
    if (r.mojibakeFlagged) flags.push(chalk.yellow(`mojibake (${((r.mojibakeScore ?? 0) * 100).toFixed(0)}%)`))
    if (r.llmGarbageFlagged) flags.push(chalk.cyan(`llm-garbage (${((r.llmGarbageScore ?? 0) * 100).toFixed(0)}%)`))
    console.log(`  ${url.padEnd(maxLen)}  ${status}  ${chalk.gray(time)}`)
    for (const f of flags) console.log(`    ${f}`)
  }
}

export function printMojibakeReport(results: CrawlResultRecord[]): void {
  const flagged = results.filter((r) => r.mojibakeFlagged)
  if (flagged.length === 0) return
  console.log(chalk.yellow.bold(`\nMojibake detected (${flagged.length})`))
  for (const r of flagged) {
    const score = r.mojibakeScore !== null ? `${(r.mojibakeScore * 100).toFixed(0)}%` : "?"
    console.log(chalk.yellow(`  ${r.url} [score: ${score}]`))
  }
}

function colorStatus(code: number): string {
  if (code < 300) return chalk.green(code.toString())
  if (code < 400) return chalk.yellow(code.toString())
  if (code < 500) return chalk.red(code.toString())
  return chalk.bgRed.white(code.toString())
}
