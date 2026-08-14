import { useEffect, useState } from "react"
import { usePageTitle } from "@/lib/usePageTitle"
import { useSession } from "@/lib/auth-client"
import { api, type UserNotificationSettings } from "@/lib/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Bell, Loader2, Save, ShieldAlert } from "lucide-react"
import { isPushEnabled, setPushEnabled } from "@/lib/useCrawlNotifications"
import { toast } from "@/lib/use-toast"
import PageInfo from "@/components/PageInfo"
import settingsExplainer from "@/content/settings-explainer.md?raw"

interface Config {
  crawl: {
    delayMs: number
    maxConcurrency: number
    timeoutMs: number
    userAgent: string
    respectRobotsTxt: boolean
    maxUrls: number
    retryOnTransientError: boolean
    maxRetries: number
    detectMojibake?: boolean
  }
  checks: {
    ssl: { enabled: boolean; warnDays: number }
    contentDiff: boolean
    responseTime: { warnMs: number }
  }
  notifications?: unknown
  schedule?: string
}

interface NotifiersInfo {
  enabled: string[]
  config: {
    providers: Record<string, { enabled: boolean }>
  }
}

const EVENT_LABELS: Record<string, string> = {
  onCrawlFailure: "Crawl failure",
  onContentChange: "Content change detected",
  onSslExpiring: "SSL certificate expiring",
  onCrawlComplete: "Crawl completed",
  onMojibakeDetected: "Mojibake (encoding issues)",
  onLlmGarbageDetected: "LLM Garbage (AI prompt artifacts)",
  onCrawlProgress: "Crawl progress",
  onMonitorDown: "Monitor went down",
  onMonitorRecovery: "Monitor recovered"
}

const PROVIDER_LABELS: Record<string, string> = {
  slack: "Slack",
  telegram: "Telegram",
  email: "Email (SMTP)",
  webhook: "Webhook"
}

const DEFAULT_EVENTS: UserNotificationSettings["enabledEvents"] = {
  onCrawlFailure: false,
  onContentChange: false,
  onSslExpiring: false,
  onCrawlComplete: false,
  onMojibakeDetected: false,
  onLlmGarbageDetected: false,
  onCrawlProgress: false,
  onMonitorDown: false,
  onMonitorRecovery: false
}

export default function SettingsPage() {
  usePageTitle("Settings")
  const { data: sessionData } = useSession()
  const role = (sessionData?.user as { role?: string } | undefined)?.role
  const isAdmin = role === "admin"

  // User notification preferences
  const [notifSettings, setNotifSettings] = useState<UserNotificationSettings | null>(null)
  const [notifLoading, setNotifLoading] = useState(true)
  const [notifSaving, setNotifSaving] = useState(false)
  const [notifError, setNotifError] = useState<string | null>(null)

  // Global notifier info (read-only)
  const [notifiersInfo, setNotifiersInfo] = useState<NotifiersInfo | null>(null)

  // Admin server config
  const [config, setConfig] = useState<Config | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [allowRegistration, setAllowRegistration] = useState(false)
  const [regToggling, setRegToggling] = useState(false)
  const [crawlSaving, setCrawlSaving] = useState(false)
  const [crawlMaxUrls, setCrawlMaxUrls] = useState("")
  const [pushNotif, setPushNotif] = useState(() => {
    if (!("Notification" in window)) return false
    if (Notification.permission === "denied") return false
    return isPushEnabled()
  })

  // Map UserNotificationSettings events to our editable state
  const [enabledEvents, setEnabledEvents] = useState<UserNotificationSettings["enabledEvents"]>(DEFAULT_EVENTS)

  // Helper to toggle a provider on/off
  function toggleProvider(name: "slack" | "telegram" | "email" | "webhook", enabled: boolean) {
    setNotifSettings((prev) => {
      if (!prev) return prev
      return { ...prev, [name]: { ...prev[name], enabled } }
    })
  }

  useEffect(() => {
    loadNotifSettings()
    loadGlobalNotifiers()
    if (isAdmin) {
      loadAdminSettings()
    }
  }, [isAdmin])

  async function loadNotifSettings() {
    setNotifLoading(true)
    try {
      const s = await api.getUserNotifications()
      setNotifSettings(s)
      setEnabledEvents(s.enabledEvents)
      setNotifError(null)
    } catch (err) {
      setNotifError((err as Error).message)
    } finally {
      setNotifLoading(false)
    }
  }

  async function loadGlobalNotifiers() {
    try {
      const r = await api.getNotifiers()
      setNotifiersInfo(r as NotifiersInfo)
    } catch {
      // silently fail
    }
  }

  async function loadAdminSettings() {
    try {
      const c = await api.getSettings()
      setConfig(c as Config)
      setCrawlMaxUrls(String((c as Config).crawl.maxUrls))
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
    api.setupStatus().then((s) => setAllowRegistration(s.allowRegistration)).catch(() => {})
  }

  async function saveNotificationPrefs() {
    setNotifSaving(true)
    try {
      await api.updateUserNotifications({
        ...notifSettings ?? {
          slack: { enabled: false },
          telegram: { enabled: false },
          email: { enabled: false },
          webhook: { enabled: false }
        },
        enabledEvents
      })
      toast({ title: "Notification preferences saved", variant: "success" })
    } catch (err) {
      toast({ title: "Failed to save", description: (err as Error).message, variant: "destructive" })
    } finally {
      setNotifSaving(false)
    }
  }

  async function toggleRegistration() {
    setRegToggling(true)
    try {
      const next = !allowRegistration
      await api.setRegistration(next)
      setAllowRegistration(next)
      toast({ title: next ? "Registration opened" : "Registration closed", variant: "success" })
    } catch {
      toast({ title: "Failed to toggle registration", variant: "destructive" })
    }
    setRegToggling(false)
  }

  async function saveCrawlSettings() {
    if (!config) return
    setCrawlSaving(true)
    try {
      const maxUrlsNum = Number(crawlMaxUrls)
      if (!maxUrlsNum || maxUrlsNum < 1) {
        setError("Max URLs must be a positive number")
        setCrawlSaving(false)
        return
      }
      await api.updateSettings({
        ...config,
        crawl: { ...config.crawl, maxUrls: maxUrlsNum }
      })
      setConfig({ ...config, crawl: { ...config.crawl, maxUrls: maxUrlsNum } })
      toast({ title: "Crawler settings saved", variant: "success" })
    } catch (err) {
      setError((err as Error).message)
      toast({ title: "Failed to save settings", description: (err as Error).message, variant: "destructive" })
    } finally {
      setCrawlSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Configure your notification preferences and account settings
          </p>
        </div>
        <PageInfo title="Settings" content={settingsExplainer} className="h-8 w-8" />
      </div>

      {/* My Notification Preferences (admin-only — per-user notification channels are not exposed in the UI) */}
      {isAdmin && <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>My Notification Preferences</CardTitle>
              <CardDescription>Choose which crawl events you want to be notified about</CardDescription>
            </div>
            <Button size="sm" onClick={saveNotificationPrefs} disabled={notifSaving}>
              {notifSaving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
              Save
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {notifLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : notifError ? (
            <p className="text-sm text-destructive">{notifError}</p>
          ) : (
            <>
              <div className="space-y-2 text-sm">
                {Object.entries(EVENT_LABELS).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between rounded border p-3">
                    <span className="font-medium">{label}</span>
                    <Switch
                      checked={enabledEvents[key as keyof typeof enabledEvents]}
                      onCheckedChange={(v) =>
                        setEnabledEvents((prev) => ({ ...prev, [key]: v }))
                      }
                    />
                  </div>
                ))}
              </div>

              <div className="border-t pt-4">
                <p className="mb-2 text-sm font-medium text-foreground">Channels</p>
                <p className="mb-3 text-xs text-muted-foreground">
                  Choose which notification channels to receive alerts on. The admin must have
                  configured the channel first for it to work.
                </p>
                <div className="space-y-2">
                  {Object.keys(PROVIDER_LABELS).map((name) => {
                    const key = name as keyof UserNotificationSettings
                    const provider = notifSettings?.[key] as { enabled?: boolean } | undefined
                    const isEnabled = provider?.enabled ?? false
                    const isEmail = name === "email"
                    const userEmail = sessionData?.user?.email
                    return (
                      <div key={name} className="flex items-center justify-between rounded border p-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">{PROVIDER_LABELS[name]}</span>
                          {isEmail && isEnabled && userEmail && (
                            <span className="text-xs text-muted-foreground">{userEmail}</span>
                          )}
                        </div>
                        <Switch
                          checked={isEnabled}
                          onCheckedChange={(v) => toggleProvider(key as "slack" | "telegram" | "email" | "webhook", v)}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>

              {notifiersInfo && notifiersInfo.enabled.length > 0 && (
                <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                  <p className="mb-1 font-medium text-foreground">Available notification channels (configured by admin)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {notifiersInfo.enabled.map((name) => (
                      <Badge key={name} variant="secondary">{PROVIDER_LABELS[name] ?? name}</Badge>
                    ))}
                  </div>
                  <p className="mt-2">Notifications will be sent through all available channels.</p>
                </div>
              )}

              {(!notifiersInfo || notifiersInfo.enabled.length === 0) && (
                <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                  No global notification channels are configured yet. Ask an admin to set up Slack, Telegram, or Email in the
                  {" "}<strong>Notifications</strong> section.
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>}

      {/* Browser Push Notifications */}
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>Browser push notifications when a crawl finishes</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4" />
              <Label htmlFor="pushNotif">Push notifications</Label>
            </div>
            <p className="text-sm text-muted-foreground">
              Get notified when a crawl completes, even if you're on another tab
            </p>
          </div>
          <Switch
            id="pushNotif"
            checked={pushNotif}
            onCheckedChange={async (v) => {
              if (!v) {
                setPushNotif(false)
                setPushEnabled(false)
                return
              }
              if (!("Notification" in window)) return
              if (Notification.permission === "default") {
                const result = await Notification.requestPermission()
                if (result !== "granted") return
              }
              setPushNotif(true)
              setPushEnabled(true)
            }}
          />
        </CardContent>
      </Card>

      {/* Admin-only sections */}
      {isAdmin && (
        <>
          <div className="flex items-center gap-2 pt-4 text-sm text-muted-foreground">
            <ShieldAlert className="h-4 w-4" />
            <span className="font-medium">Admin Settings</span>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>User Registration</CardTitle>
              <CardDescription>Allow new users to sign up on the login page</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="registration">Allow registration</Label>
                <p className="text-sm text-muted-foreground">
                  When enabled, a "Create account" link appears on the sign-in page
                </p>
              </div>
              <Switch id="registration" checked={allowRegistration} onCheckedChange={toggleRegistration} disabled={regToggling} />
            </CardContent>
          </Card>

          {config ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Crawler</CardTitle>
                  <CardDescription>How requests are made (DDoS-safe)</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <Field label="Delay (ms)" value={String(config.crawl.delayMs)} />
                  <Field label="Max concurrency" value={String(config.crawl.maxConcurrency)} />
                  <Field label="Timeout (ms)" value={String(config.crawl.timeoutMs)} />
                  <div>
                    <Label>Max URLs per crawl</Label>
                    <div className="mt-1 flex gap-2">
                      <Input
                        type="number"
                        min={1}
                        value={crawlMaxUrls}
                        onChange={(e) => setCrawlMaxUrls(e.target.value)}
                        className="flex-1"
                      />
                      <Button size="sm" onClick={saveCrawlSettings} disabled={crawlSaving}>
                        {crawlSaving ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  </div>
                  <Field label="User-Agent" value={config.crawl.userAgent} className="md:col-span-2" />
                  <div className="flex items-center gap-2">
                    <Label>Respect robots.txt</Label>
                    <Badge variant={config.crawl.respectRobotsTxt ? "success" : "outline"}>
                      {config.crawl.respectRobotsTxt ? "on" : "off"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label>Retry on transient error</Label>
                    <Badge variant={config.crawl.retryOnTransientError ? "success" : "outline"}>
                      {config.crawl.retryOnTransientError ? "on" : "off"}
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Checks</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="flex items-center gap-2">
                    <Label>Content diff</Label>
                    <Badge variant={config.checks.contentDiff ? "success" : "outline"}>
                      {config.checks.contentDiff ? "on" : "off"}
                    </Badge>
                  </div>
                  <Field label="Response time warn (ms)" value={String(config.checks.responseTime.warnMs)} />
                  <div className="flex items-center gap-2">
                    <Label>SSL check</Label>
                    <Badge variant={config.checks.ssl.enabled ? "success" : "outline"}>
                      {config.checks.ssl.enabled ? "on" : "off"}
                    </Badge>
                  </div>
                  <Field label="SSL warn (days)" value={String(config.checks.ssl.warnDays)} />
                </CardContent>
              </Card>

              {config.schedule && (
                <Card>
                  <CardHeader>
                    <CardTitle>Schedule</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <code className="rounded bg-muted px-2 py-1 text-sm">{config.schedule}</code>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-64 w-full" />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  className
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      <Input readOnly value={value} className="mt-1" />
    </div>
  )
}
