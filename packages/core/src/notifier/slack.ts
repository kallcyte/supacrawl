import { NotificationProvider, NotificationError } from "./types.js"
import type { NotificationPayload, SlackConfig } from "../types.js"

function barBlocks(percent: number) {
  const filled = Math.round((percent / 100) * 10)
  const bar = "█".repeat(filled) + "░".repeat(10 - filled)
  return { text: `\`${bar}\`  ${percent}%`, color: barColor(percent) }
}

function barColor(pct: number) {
  if (pct >= 75) return "#059669"
  if (pct >= 50) return "#d97706"
  return "#64748b"
}

function statBlock(label: string, value: number, color: string, icon: string) {
  const ct = value > 0 ? color : "#059669"
  return {
    type: "mrkdwn" as const,
    text: `${icon} *${value}*\n_${label}_`
  }
}

function issueSection(title: string, items: { url: string; detail?: string }[], max: number) {
  const list = items.slice(0, max).map((i) => `• <${i.url}|${truncateUrl(i.url)}>` + (i.detail ? ` _(${i.detail})_` : ""))
  if (items.length > max) list.push(`_+${items.length - max} more_`)
  return `*${title}*\n${list.join("\n")}`
}

function truncateUrl(url: string, n = 48) {
  return url.length > n ? url.slice(0, n) + "…" : url
}

function healthEmoji(score: number) {
  if (score >= 90) return "🟢"
  if (score >= 70) return "🟡"
  return "🔴"
}

export class SlackProvider implements NotificationProvider {
  readonly name = "slack"
  constructor(private config: SlackConfig) {}

  private get url(): string {
    if (!this.config.webhookUrl) {
      throw new NotificationError("slack", "Missing webhookUrl")
    }
    return this.config.webhookUrl
  }

  async send(payload: NotificationPayload): Promise<void> {
    const blocks: unknown[] = []

    // Progress milestone
    if (payload.event === "onCrawlProgress" && payload.meta) {
      const pct = (payload.meta.percent as number) ?? 0
      const bar = barBlocks(pct)
      const checked = payload.meta.checked ?? 0
      const total = payload.meta.total ?? 0
      const broken = payload.meta.broken ?? 0
      const changed = payload.meta.changed ?? 0
      blocks.push(
        {
          type: "header",
          text: { type: "plain_text", text: `🔍 Crawl ${pct}% complete`, emoji: true }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${bar.text}\n${checked}/${total} URLs checked · ${broken} broken · ${changed} changed\nRemaining: ${payload.message.split("Remaining: ")[1] ?? "calculating…"}`
          }
        }
      )
    }

    // Full report (onCrawlComplete and per-issue events)
    if (payload.event !== "onCrawlProgress" && payload.reportStats) {
      const s = payload.reportStats
      const health = healthEmoji(s.healthScore)

      const headerColor =
        payload.event === "onCrawlFailure" ? "#dc2626"
        : payload.event === "onContentChange" ? "#d97706"
        : "#6366f1"

      // Header
      blocks.push({
        type: "header",
        text: { type: "plain_text", text: `${health === "🟢" ? "✅" : health === "🟡" ? "⚠️" : "🚨"} ${payload.title}`, emoji: true }
      })

      // Context
      blocks.push({
        type: "context",
        elements: [
          { type: "mrkdwn", text: `${health} Health: *${s.healthScore}%* · ${s.totalChecked}/${s.totalFound} URLs checked` }
        ]
      })

      // Stat cards
      blocks.push({
        type: "section",
        fields: [
          statBlock("Broken", s.brokenCount, "#dc2626", "🚨"),
          statBlock("Changed", s.changedCount, "#d97706", "🔄"),
          statBlock("SSL Expiring", s.sslCount, "#ea580c", "🔒"),
          statBlock("Mojibake", s.mojibakeCount, "#9333ea", "🔤")
        ]
      })

      // Performance
      const perf: string[] = []
      if (s.avgResponseTimeMs !== null) perf.push(`Avg: ${s.avgResponseTimeMs}ms`)
      if (s.fastestResponseTimeMs !== null) perf.push(`Fastest: ${s.fastestResponseTimeMs}ms`)
      if (s.slowestResponseTimeMs !== null) perf.push(`Slowest: ${s.slowestResponseTimeMs}ms`)
      if (perf.length > 0) {
        blocks.push({
          type: "context",
          elements: [{ type: "mrkdwn", text: `📊 ${perf.join("  ·  ")}` }]
        })
      }

      // Issue breakdowns
      if (payload.reportUrls) {
        const urls = payload.reportUrls
        const sections = [
          { block: "🚨 Broken URLs", items: urls.broken },
          { block: "🔄 Changed URLs", items: urls.changed },
          { block: "🔒 SSL Expiring", items: urls.sslExpiring },
          { block: "🔤 Mojibake", items: urls.mojibake }
        ]
        for (const sec of sections) {
          if (sec.items.length > 0) {
            const maxItems = sec.items.length <= 5 ? 5 : 3
            blocks.push({
              type: "section",
              text: { type: "mrkdwn", text: issueSection(sec.block, sec.items, maxItems) }
            })
          }
        }
      }

      // Footer
      if (payload.crawlId) {
        blocks.push({
          type: "context",
          elements: [{ type: "mrkdwn", text: `supacrawl · ID: \`${payload.crawlId.slice(0, 8)}\`` }]
        })
      }

      blocks.push({ type: "divider" })
    }

    // Fallback: no reportStats (legacy or test)
    if (payload.event !== "onCrawlProgress" && !payload.reportStats) {
      const color =
        payload.event === "onCrawlFailure" ? "danger"
        : payload.event === "onContentChange" ? "warning"
        : payload.event === "onSslExpiring" ? "warning"
        : payload.event === "onMojibakeDetected" ? "warning"
        : "good"

      const body = {
        attachments: [
          {
            color,
            title: payload.title,
            text: payload.message,
            fields: payload.meta
              ? Object.entries(payload.meta).map(([title, value]) => ({
                  title,
                  value: String(value),
                  short: true
                }))
              : []
          }
        ]
      }
      const res = await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      })
      if (!res.ok) throw new NotificationError("slack", `HTTP ${res.status}`)
      return
    }

    const body = { blocks }
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      throw new NotificationError("slack", `HTTP ${res.status}`)
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
