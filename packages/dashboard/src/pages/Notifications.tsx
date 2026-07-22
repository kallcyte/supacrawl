import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"

interface NotifiersInfo {
  enabled: string[]
  config: {
    providers: {
      slack: { enabled: boolean; webhookUrl?: string }
      telegram: { enabled: boolean; botToken?: string; chatId?: string }
      email: {
        enabled: boolean
        smtp?: { host?: string; port?: number; user?: string; pass?: string }
        from?: string
        to?: string[]
      }
      webhook: { enabled: boolean; url?: string; secret?: string }
    }
    events: {
      onCrawlFailure: boolean
      onContentChange: boolean
      onSslExpiring: boolean
      onCrawlComplete: boolean
    }
  }
}

const PROVIDER_LABELS: Record<string, string> = {
  slack: "Slack",
  telegram: "Telegram",
  email: "Email (SMTP)",
  webhook: "Generic Webhook"
}

export default function NotificationsPage() {
  const [info, setInfo] = useState<NotifiersInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; error?: string } | null>>({})

  async function load() {
    try {
      const r = await api.getNotifiers()
      setInfo(r as NotifiersInfo)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function test(name: string) {
    setTestResult((p) => ({ ...p, [name]: null }))
    try {
      const r = await api.testNotifier(name)
      setTestResult((p) => ({ ...p, [name]: r }))
    } catch (err) {
      setTestResult((p) => ({ ...p, [name]: { ok: false, error: (err as Error).message } }))
    }
  }

  if (!info) {
    return <p className="text-sm text-muted-foreground">{error ?? "Loading..."}</p>
  }

  const config = info.config

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
        <p className="text-sm text-muted-foreground">
          Configure where alerts are sent when crawls detect issues
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
          <CardDescription>When to send a notification</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {Object.entries(config.events).map(([key, value]) => (
            <div key={key} className="flex items-center justify-between rounded border p-2">
              <span>{key}</span>
              <Badge variant={value ? "success" : "outline"}>{value ? "on" : "off"}</Badge>
            </div>
          ))}
          <p className="mt-2 text-xs text-muted-foreground">
            To change events, edit the <code>notifications.events</code> section in
            <code> supacrawl.config.json</code> and restart the server.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {Object.entries(PROVIDER_LABELS).map(([name, label]) => {
          const provider = (config.providers as Record<string, { enabled: boolean }>)[name]
          const result = testResult[name]
          return (
            <Card key={name}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{label}</CardTitle>
                  <Badge variant={provider.enabled ? "success" : "outline"}>
                    {provider.enabled ? "enabled" : "disabled"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <ProviderDetails name={name} config={config} />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => test(name)}
                    disabled={!provider.enabled}
                  >
                    Send test
                  </Button>
                  {result && (
                    <span
                      className={
                        result.ok
                          ? "text-xs text-emerald-600"
                          : "text-xs text-destructive"
                      }
                    >
                      {result.ok ? "OK" : `Failed: ${result.error}`}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        To change provider credentials, edit <code>supacrawl.config.json</code> and restart the
        server.
      </p>
    </div>
  )
}

function ProviderDetails({ name, config }: { name: string; config: NotifiersInfo["config"] }) {
  if (name === "slack") {
    return (
      <div className="space-y-2 text-sm">
        <Label>Webhook URL</Label>
        <Input
          readOnly
          value={
            (config.providers.slack as { webhookUrl?: string }).webhookUrl ?? "(not set)"
          }
        />
      </div>
    )
  }
  if (name === "telegram") {
    const t = config.providers.telegram
    return (
      <div className="space-y-2 text-sm">
        <Label>Bot token</Label>
        <Input readOnly value={mask(t.botToken)} />
        <Label>Chat ID</Label>
        <Input readOnly value={t.chatId ?? "(not set)"} />
      </div>
    )
  }
  if (name === "email") {
    const e = config.providers.email
    return (
      <div className="space-y-2 text-sm">
        <Label>SMTP host</Label>
        <Input readOnly value={e.smtp?.host ?? "(not set)"} />
        <Label>From</Label>
        <Input readOnly value={e.from ?? "(not set)"} />
        <Label>To (comma separated)</Label>
        <Input readOnly value={e.to?.join(", ") ?? "(none)"} />
      </div>
    )
  }
  if (name === "webhook") {
    const w = config.providers.webhook
    return (
      <div className="space-y-2 text-sm">
        <Label>URL</Label>
        <Input readOnly value={w.url ?? "(not set)"} />
        <Label>HMAC secret</Label>
        <Input readOnly value={mask(w.secret)} />
      </div>
    )
  }
  return null
}

function mask(v: string | undefined): string {
  if (!v) return "(not set)"
  if (v.length <= 8) return "••••"
  return v.slice(0, 4) + "••••" + v.slice(-4)
}
