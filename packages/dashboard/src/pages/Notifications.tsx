import { useCallback, useEffect, useState } from "react"
import { Info, Loader2, Save } from "lucide-react"
import { api } from "@/lib/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import NotificationTutorial from "@/components/NotificationTutorial"
import { toast } from "@/lib/use-toast"

interface NotifiersInfo {
  enabled: string[]
  config: {
    providers: {
      slack: { enabled: boolean; webhookUrl?: string }
      telegram: { enabled: boolean; botToken?: string; chatId?: string }
      email: {
        enabled: boolean
        smtp?: { host?: string; port?: number; user?: string; pass?: string; secure?: boolean }
        from?: string
        to?: string[]
      }
      webhook: { enabled: boolean; url?: string; secret?: string }
    }
    events: Record<string, boolean>
  }
}

const PROVIDER_LABELS: Record<string, string> = {
  slack: "Slack",
  telegram: "Telegram",
  email: "Email (SMTP)",
  webhook: "Generic Webhook"
}

type NotifiersConfig = NotifiersInfo["config"]

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

export default function NotificationsPage() {
  const [info, setInfo] = useState<NotifiersInfo | null>(null)
  const [draft, setDraft] = useState<NotifiersConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; error?: string } | null>>({})
  const [tutorialProvider, setTutorialProvider] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await api.getNotifiers()
      setInfo(r as NotifiersInfo)
      setDraft((r as NotifiersInfo).config)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function saveProvider(name: string) {
    if (!draft) return
    setSaving(name)
    setError(null)
    try {
      const r = await api.updateNotifiers(draft)
      if (!r.ok) throw new Error(r.error ?? "Save failed")
      setInfo((prev) => prev ? { ...prev, config: deepClone(draft) } : prev)
      toast({ title: "Saved", description: `${PROVIDER_LABELS[name] ?? "Events"} configuration updated`, variant: "success" })
    } catch (err) {
      setError((err as Error).message)
      toast({ title: "Save failed", description: (err as Error).message, variant: "destructive" })
    } finally {
      setSaving(null)
    }
  }

  async function test(name: string) {
    setTestResult((p) => ({ ...p, [name]: null }))
    try {
      const r = await api.testNotifier(name)
      setTestResult((p) => ({ ...p, [name]: r }))
    } catch (err) {
      setTestResult((p) => ({ ...p, [name]: { ok: false, error: (err as Error).message } }))
    }
  }

  function patch<K extends keyof NotifiersConfig["providers"]>(name: K, patch: Partial<NotifiersConfig["providers"][K]>) {
    if (!draft) return
    setDraft({
      ...draft,
      providers: { ...draft.providers, [name]: { ...draft.providers[name], ...patch } }
    })
  }

  function patchEvents(diff: Record<string, boolean>) {
    if (!draft) return
    setDraft({ ...draft, events: { ...draft.events, ...diff } })
  }

  if (!info || !draft) {
    return <p className="text-sm text-muted-foreground">{error ?? "Loading..."}</p>
  }

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
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Events</CardTitle>
              <CardDescription>When to send a notification</CardDescription>
            </div>
            <Button size="sm" onClick={() => saveProvider("events")} disabled={saving === "events"}>
              {saving === "events" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {Object.entries(draft.events).map(([key, value]) => (
            <div key={key} className="flex items-center justify-between rounded border p-3">
              <span className="font-medium capitalize">{key.replace(/^on/, "").replace(/([A-Z])/g, " $1").trim()}</span>
              <Switch
                checked={value}
                onCheckedChange={(v) => patchEvents({ [key]: v })}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {Object.entries(PROVIDER_LABELS).map(([name, label]) => {
          const provider = draft.providers[name as keyof typeof draft.providers] as Record<string, unknown>
          const result = testResult[name]
          return (
            <Card key={name}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle>{label}</CardTitle>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground hover:text-foreground"
                      onClick={() => setTutorialProvider(name)}
                      title={`How to set up ${label}`}
                    >
                      <Info className="size-4" />
                    </Button>
                    <Switch
                      checked={provider.enabled as boolean}
                      onCheckedChange={(v) => patch(name as keyof NotifiersConfig["providers"], { enabled: v } as Record<string, boolean>)}
                    />
                  </div>
                  <Button size="sm" onClick={() => saveProvider(name)} disabled={saving === name}>
                    {saving === name ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    Save
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <ProviderEditor name={name} provider={provider} draft={draft} patch={patch} />
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
                    <span className={result.ok ? "text-xs text-emerald-600" : "text-xs text-destructive"}>
                      {result.ok ? "OK" : `Failed: ${result.error}`}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {tutorialProvider && (
        <NotificationTutorial
          provider={tutorialProvider}
          open={!!tutorialProvider}
          onOpenChange={(open) => { if (!open) setTutorialProvider(null) }}
        />
      )}
    </div>
  )
}

interface ProviderEditorProps {
  name: string
  provider: Record<string, unknown>
  draft: NotifiersConfig
  patch: (name: keyof NotifiersConfig["providers"], patch: Record<string, unknown>) => void
}

function ProviderEditor({ name, provider, draft, patch }: ProviderEditorProps) {
  const p = (k: string) => provider[k] as string | undefined

  if (name === "slack") {
    return (
      <FieldGroup>
        <Field label="Webhook URL">
          <Input value={p("webhookUrl") ?? ""} onChange={(e) => patch("slack", { webhookUrl: e.target.value })} />
        </Field>
      </FieldGroup>
    )
  }

  if (name === "telegram") {
    return (
      <FieldGroup>
        <Field label="Bot token">
          <Input value={p("botToken") ?? ""} onChange={(e) => patch("telegram", { botToken: e.target.value })} />
        </Field>
        <Field label="Chat ID">
          <Input value={p("chatId") ?? ""} onChange={(e) => patch("telegram", { chatId: e.target.value })} />
        </Field>
      </FieldGroup>
    )
  }

  if (name === "email") {
    const e = draft.providers.email
    return (
      <FieldGroup>
        <Field label="SMTP host">
          <Input value={e.smtp?.host ?? ""} onChange={(ev) => patch("email", { smtp: { ...e.smtp, host: ev.target.value } })} />
        </Field>
        <Field label="SMTP port">
          <Input type="number" value={e.smtp?.port ?? ""} onChange={(ev) => patch("email", { smtp: { ...e.smtp, port: ev.target.value ? Number(ev.target.value) : undefined } })} />
        </Field>
        <Field label="SMTP user">
          <Input value={e.smtp?.user ?? ""} onChange={(ev) => patch("email", { smtp: { ...e.smtp, user: ev.target.value } })} />
        </Field>
        <Field label="SMTP pass">
          <Input type="password" value={e.smtp?.pass ?? ""} onChange={(ev) => patch("email", { smtp: { ...e.smtp, pass: ev.target.value } })} />
        </Field>
        <Field label="From address">
          <Input value={e.from ?? ""} onChange={(ev) => patch("email", { from: ev.target.value })} />
        </Field>
        <Field label="To (comma separated)">
          <Input value={e.to?.join(", ") ?? ""} onChange={(ev) => patch("email", { to: ev.target.value.split(",").map(s => s.trim()).filter(Boolean) })} />
        </Field>
      </FieldGroup>
    )
  }

  if (name === "webhook") {
    return (
      <FieldGroup>
        <Field label="URL">
          <Input value={p("url") ?? ""} onChange={(e) => patch("webhook", { url: e.target.value })} />
        </Field>
        <Field label="HMAC secret">
          <Input value={p("secret") ?? ""} onChange={(e) => patch("webhook", { secret: e.target.value })} />
        </Field>
      </FieldGroup>
    )
  }

  return null
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

function FieldGroup({ children }: { children: React.ReactNode }) {
  return <div className="space-y-3">{children}</div>
}
