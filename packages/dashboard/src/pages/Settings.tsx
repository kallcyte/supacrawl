import { useEffect, useState } from "react"
import { api, ApiError } from "@/lib/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { X, Plus, Loader2, Bell, ChevronRight } from "lucide-react"
import { isPushEnabled, setPushEnabled } from "@/lib/useCrawlNotifications"

interface SitemapEntry {
  url: string
  enabled: boolean
}

interface Config {
  sitemaps: SitemapEntry[]
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
  const [newSitemap, setNewSitemap] = useState("")
  const [addingSitemap, setAddingSitemap] = useState(false)
  const [removingSitemap, setRemovingSitemap] = useState<string | null>(null)
  const [togglingSitemap, setTogglingSitemap] = useState<string | null>(null)
  const [treeData, setTreeData] = useState<Record<string, import("@/lib/api").SitemapTreeNode>>({})
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
    ;(async () => {
      await loadSettings()
      if (!config) return
      const trees: Record<string, import("@/lib/api").SitemapTreeNode> = {}
      for (const s of config.sitemaps) {
        try {
          trees[s.url] = await api.discoverSitemapTree(s.url)
        } catch { /* ignore */ }
      }
      setTreeData(trees)
    })()
    api.setupStatus().then((s) => setAllowRegistration(s.allowRegistration)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!config) return
    ;(async () => {
      const trees: Record<string, import("@/lib/api").SitemapTreeNode> = { ...treeData }
      for (const s of config.sitemaps) {
        if (trees[s.url]) continue
        try {
          trees[s.url] = await api.discoverSitemapTree(s.url)
        } catch { /* ignore */ }
      }
      setTreeData(trees)
    })()
  }, [config?.sitemaps.length])

  async function toggleRegistration() {
    setRegToggling(true)
    try {
      const next = !allowRegistration
      await api.setRegistration(next)
      setAllowRegistration(next)
    } catch {}
    setRegToggling(false)
  }

  async function handleAddSitemap() {
    if (!newSitemap) return
    setAddingSitemap(true)
    try {
      const res = await api.addSitemap(newSitemap)
      setConfig((prev) => prev ? { ...prev, sitemaps: res.sitemaps } : prev)
      setNewSitemap("")
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { error?: string }) : null
      setError(body?.error ?? (err as Error).message)
    } finally {
      setAddingSitemap(false)
    }
  }

  async function handleRemoveSitemap(url: string) {
    setRemovingSitemap(url)
    try {
      const res = await api.removeSitemap(url)
      setConfig((prev) => prev ? { ...prev, sitemaps: res.sitemaps } : prev)
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { error?: string }) : null
      setError(body?.error ?? (err as Error).message)
    } finally {
      setRemovingSitemap(null)
    }
  }

  async function handleToggleSitemap(url: string) {
    setTogglingSitemap(url)
    try {
      const res = await api.toggleSitemap(url)
      setConfig((prev) => prev ? { ...prev, sitemaps: res.sitemaps } : prev)
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { error?: string }) : null
      setError(body?.error ?? (err as Error).message)
    } finally {
      setTogglingSitemap(null)
    }
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
          <CardTitle>Sitemaps</CardTitle>
          <CardDescription>Sources of URLs to crawl</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              type="url"
              value={newSitemap}
              onChange={(e) => setNewSitemap(e.target.value)}
              placeholder="https://example.com/sitemap.xml"
              onKeyDown={(e) => e.key === "Enter" && handleAddSitemap()}
            />
            <Button onClick={handleAddSitemap} disabled={!newSitemap || addingSitemap}>
              {addingSitemap ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add
            </Button>
          </div>
          <div className="space-y-1">
            {config.sitemaps.map((s) => (
              <div key={s.url}>
                <div className="flex items-center justify-between rounded border bg-muted/40 px-3 py-2">
                  <div className="flex items-center gap-3 truncate">
                    <Switch
                      checked={s.enabled}
                      disabled={togglingSitemap === s.url}
                      onCheckedChange={() => handleToggleSitemap(s.url)}
                    />
                    <a href={s.url} target="_blank" className="truncate font-mono text-sm">{s.url}</a>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-2 h-6 w-6 shrink-0"
                    onClick={() => handleRemoveSitemap(s.url)}
                    disabled={removingSitemap === s.url}
                  >
                    {removingSitemap === s.url ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <X className="h-3 w-3" />
                    )}
                  </Button>
                </div>
                {treeData[s.url] && treeData[s.url].children.length > 0 && (
                  <div className="ml-6 border-l pl-3 pt-1">
                    <SitemapTreeItems
                      nodes={treeData[s.url].children}
                      configSitemaps={config.sitemaps}
                      onToggle={async (childUrl) => {
                        const exists = config.sitemaps.find((x) => x.url === childUrl)
                        const res = exists
                          ? await api.removeSitemap(childUrl)
                          : await api.addSitemap(childUrl)
                        setConfig((prev) => prev ? { ...prev, sitemaps: res.sitemaps } : prev)
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
            {config.sitemaps.length === 0 && (
              <p className="text-sm text-muted-foreground">No sitemaps configured yet.</p>
            )}
          </div>
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

function SitemapTreeItems({
  nodes,
  configSitemaps,
  onToggle
}: {
  nodes: import("@/lib/api").SitemapTreeNode[]
  configSitemaps: SitemapEntry[]
  onToggle: (url: string) => void
}) {
  return (
    <div className="space-y-1">
      {nodes.map((node) => {
        const inConfig = configSitemaps.find((s) => s.url === node.url)
        return (
          <div key={node.url}>
            <div className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/30">
              {inConfig ? (
                <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => onToggle(node.url)}>
                  Remove
                </Button>
              ) : (
                <Button variant="default" size="sm" className="h-6 px-2 text-xs" onClick={() => onToggle(node.url)}>
                  Add
                </Button>
              )}
              <span className="truncate font-mono text-xs">{node.url}</span>
              <span className="shrink-0 text-xs text-muted-foreground">({node.leafCount})</span>
            </div>
            {node.children.length > 0 && (
              <div className="ml-4 border-l pl-2">
                <SitemapTreeItems nodes={node.children} configSitemaps={configSitemaps} onToggle={onToggle} />
              </div>
            )}
          </div>
        )
      })}
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
