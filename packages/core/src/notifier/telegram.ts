import { NotificationProvider, NotificationError } from "./types.js"
import type { NotificationPayload, TelegramConfig } from "../types.js"

function healthEmoji(score: number) {
  if (score >= 90) return "\u{1F7E2}"
  if (score >= 70) return "\u{1F7E1}"
  return "\u{1F534}"
}

function truncateUrl(url: string, n = 42) {
  return url.length > n ? url.slice(0, n) + "\u2026" : url
}

export class TelegramProvider implements NotificationProvider {
  readonly name = "telegram"
  constructor(private config: TelegramConfig) {}

  private get apiUrl(): string {
    if (!this.config.botToken || !this.config.chatId) {
      throw new NotificationError("telegram", "Missing botToken or chatId")
    }
    return `https://api.telegram.org/bot${this.config.botToken}/sendMessage`
  }

  async send(payload: NotificationPayload): Promise<void> {
    let text: string

    // Progress milestone
    if (payload.event === "onCrawlProgress" && payload.meta) {
      const pct = (payload.meta.percent as number) ?? 0
      const checked = payload.meta.checked ?? 0
      const total = payload.meta.total ?? 0
      const broken = payload.meta.broken ?? 0
      const changed = payload.meta.changed ?? 0
      const filled = Math.round((pct / 100) * 20)
      const bar = "\u2588".repeat(filled) + "\u2591".repeat(20 - filled)
      text = `<b>\uD83D\uDD0D Crawl ${pct}% complete</b>\n\n`
        + `<pre>${bar}</pre>\n`
        + `<code>${checked}/${total}</code> URLs checked\n`
        + `\uD83D\uDEA8 ${broken} broken  \uD83D\uDD04 ${changed} changed\n`
        + `Remaining: ${payload.message.split("Remaining: ")[1] ?? "calculating\u2026"}`
    }

    // Full report
    else if (payload.reportStats) {
      const s = payload.reportStats
      const health = healthEmoji(s.healthScore)

      text = `<b>${health} ${payload.title}</b>\n\n`
      text += `<b>Health Score: ${s.healthScore}%</b> \u2014 ${s.totalChecked}/${s.totalFound} URLs checked\n\n`

      // Stats row
      const brokenColor = s.brokenCount > 0 ? "#dc2626" : "#059669"
      const changedColor = s.changedCount > 0 ? "#d97706" : "#059669"
      const sslColor = s.sslCount > 0 ? "#ea580c" : "#059669"
      const mjColor = s.mojibakeCount > 0 ? "#9333ea" : "#059669"
      const lgColor = s.llmGarbageCount > 0 ? "#0891b2" : "#059669"

      const stat = (emoji: string, label: string, count: number, color: string) =>
        `${emoji} <b>${count}</b> <i>${label}</i>`

      text += stat("\uD83D\uDEA8", "Broken", s.brokenCount, brokenColor) + "\n"
      text += stat("\uD83D\uDD04", "Changed", s.changedCount, changedColor) + "\n"
      text += stat("\uD83D\uDD12", "SSL Expiring", s.sslCount, sslColor) + "\n"
      text += stat("\uD83D\uDD24", "Mojibake", s.mojibakeCount, mjColor) + "\n"
      text += stat("\uD83E\uDD16", "LLM Garbage", s.llmGarbageCount, lgColor) + "\n\n"

      // Performance
      const perf: string[] = []
      if (s.avgResponseTimeMs !== null) perf.push(`Avg: ${s.avgResponseTimeMs}ms`)
      if (s.fastestResponseTimeMs !== null) perf.push(`Fast: ${s.fastestResponseTimeMs}ms`)
      if (s.slowestResponseTimeMs !== null) perf.push(`Slow: ${s.slowestResponseTimeMs}ms`)
      if (perf.length > 0) {
        text += `<b>\uD83D\uDCCA Performance</b>\n<code>${perf.join("  \u00B7  ")}</code>\n\n`
      }

      // Issue URLs
      if (payload.reportUrls) {
        const urls = payload.reportUrls
        const sections = [
          { emoji: "\uD83D\uDEA8", label: "Broken URLs", items: urls.broken },
          { emoji: "\uD83D\uDD04", label: "Changed URLs", items: urls.changed },
          { emoji: "\uD83D\uDD12", label: "SSL Expiring", items: urls.sslExpiring },
          { emoji: "\uD83D\uDD24", label: "Mojibake", items: urls.mojibake },
          { emoji: "\uD83E\uDD16", label: "LLM Garbage", items: urls.llmGarbage }
        ]
        for (const sec of sections) {
          if (sec.items.length > 0) {
            const max = sec.items.length <= 5 ? 5 : 3
            text += `<b>${sec.emoji} ${sec.label} (${sec.items.length})</b>\n`
            for (const item of sec.items.slice(0, max)) {
              text += `\u2022 ${escapeHtml(truncateUrl(item.url))}`
              if (item.detail) text += ` <i>(${escapeHtml(item.detail)})</i>`
              text += "\n"
            }
            if (sec.items.length > max) {
              text += `<i>+${sec.items.length - max} more</i>\n`
            }
            text += "\n"
          }
        }
      }

      // Footer
      if (payload.crawlId) {
        text += `<i>supacrawl \u00B7 ID: ${payload.crawlId.slice(0, 8)}</i>`
      }
    }

    // Legacy fallback
    else {
      text = `<b>${escapeHtml(payload.title)}</b>\n${escapeHtml(payload.message)}`
    }

    const res = await fetch(this.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.config.chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    })
    if (!res.ok) {
      const body = await res.text()
      throw new NotificationError("telegram", `HTTP ${res.status}: ${body.slice(0, 200)}`)
    }
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.send({
        event: "onCrawlComplete",
        title: "supacrawl test",
        message: "Test notification from supacrawl"
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
