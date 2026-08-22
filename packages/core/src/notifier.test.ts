import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createHmac } from "node:crypto"
import nodemailer from "nodemailer"

import { SlackProvider } from "./notifier/slack.js"
import { TelegramProvider } from "./notifier/telegram.js"
import { EmailProvider } from "./notifier/email.js"
import { WebhookProvider } from "./notifier/webhook.js"
import { Notifier, NotificationError } from "./notifier/index.js"
import type {
  NotificationPayload,
  CrawlReportStats,
  NotificationsConfig,
  NotificationEvent,
  JobNotificationProviders
} from "./types.js"

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn() }
}))

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

const stats: CrawlReportStats = {
  healthScore: 92,
  totalChecked: 100,
  totalFound: 110,
  brokenCount: 2,
  changedCount: 3,
  sslCount: 0,
  mojibakeCount: 0,
  llmGarbageCount: 1,
  avgResponseTimeMs: 250,
  fastestResponseTimeMs: 80,
  slowestResponseTimeMs: 900
}

function legacyPayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    event: "onCrawlComplete",
    title: "Crawl finished",
    message: "All done",
    crawlId: "abcdef1234567890",
    crawlName: "My Crawl",
    crawlUrl: "https://example.com/crawls/abc",
    ...overrides
  }
}

type RecordedRequest = { input: string | URL; init?: RequestInit }

/** JSON parsed from a recorded request body. Unchecked cast: test-owned fixture boundary. */
function parseBody(call: RecordedRequest | undefined): Record<string, unknown> {
  const raw = call?.init?.body
  if (!raw) throw new Error("expected a recorded fetch call with a body")
  return JSON.parse(String(raw)) as Record<string, unknown>
}

function blockList(body: Record<string, unknown>): Record<string, unknown>[] {
  // Unchecked cast: Slack block-kit payloads are untyped JSON in tests.
  return (body.blocks ?? []) as Record<string, unknown>[]
}

function stubFetch(
  responses: Array<{ status: number; body?: string }> | ((req: RecordedRequest) => Response)
): RecordedRequest[] {
  const calls: RecordedRequest[] = []
  const list = Array.isArray(responses) ? responses : []
  const fake = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    calls.push({ input: input as string | URL, init })
    if (typeof responses === "function") return responses(calls[calls.length - 1]!)
    const spec = list[Math.min(calls.length - 1, list.length - 1)] ?? { status: 200 }
    return new Response(spec.body ?? null, { status: spec.status })
  }
  vi.stubGlobal("fetch", vi.fn(fake))
  return calls
}

function stubRejectedFetch(): RecordedRequest[] {
  const calls: RecordedRequest[] = []
  const fake = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    calls.push({ input: input as string | URL, init })
    throw new TypeError("network down")
  }
  vi.stubGlobal("fetch", vi.fn(fake))
  return calls
}

function makeConfig(eventsOverride: Partial<Record<NotificationEvent, boolean>> = {}): NotificationsConfig {
  return {
    providers: {
      slack: { enabled: false },
      telegram: { enabled: false },
      email: { enabled: false, smtp: {}, to: [] },
      webhook: { enabled: false }
    },
    events: {
      onCrawlFailure: true,
      onContentChange: true,
      onSslExpiring: true,
      onCrawlComplete: true,
      onMojibakeDetected: true,
      onLlmGarbageDetected: true,
      onCrawlProgress: false,
      onMonitorDown: true,
      onMonitorRecovery: true,
      onMonitorSlow: true,
      ...eventsOverride
    }
  }
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// NotificationError
// ---------------------------------------------------------------------------

describe("NotificationError", () => {
  it("is an Error carrying provider, name and prefixed message", () => {
    const err = new NotificationError("slack", "HTTP 500")
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(NotificationError)
    expect(err.name).toBe("NotificationError")
    expect(err.provider).toBe("slack")
    expect(err.message).toBe("[slack] HTTP 500")
  })
})

// ---------------------------------------------------------------------------
// WebhookProvider
// ---------------------------------------------------------------------------

describe("WebhookProvider", () => {
  it("POSTs the payload as JSON to the configured url", async () => {
    const payload = legacyPayload()
    const calls = stubFetch([{ status: 200 }])
    await new WebhookProvider({ enabled: true, url: "https://hooks.example.com/x" }).send(payload)

    expect(calls).toHaveLength(1)
    expect(String(calls[0]!.input)).toBe("https://hooks.example.com/x")
    expect(calls[0]!.init?.method).toBe("POST")
    const headers = calls[0]!.init?.headers as Record<string, string>
    expect(headers["Content-Type"]).toBe("application/json")
    expect(headers["User-Agent"]).toBe("supacrawl/0.1")
    expect(parseBody(calls[0])).toEqual(payload)
  })

  it("signs the body with HMAC-SHA256 when a secret is configured", async () => {
    const payload = legacyPayload()
    const calls = stubFetch([{ status: 200 }])
    await new WebhookProvider({ enabled: true, url: "https://h.example.com", secret: "s3cret" }).send(payload)

    const headers = calls[0]!.init?.headers as Record<string, string>
    const expected = createHmac("sha256", "s3cret").update(JSON.stringify(payload)).digest("hex")
    expect(headers["X-Supacrawl-Signature"]).toBe(`sha256=${expected}`)
  })

  it("throws NotificationError on non-ok HTTP response", async () => {
    stubFetch([{ status: 502 }])
    await expect(
      new WebhookProvider({ enabled: true, url: "https://h.example.com" }).send(legacyPayload())
    ).rejects.toMatchObject({
      name: "NotificationError",
      provider: "webhook",
      message: "[webhook] HTTP 502"
    })
  })

  it("documents current behavior: fetch rejections propagate unwrapped", async () => {
    stubRejectedFetch()
    await expect(
      new WebhookProvider({ enabled: true, url: "https://h.example.com" }).send(legacyPayload())
    ).rejects.toThrow(TypeError)
  })

  it("throws NotificationError when url is missing", async () => {
    await expect(new WebhookProvider({ enabled: true }).send(legacyPayload())).rejects.toMatchObject({
      provider: "webhook",
      message: "[webhook] Missing url"
    })
  })

  it("testConnection reports ok:true on success and ok:false with error otherwise", async () => {
    stubFetch([{ status: 200 }])
    const ok = await new WebhookProvider({ enabled: true, url: "https://h.example.com" }).testConnection()
    expect(ok).toEqual({ ok: true })

    stubFetch([{ status: 500 }])
    const bad = await new WebhookProvider({ enabled: true, url: "https://h.example.com" }).testConnection()
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain("[webhook]")
  })
})

// ---------------------------------------------------------------------------
// SlackProvider
// ---------------------------------------------------------------------------

describe("SlackProvider", () => {
  const url = "https://hooks.slack.com/services/T00/B00/XXX"

  it("sends legacy payloads as an attachment with event-based color and meta fields", async () => {
    const payload = legacyPayload({ meta: { pages: 42, seed: "https://a.com" } })
    const calls = stubFetch([{ status: 200 }])
    await new SlackProvider({ enabled: true, webhookUrl: url }).send(payload)

    const body = parseBody(calls[0])
    expect(body.blocks).toBeUndefined()
    const attachments = body.attachments as Record<string, unknown>[]
    expect(attachments).toHaveLength(1)
    const att = attachments[0]!
    expect(att.color).toBe("good") // onCrawlComplete -> good
    expect(att.title).toBe("Crawl finished")
    expect(att.text).toBe("All done")
    expect(att.fields).toEqual([
      { title: "pages", value: "42", short: true },
      { title: "seed", value: "https://a.com", short: true }
    ])
    expect(att.footer).toContain("*My Crawl*")
    expect(att.footer).toContain("<https://example.com/crawls/abc|View crawl report>")
    expect(att.footer).toContain("ID: `abcdef12`")
  })

  it("uses danger color for failures and omits footer when no crawl metadata", async () => {
    const calls = stubFetch([{ status: 200 }])
    await new SlackProvider({ enabled: true, webhookUrl: url }).send({
      event: "onCrawlFailure",
      title: "Crawl failed",
      message: "boom"
    })
    const attachments = parseBody(calls[0]).attachments as Record<string, unknown>[]
    expect(attachments[0]!.color).toBe("danger")
    expect(attachments[0]!.footer).toBeUndefined()
  })

  it("builds block-kit blocks for report payloads (header, health context, stat fields)", async () => {
    const calls = stubFetch([{ status: 200 }])
    await new SlackProvider({ enabled: true, webhookUrl: url }).send(
      legacyPayload({
        reportStats: stats,
        reportUrls: {
          broken: [{ url: "https://x.dev/404", detail: "404" }],
          changed: [],
          sslExpiring: [],
          mojibake: [],
          llmGarbage: []
        }
      })
    )

    const blocks = blockList(parseBody(calls[0]))
    expect(blocks.length).toBeGreaterThan(3)
    const header = blocks.find((b) => b.type === "header") as { text?: { text?: string } }
    expect(header.text?.text).toContain("✅ Crawl finished") // healthScore 92 -> green emoji

    const contextText = blocks
      .filter((b) => b.type === "context")
      .map((b) => JSON.stringify(b.elements))
      .join("\n")
    expect(contextText).toContain("🟢 Health: *92%* · 100/110 URLs checked")

    const statSection = blocks.find((b) => Array.isArray(b.fields)) as { fields: { text: string }[] }
    const fieldText = statSection.fields.map((f) => f.text).join("\n")
    for (const label of ["Broken", "Changed", "SSL Expiring", "Mojibake", "LLM Garbage"]) {
      expect(fieldText).toContain(`_${label}_`)
    }

    const brokenSection = blocks.map((b) => (b.text as { text?: string } | undefined)?.text ?? "").find((t) =>
      t.includes("Broken URLs")
    )
    expect(brokenSection).toContain("<https://x.dev/404|https://x.dev/404>")
    expect(brokenSection).toContain("_(404)_")
  })

  it("renders a progress milestone header and bar for onCrawlProgress with meta", async () => {
    const calls = stubFetch([{ status: 200 }])
    await new SlackProvider({ enabled: true, webhookUrl: url }).send({
      event: "onCrawlProgress",
      title: "progress",
      message: "Remaining: ~5 minutes",
      meta: { percent: 50, checked: 10, total: 20, broken: 1, changed: 2 }
    })

    const blocks = blockList(parseBody(calls[0]))
    const header = blocks[0]! as { type: string; text: { text: string } }
    expect(header.type).toBe("header")
    expect(header.text.text).toBe("🔍 Crawl 50% complete")
    const sectionText = (blocks[1]!.text as { text: string }).text
    expect(sectionText).toContain("█".repeat(5) + "░".repeat(5))
    expect(sectionText).toContain("10/20 URLs checked · 1 broken · 2 changed")
    expect(sectionText).toContain("Remaining: ~5 minutes")
  })

  it("throws NotificationError on non-ok response and on missing webhookUrl", async () => {
    stubFetch([{ status: 413 }])
    await expect(new SlackProvider({ enabled: true, webhookUrl: url }).send(legacyPayload())).rejects.toMatchObject({
      name: "NotificationError",
      provider: "slack",
      message: "[slack] HTTP 413"
    })
    await expect(new SlackProvider({ enabled: true }).send(legacyPayload())).rejects.toMatchObject({
      provider: "slack",
      message: "[slack] Missing webhookUrl"
    })
  })

  it("documents current behavior: fetch rejections propagate unwrapped", async () => {
    stubRejectedFetch()
    await expect(new SlackProvider({ enabled: true, webhookUrl: url }).send(legacyPayload())).rejects.toThrow(
      TypeError
    )
  })

  it("testConnection reflects delivery result", async () => {
    stubFetch([{ status: 200 }])
    expect(await new SlackProvider({ enabled: true, webhookUrl: url }).testConnection()).toEqual({ ok: true })
    stubFetch([{ status: 400 }])
    const bad = await new SlackProvider({ enabled: true, webhookUrl: url }).testConnection()
    expect(bad.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// TelegramProvider
// ---------------------------------------------------------------------------

describe("TelegramProvider", () => {
  const cfg = { enabled: true, botToken: "TOK123", chatId: "-10042" }

  it("POSTs chat_id, HTML text and parse_mode to the bot API sendMessage endpoint", async () => {
    const calls = stubFetch([{ status: 200 }])
    await new TelegramProvider(cfg).send(legacyPayload())

    expect(String(calls[0]!.input)).toBe("https://api.telegram.org/botTOK123/sendMessage")
    expect(calls[0]!.init?.method).toBe("POST")
    const body = parseBody(calls[0])
    expect(body.chat_id).toBe("-10042")
    expect(body.parse_mode).toBe("HTML")
    expect(body.disable_web_page_preview).toBe(true)
    expect(typeof body.text).toBe("string")
  })

  it("escapes HTML in legacy title/message and appends crawl footer link", async () => {
    const calls = stubFetch([{ status: 200 }])
    await new TelegramProvider(cfg).send(legacyPayload({ title: "<b>Title</b>", message: "5 > 3 & < 6" }))
    const text = parseBody(calls[0]).text as string
    expect(text).toContain("&lt;b&gt;Title&lt;/b&gt;")
    expect(text).toContain("5 &gt; 3 &amp; &lt; 6")
    expect(text).toContain('<a href="https://example.com/crawls/abc">View crawl report</a>')
    expect(text).toContain("ID: abcdef12")
  })

  it("renders a full report with health score and stats when reportStats present", async () => {
    const calls = stubFetch([{ status: 200 }])
    await new TelegramProvider(cfg).send(legacyPayload({ reportStats: stats }))
    const text = parseBody(calls[0]).text as string
    expect(text).toContain("🟢 Crawl finished")
    expect(text).toContain("Health Score: 92%</b> — 100/110 URLs checked")
    expect(text).toContain("<b>2</b> <i>Broken</i>")
    expect(text).toContain("<b>3</b> <i>Changed</i>")
    expect(text).toContain("Avg: 250ms")
  })

  it("renders progress milestone with a 20-char bar for onCrawlProgress", async () => {
    const calls = stubFetch([{ status: 200 }])
    await new TelegramProvider(cfg).send({
      event: "onCrawlProgress",
      title: "progress",
      message: "Remaining: ~3 minutes",
      meta: { percent: 25, checked: 5, total: 20, broken: 0, changed: 1 }
    })
    const text = parseBody(calls[0]).text as string
    expect(text).toContain("Crawl 25% complete")
    expect(text).toContain("█".repeat(5) + "░".repeat(15))
    expect(text).toContain("<code>5/20</code> URLs checked")
    expect(text).toContain("Remaining: ~3 minutes")
  })

  it("throws NotificationError with status and response excerpt on non-ok", async () => {
    stubFetch([{ status: 401, body: '{"ok":false,"error_code":401,"description":"Unauthorized"}' }])
    await expect(new TelegramProvider(cfg).send(legacyPayload())).rejects.toMatchObject({
      name: "NotificationError",
      provider: "telegram",
      message: expect.stringContaining("[telegram] HTTP 401")
    })
  })

  it("documents current behavior: fetch rejections propagate unwrapped; throws on missing credentials", async () => {
    stubRejectedFetch()
    await expect(new TelegramProvider(cfg).send(legacyPayload())).rejects.toThrow(TypeError)
    await expect(new TelegramProvider({ enabled: true }).send(legacyPayload())).rejects.toMatchObject({
      provider: "telegram",
      message: "[telegram] Missing botToken or chatId"
    })
  })

  it("testConnection reflects delivery result", async () => {
    stubFetch([{ status: 200 }])
    expect(await new TelegramProvider(cfg).testConnection()).toEqual({ ok: true })
    stubFetch([{ status: 404, body: "not found" }])
    const bad = await new TelegramProvider(cfg).testConnection()
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain("[telegram]")
  })
})

// ---------------------------------------------------------------------------
// EmailProvider
// ---------------------------------------------------------------------------

describe("EmailProvider", () => {
  type SendMailFn = (mail: Record<string, unknown>) => Promise<unknown>

  function mockSendMail(impl: SendMailFn = async () => ({ messageId: "m-1" })) {
    const sendMail = vi.fn(impl)
    // Unchecked cast: nodemailer's Transporter surface is irrelevant to these tests.
    vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail } as unknown as ReturnType<
      typeof nodemailer.createTransport
    >)
    return sendMail
  }

  const cfg = {
    enabled: true,
    smtp: { host: "smtp.example.com", port: 465, secure: true, user: "u", pass: "p" },
    from: "crawl@example.com",
    to: ["a@example.com", "b@example.com"]
  }

  it("sends mail with joined recipients, subject prefix, text and generated HTML", async () => {
    const sendMail = mockSendMail()
    await new EmailProvider(cfg).send(legacyPayload({ meta: { pages: 42 } }))

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      auth: { user: "u", pass: "p" }
    })
    expect(sendMail).toHaveBeenCalledTimes(1)
    const mail = sendMail.mock.calls[0]![0]
    expect(mail.from).toBe("crawl@example.com")
    expect(mail.to).toBe("a@example.com, b@example.com")
    expect(mail.subject).toBe("[supacrawl] Crawl finished")
    expect(mail.text).toContain("All done")
    expect(mail.html).toContain("Crawl finished")
    expect(mail.html).toContain("All done")
    // meta table entry rendered into HTML
    expect(mail.html).toContain("pages")
    expect(mail.html).toContain("42")
  })

  it("prefers payload.htmlBody over generated HTML", async () => {
    const sendMail = mockSendMail()
    await new EmailProvider(cfg).send(legacyPayload({ htmlBody: "<h1>custom</h1>" }))
    expect(sendMail.mock.calls[0]![0].html).toBe("<h1>custom</h1>")
  })

  it("throws NotificationError for missing SMTP host, from address or recipients", async () => {
    mockSendMail()
    await expect(new EmailProvider({ ...cfg, smtp: {} }).send(legacyPayload())).rejects.toMatchObject({
      provider: "email",
      message: "[email] Missing SMTP host"
    })
    await expect(new EmailProvider({ ...cfg, from: "" }).send(legacyPayload())).rejects.toMatchObject({
      provider: "email",
      message: "[email] Missing from address"
    })
    await expect(new EmailProvider({ ...cfg, to: [] }).send(legacyPayload())).rejects.toMatchObject({
      provider: "email",
      message: "[email] No recipients"
    })
  })

  it("documents current behavior: sendMail failures propagate unwrapped", async () => {
    mockSendMail(async () => {
      throw new Error("SMTP handshake failed")
    })
    await expect(new EmailProvider(cfg).send(legacyPayload())).rejects.toThrow("SMTP handshake failed")
  })

  it("testConnection reports ok:false with the error message on failure", async () => {
    mockSendMail()
    expect(await new EmailProvider(cfg).testConnection()).toEqual({ ok: true })

    mockSendMail(async () => {
      throw new Error("connection refused")
    })
    const bad = await new EmailProvider(cfg).testConnection()
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain("connection refused")
  })
})

// ---------------------------------------------------------------------------
// Notifier orchestrator
// ---------------------------------------------------------------------------

describe("Notifier", () => {
  it("instantiates only the enabled providers, in declaration order", () => {
    const cfg = makeConfig()
    cfg.providers.slack = { enabled: true, webhookUrl: "https://s.example.com/hook" }
    cfg.providers.webhook = { enabled: true, url: "https://w.example.com" }
    expect(new Notifier(cfg).enabledProviders).toEqual(["slack", "webhook"])
  })

  it("isEventEnabled reflects configured events and defaults missing ones to false", () => {
    const notifier = new Notifier(makeConfig())
    expect(notifier.isEventEnabled("onCrawlComplete")).toBe(true)
    expect(notifier.isEventEnabled("onMojibakeDetected")).toBe(true)
    expect(notifier.isEventEnabled("onCrawlProgress")).toBe(false)
  })

  it("does not dispatch anything when the event is disabled", async () => {
    const calls = stubFetch([])
    const notifier = new Notifier(makeConfig({ onCrawlComplete: false }))
    await notifier.notify("onCrawlComplete", legacyPayload())
    expect(calls).toHaveLength(0)
  })

  it("dispatches to every configured provider for an enabled event", async () => {
    const calls = stubFetch([])
    const cfg = makeConfig()
    cfg.providers.slack = { enabled: true, webhookUrl: "https://s.example.com/hook" }
    cfg.providers.telegram = { enabled: true, botToken: "TOK", chatId: "42" }
    cfg.providers.webhook = { enabled: true, url: "https://w.example.com" }
    await new Notifier(cfg).notify("onCrawlComplete", legacyPayload())

    expect(calls.map((c) => String(c.input))).toEqual([
      "https://s.example.com/hook",
      "https://api.telegram.org/botTOK/sendMessage",
      "https://w.example.com"
    ])
  })

  it("one failing channel does not prevent others and notify() still resolves", async () => {
    let n = 0
    const calls: RecordedRequest[] = []
    const fake = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      calls.push({ input: input as string | URL, init })
      n++
      return new Response(null, { status: n === 1 ? 500 : 200 }) // slack fails, telegram succeeds
    }
    vi.stubGlobal("fetch", vi.fn(fake))

    const cfg = makeConfig()
    cfg.providers.slack = { enabled: true, webhookUrl: "https://s.example.com/hook" }
    cfg.providers.telegram = { enabled: true, botToken: "TOK", chatId: "42" }

    await expect(new Notifier(cfg).notify("onCrawlFailure", legacyPayload())).resolves.toBeUndefined()
    expect(calls).toHaveLength(2)
    expect(console.error).toHaveBeenCalledWith("[notifier] slack failed:", expect.stringContaining("[slack] HTTP 500"))
  })

  it("configFromUserSettings maps settings onto a NotificationsConfig", () => {
    const cfg = Notifier.configFromUserSettings({
      userId: "u1",
      slack: { enabled: true, webhookUrl: "https://s" },
      telegram: { enabled: false },
      email: { enabled: true, smtp: { host: "smtp.x" }, from: "me@x.com", to: ["you@x.com"] },
      webhook: { enabled: true, url: "https://w", secret: "sec" },
      enabledEvents: {
        onCrawlFailure: true,
        onContentChange: false,
        onSslExpiring: true,
        onCrawlComplete: true,
        onMojibakeDetected: false,
        onLlmGarbageDetected: false,
        onCrawlProgress: false,
        onMonitorDown: true,
        onMonitorRecovery: false,
        onMonitorSlow: false
      },
      updatedAt: "2026-01-01T00:00:00Z"
    })

    expect(cfg.providers.slack).toEqual({ enabled: true, webhookUrl: "https://s" })
    expect(cfg.providers.telegram).toEqual({ enabled: false, botToken: undefined, chatId: undefined })
    expect(cfg.providers.email).toMatchObject({
      enabled: true,
      smtp: { host: "smtp.x", port: undefined, secure: undefined, user: undefined, pass: undefined },
      from: "me@x.com",
      to: ["you@x.com"]
    })
    expect(cfg.providers.webhook).toEqual({ enabled: true, url: "https://w", secret: "sec" })
    expect(cfg.events.onContentChange).toBe(false)
    expect(cfg.events.onSslExpiring).toBe(true)
    expect(cfg.events.onMonitorRecovery).toBe(false)
  })

  it("configFromJob maps job flags and defaults missing providers/events safely", () => {
    const cfg = Notifier.configFromJob({
      notifyOnComplete: true,
      notifyOnFailure: true,
      notifyOnChange: false,
      notifyOnMojibake: false,
      notifyOnLlmGarbage: false,
      notifySslExpiring: true,
      notifyOnProgress: false,
      notificationProviders: null
    })

    expect(cfg.providers.slack.enabled).toBe(false)
    expect(cfg.providers.telegram.enabled).toBe(false)
    expect(cfg.providers.email.enabled).toBe(false)
    expect(cfg.providers.webhook.enabled).toBe(false)
    expect(cfg.providers.email.to).toEqual([])
    expect(cfg.events).toEqual({
      onCrawlFailure: true,
      onContentChange: false,
      onSslExpiring: true,
      onCrawlComplete: true,
      onMojibakeDetected: false,
      onLlmGarbageDetected: false,
      onCrawlProgress: false,
      onMonitorDown: true,
      onMonitorRecovery: true,
      onMonitorSlow: true
    })

    const providers: JobNotificationProviders = {
      telegram: { enabled: true, botToken: "B", chatId: "C" }
    }
    const withProviders = Notifier.configFromJob({
      notifyOnComplete: true,
      notifyOnFailure: true,
      notifyOnChange: false,
      notifyOnMojibake: false,
      notifyOnLlmGarbage: false,
      notifySslExpiring: false,
      notifyOnProgress: false,
      notificationProviders: providers
    })
    expect(withProviders.providers.telegram).toEqual({ enabled: true, botToken: "B", chatId: "C" })
    expect(withProviders.providers.slack.enabled).toBe(false)
  })
})
