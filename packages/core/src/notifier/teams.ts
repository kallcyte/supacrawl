import { NotificationProvider, NotificationError } from "./types.js"
import type { TeamsConfig, NotificationPayload } from "../types.js"

/**
 * Microsoft Teams incoming webhook provider.
 * Uses the "MessageCard" payload format for Teams connectors.
 */
export class TeamsProvider implements NotificationProvider {
  readonly name = "teams"

  constructor(private config: TeamsConfig) {}

  async send(payload: NotificationPayload): Promise<void> {
    if (!this.config.webhookUrl) {
      throw new NotificationError("teams", "Missing webhook URL")
    }

    const themeColor =
      payload.event === "onCrawlFailure" || payload.event === "onMonitorDown"
        ? "FF0000"
        : payload.event === "onMonitorRecovery"
          ? "00CC00"
          : "0076D7"

    const card = {
      "@type": "MessageCard",
      "@context": "https://schema.org/extensions",
      summary: payload.title,
      title: `[supacrawl] ${payload.title}`,
      text: payload.message,
      themeColor
    }

    const res = await fetch(this.config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card)
    })

    if (!res.ok) {
      // Teams returns 200 even for invalid webhook URLs (just with an error in the body).
      // Accept 2xx as success.
      const text = await res.text().catch(() => "")
      if (text.includes("error")) {
        throw new NotificationError("teams", text)
      }
    }
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.config.webhookUrl) {
      return { ok: false, error: "Missing webhook URL" }
    }
    try {
      const res = await fetch(this.config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "supacrawl connection test" })
      })
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        return { ok: false, error: `Teams returned ${res.status}: ${text.slice(0, 200)}` }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }
}
