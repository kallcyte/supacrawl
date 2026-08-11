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

  private buildHtml(payload: NotificationPayload): string {
    if (payload.htmlBody) return payload.htmlBody

    const meta = payload.meta as Record<string, unknown> | undefined
    const items = meta
      ? Object.entries(meta)
          .filter(([, v]) => typeof v === "number" || typeof v === "string" || Array.isArray(v))
          .map(
            ([k, v]) =>
              `<tr>
                <td style="padding:4px 8px;border-bottom:1px solid #eee;color:#666;font-size:13px;">${k}</td>
                <td style="padding:4px 8px;border-bottom:1px solid #eee;font-size:13px;">${Array.isArray(v) ? v.join(", ") : String(v)}</td>
              </tr>`
          )
          .join("")
      : ""

    return `<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#0014cc;color:#fff;border-radius:8px 8px 0 0;padding:20px 24px;">
        <h1 style="margin:0;font-size:18px;">supacrawl</h1>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 8px 8px;padding:24px;color:#1e293b;">
        <h2 style="margin:0 0 12px;font-size:16px;">${payload.title}</h2>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#475569;">${payload.message}</p>
        ${
          items
            ? `<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">${items}</table>`
            : ""
        }
        ${
          payload.crawlName
            ? `<p style="margin:0 0 4px;font-size:12px;color:#94a3b8;">${payload.crawlName}</p>`
            : ""
        }
        ${
          payload.crawlUrl
            ? `<p style="margin:0 0 4px;font-size:12px;"><a href="${payload.crawlUrl}" style="color:#0014cc;">View crawl report</a></p>`
            : ""
        }
        ${
          payload.crawlId
            ? `<p style="margin:0;font-size:12px;color:#94a3b8;">Crawl ID: ${payload.crawlId.slice(0, 8)}</p>`
            : ""
        }
      </div>
      <p style="text-align:center;font-size:11px;color:#94a3b8;margin-top:12px;">
        supacrawl · Automated crawl report
      </p>
    </div>`
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
        payload.crawlName ? `Crawl: ${payload.crawlName}\n` : ""
      }${
        payload.crawlUrl ? `View crawl report: ${payload.crawlUrl}\n\n` : ""
      }${
        payload.meta ? JSON.stringify(payload.meta, null, 2) : ""
      }`,
      html: this.buildHtml(payload)
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
