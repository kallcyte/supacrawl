import type { NotificationPayload } from "../types.js"

export interface NotificationProvider {
  readonly name: string
  send(payload: NotificationPayload): Promise<void>
  testConnection(): Promise<{ ok: boolean; error?: string }>
}

export class NotificationError extends Error {
  constructor(
    public provider: string,
    message: string
  ) {
    super(`[${provider}] ${message}`)
    this.name = "NotificationError"
  }
}
