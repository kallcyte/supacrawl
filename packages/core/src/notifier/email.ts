import nodemailer from "nodemailer"
import { NotificationProvider, NotificationError } from "./types.js"
import type { EmailConfig, NotificationPayload } from "../types.js"

export class EmailProvider implements NotificationProvider {
  readonly name = "email"
  constructor(private config: EmailConfig) {}

  private createTransport() {
    if (!this.config.smtp.host) {
      throw new NotificationError("email", "Missing SMTP host")
    }
    return nodemailer.createTransport({
      host: this.config.smtp.host,
      port: this.config.smtp.port ?? 587,
      secure: this.config.smtp.secure ?? false,
      auth:
        this.config.smtp.user && this.config.smtp.pass
          ? { user: this.config.smtp.user, pass: this.config.smtp.pass }
          : undefined
    })
  }

  async send(payload: NotificationPayload): Promise<void> {
    if (!this.config.from) throw new NotificationError("email", "Missing from address")
    if (!this.config.to.length) throw new NotificationError("email", "No recipients")
    const transport = this.createTransport()
    await transport.sendMail({
      from: this.config.from,
      to: this.config.to.join(", "),
      subject: `[supacrawl] ${payload.title}`,
      text: `${payload.message}\n\n${
        payload.meta ? JSON.stringify(payload.meta, null, 2) : ""
      }`
    })
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
