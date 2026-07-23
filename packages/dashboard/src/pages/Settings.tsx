import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Bell } from "lucide-react"
import { isPushEnabled, setPushEnabled } from "@/lib/useCrawlNotifications"
import { toast } from "@/lib/use-toast"

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
  }
  checks: {
    ssl: { enabled: boolean; warnDays: number }
    contentDiff: boolean
    responseTime: { warnMs: number }
  }
  schedule?: string
}

export default function SettingsPage() {
  const [config, setConfig] = useState<Config | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [allowRegistration, setAllowRegistration] = useState(false)
  const [regToggling, setRegToggling] = useState(false)
  const [pushNotif, setPushNotif] = useState(() => {
    if (!("Notification" in window)) return false
    if (Notification.permission === "denied") return false
    return isPushEnabled()
  })

  async function loadSettings() {
    try {
      const c = await api.getSettings()
      setConfig(c as Config)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    loadSettings()
    api.setupStatus().then((s) => setAllowRegistration(s.allowRegistration)).catch(() => {})
  }, [])

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

  if (error) {
    return (
      <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
        {error}
      </div>
    )
  }

  if (!config) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Active configuration (read-only here &mdash; edit supacrawl.config.json on disk)
        </p>
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

      <Card>
        <CardHeader>
          <CardTitle>Crawler</CardTitle>
          <CardDescription>How requests are made (DDoS-safe)</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Delay (ms)" value={String(config.crawl.delayMs)} />
          <Field label="Max concurrency" value={String(config.crawl.maxConcurrency)} />
          <Field label="Timeout (ms)" value={String(config.crawl.timeoutMs)} />
          <Field label="Max URLs per crawl" value={String(config.crawl.maxUrls)} />
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
