import { NotificationProvider, NotificationError } from "./types.js"
import type { NotificationPayload, TelegramConfig } from "../types.js"

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
    const text = `*${escapeMd(payload.title)}*\n${escapeMd(payload.message)}`
    const res = await fetch(this.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.config.chatId,
        text,
        parse_mode: "MarkdownV2"
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

function escapeMd(s: string): string {
  return s.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&")
}
