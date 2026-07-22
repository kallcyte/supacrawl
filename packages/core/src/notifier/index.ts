import { SlackProvider } from "./slack.js"
import { TelegramProvider } from "./telegram.js"
import { EmailProvider } from "./email.js"
import { WebhookProvider } from "./webhook.js"
import type { NotificationProvider } from "./types.js"
import type {
  NotificationEvent,
  NotificationPayload,
  NotificationsConfig
} from "../types.js"

export class Notifier {
  private providers: NotificationProvider[] = []

  constructor(private config: NotificationsConfig) {
    if (this.config.providers.slack.enabled) {
      this.providers.push(new SlackProvider(this.config.providers.slack))
    }
    if (this.config.providers.telegram.enabled) {
      this.providers.push(new TelegramProvider(this.config.providers.telegram))
    }
    if (this.config.providers.email.enabled) {
      this.providers.push(new EmailProvider(this.config.providers.email))
    }
    if (this.config.providers.webhook.enabled) {
      this.providers.push(new WebhookProvider(this.config.providers.webhook))
    }
  }

  get enabledProviders(): string[] {
    return this.providers.map((p) => p.name)
  }

  async notify(event: NotificationEvent, payload: NotificationPayload): Promise<void> {
    if (!this.isEventEnabled(event)) return
    await Promise.allSettled(
      this.providers.map((p) =>
        p.send(payload).catch((err) => {
          console.error(`[notifier] ${p.name} failed:`, err.message)
        })
      )
    )
  }

  isEventEnabled(event: NotificationEvent): boolean {
    return this.config.events[event] ?? false
  }
}

export type { NotificationProvider } from "./types.js"
export { SlackProvider, TelegramProvider, EmailProvider, WebhookProvider }
export { NotificationError } from "./types.js"
