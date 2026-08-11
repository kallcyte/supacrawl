import { SlackProvider } from "./slack.js"
import { TelegramProvider } from "./telegram.js"
import { TeamsProvider } from "./teams.js"
import { WebhookProvider } from "./webhook.js"
import type { NotificationProvider } from "./types.js"
import type {
  NotificationEvent,
  NotificationPayload,
  NotificationsConfig,
  CrawlJob,
  UserNotificationSettings
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
    if (this.config.providers.teams.enabled) {
      this.providers.push(new TeamsProvider(this.config.providers.teams))
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
    return this.config.events?.[event] ?? false
  }

  /** Build a NotificationsConfig from a UserNotificationSettings object. */
  static configFromUserSettings(settings: UserNotificationSettings): NotificationsConfig {
    return {
      providers: {
        slack: {
          enabled: settings.slack.enabled,
          webhookUrl: settings.slack.webhookUrl
        },
        telegram: {
          enabled: settings.telegram.enabled,
          botToken: settings.telegram.botToken,
          chatId: settings.telegram.chatId
        },
        email: {
          enabled: false,
          smtp: {},
          from: undefined,
          to: []
        },
        webhook: {
          enabled: settings.webhook.enabled,
          url: settings.webhook.url,
          secret: settings.webhook.secret
        },
        teams: {
          enabled: settings.teams.enabled,
          webhookUrl: settings.teams.webhookUrl
        }
      },
      events: {
        onCrawlFailure: settings.enabledEvents.onCrawlFailure,
        onContentChange: settings.enabledEvents.onContentChange,
        onSslExpiring: settings.enabledEvents.onSslExpiring,
        onCrawlComplete: settings.enabledEvents.onCrawlComplete,
        onMojibakeDetected: settings.enabledEvents.onMojibakeDetected,
        onLlmGarbageDetected: settings.enabledEvents.onLlmGarbageDetected,
        onCrawlProgress: settings.enabledEvents.onCrawlProgress,
        onMonitorDown: settings.enabledEvents.onMonitorDown,
        onMonitorRecovery: settings.enabledEvents.onMonitorRecovery
      }
    }
  }

  /** Build a NotificationsConfig from a CrawlJob's DB fields. */
  static configFromJob(job: Pick<CrawlJob, "notifyOnComplete" | "notifyOnFailure" | "notifyOnChange" | "notifyOnMojibake" | "notifyOnLlmGarbage" | "notifySslExpiring" | "notifyOnProgress" | "notificationProviders">): NotificationsConfig {
    const providers = job.notificationProviders ?? {}
    return {
      providers: {
        slack: {
          enabled: providers.slack?.enabled ?? false,
          webhookUrl: providers.slack?.webhookUrl
        },
        telegram: {
          enabled: providers.telegram?.enabled ?? false,
          botToken: providers.telegram?.botToken,
          chatId: providers.telegram?.chatId
        },
        email: {
          enabled: false,
          smtp: {},
          from: undefined,
          to: []
        },
        webhook: {
          enabled: providers.webhook?.enabled ?? false,
          url: providers.webhook?.url,
          secret: providers.webhook?.secret
        },
        teams: {
          enabled: providers.teams?.enabled ?? false,
          webhookUrl: providers.teams?.webhookUrl
        }
      },
      events: {
        onCrawlFailure: job.notifyOnFailure,
        onContentChange: job.notifyOnChange,
        onSslExpiring: job.notifySslExpiring,
        onCrawlComplete: job.notifyOnComplete,
        onMojibakeDetected: job.notifyOnMojibake,
        onLlmGarbageDetected: job.notifyOnLlmGarbage,
        onCrawlProgress: job.notifyOnProgress,
        onMonitorDown: true,
        onMonitorRecovery: true
      }
    }
  }
}

export type { NotificationProvider } from "./types.js"
export { SlackProvider, TelegramProvider, TeamsProvider, WebhookProvider }
export { NotificationError } from "./types.js"
