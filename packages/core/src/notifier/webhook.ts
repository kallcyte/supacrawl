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
      const sig = await hmacSha256Hex(this.config.secret, body)
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

/**
 * HMAC-SHA256 using Web Crypto API.
 */
async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
