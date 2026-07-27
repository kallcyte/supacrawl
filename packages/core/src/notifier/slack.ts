import { NotificationProvider, NotificationError } from "./types.js"
import type { NotificationPayload, SlackConfig } from "../types.js"

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
    const color =
      payload.event === "onCrawlFailure"
        ? "danger"
        : payload.event === "onContentChange"
          ? "warning"
          : payload.event === "onSslExpiring"
            ? "warning"
            : payload.event === "onMojibakeDetected"
              ? "warning"
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
