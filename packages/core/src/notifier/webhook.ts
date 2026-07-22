import { createHmac } from "node:crypto"
import { NotificationProvider, NotificationError } from "./types.js"
import type { NotificationPayload, WebhookConfig } from "../types.js"

export class WebhookProvider implements NotificationProvider {
  readonly name = "webhook"
  constructor(private config: WebhookConfig) {}

  private get url(): string {
    if (!this.config.url) throw new NotificationError("webhook", "Missing url")
    return this.config.url
  }

  async send(payload: NotificationPayload): Promise<void> {
    const body = JSON.stringify(payload)
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "supacrawl/0.1"
    }
    if (this.config.secret) {
      const sig = createHmac("sha256", this.config.secret).update(body).digest("hex")
      headers["X-Supacrawl-Signature"] = `sha256=${sig}`
    }
    const res = await fetch(this.url, { method: "POST", headers, body })
    if (!res.ok) {
      throw new NotificationError("webhook", `HTTP ${res.status}`)
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
