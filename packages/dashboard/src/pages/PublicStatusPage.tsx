import { useCallback, useEffect, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import { usePageTitle } from "@/lib/usePageTitle"
import { api, type PublicStatusPageData, type PublicStatusMonitor } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import HeartbeatBar from "@/components/HeartbeatBar"
import { getInitialTheme, applyTheme } from "@/lib/theme"
import { Moon, Sun } from "lucide-react"

function formatRt(ms: number | null): string {
  if (ms === null) return "—"
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function formatUptime(v: number | null): string {
  if (v === null) return "—"
  return `${v.toFixed(1)}%`
}

function StatusDot({ status }: { status: string | null }) {
  if (status === "up") return <span className="inline-block h-3 w-3 rounded-sm bg-success shrink-0" />
  if (status === "down") return <span className="inline-block h-3 w-3 rounded-sm bg-destructive shrink-0" />
  if (status === "maintenance") return <span className="inline-block h-3 w-3 rounded-sm bg-warning shrink-0" />
  return <span className="inline-block h-3 w-3 rounded-sm bg-muted-foreground/20 shrink-0" />
}

function MonitorRow({ monitor, showResponseTimes }: { monitor: PublicStatusMonitor; showResponseTimes: boolean }) {
  return (
    <div className="rounded-sm border bg-card p-4">
      <div className="flex items-start gap-3">
        <StatusDot status={monitor.currentStatus} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <a
              href={monitor.url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate font-mono text-sm font-medium hover:underline"
            >
              {monitor.name}
            </a>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {formatUptime(monitor.uptime30d)} uptime
            </span>
          </div>
          <p className="truncate font-mono text-xs text-muted-foreground">{monitor.url}</p>
        </div>
      </div>

      <div className="mt-3">
        <HeartbeatBar heartbeats={monitor.recentHeartbeats} ticks={90} />
      </div>

      {showResponseTimes && (
        <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
          <span>Avg: {formatRt(monitor.avgResponseTimeMs)}</span>
          <span>Max: {formatRt(monitor.maxResponseTimeMs)}</span>
        </div>
      )}
    </div>
  )
}

function SummaryBanner({ summary }: { summary: PublicStatusPageData["summary"] }) {
  if (summary === "operational") {
    return (
      <div className="rounded-sm border border-success/40 border-l-4 border-l-success bg-success/10 p-4 text-center">
        <p className="font-mono text-lg font-bold text-success">
          ✅ All Systems Operational
        </p>
        <p className="mt-1 font-mono text-sm text-muted-foreground">
          All monitored services are running normally.
        </p>
      </div>
    )
  }
  if (summary === "degraded") {
    return (
      <div className="rounded-sm border border-warning/40 border-l-4 border-l-warning bg-warning/10 p-4 text-center">
        <p className="font-mono text-lg font-bold text-warning">
          ⚠️ Degraded Performance
        </p>
        <p className="mt-1 font-mono text-sm text-muted-foreground">
          Some services are experiencing issues.
        </p>
      </div>
    )
  }
  return (
    <div className="rounded-sm border border-destructive/40 border-l-4 border-l-destructive bg-destructive/10 p-4 text-center">
      <p className="font-mono text-lg font-bold text-destructive">
        🔴 Major Outage
      </p>
      <p className="mt-1 font-mono text-sm text-muted-foreground">
        All monitored services are currently down.
      </p>
    </div>
  )
}

export default function PublicStatusPage() {
  const { slug } = useParams<{ slug: string }>()
  const [data, setData] = useState<PublicStatusPageData | null>(null)
  usePageTitle(data?.page.title ?? "Status Page")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(30)
  const [dark, setDark] = useState(() => getInitialTheme() === "dark")
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Dark mode toggle
  useEffect(() => {
    applyTheme(dark ? "dark" : "light")
  }, [dark])

  const fetchData = useCallback(async () => {
    if (!slug) return
    try {
      const result = await api.getPublicStatusPage(slug)
      setData(result)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [slug])

  // Initial fetch
  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Auto-refresh every 30s
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    setCountdown(30)
    intervalRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          fetchData()
          return 30
        }
        return c - 1
      })
    }, 1000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchData])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-2xl space-y-4 px-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Status Page Not Found</h1>
          <p className="mt-2 text-muted-foreground">{error}</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="min-h-screen bg-background">
      {/* Theme toggle */}
      <div className="fixed right-4 top-4 z-10">
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 rounded-sm"
          onClick={() => setDark(!dark)}
          title={dark ? "Light mode" : "Dark mode"}
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>

      <div className="mx-auto max-w-2xl px-4 py-12">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight">{data.page.title}</h1>
          {data.page.description && (
            <p className="mt-2 text-muted-foreground">{data.page.description}</p>
          )}
        </div>

        {/* Summary banner */}
        <div className="mb-8">
          <SummaryBanner summary={data.summary} />
        </div>

        {/* Monitor list — grouped by groupName */}
        {(() => {
          const groups = new Map<string, PublicStatusMonitor[]>()
          for (const m of data.monitors) {
            const key = m.groupName?.trim() ? m.groupName.trim() : ""
            const list = groups.get(key) ?? []
            list.push(m)
            groups.set(key, list)
          }
          const entries = [...groups.entries()]
          return entries.map(([groupName, monitors]) => (
            <div key={groupName || "__ungrouped__"} className="space-y-3">
              {groupName && (
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {groupName}
                </h2>
              )}
              {monitors.map((m) => (
                <MonitorRow key={m.id} monitor={m} showResponseTimes={data.page.showResponseTimes} />
              ))}
            </div>
          ))
        })()}

        {/* Footer */}
        <div className="mt-12 text-center text-xs text-muted-foreground">
          <p>
            Last checked:{" "}
            {data.generatedAt
              ? new Date(data.generatedAt).toLocaleString()
              : "—"}
          </p>
          <p className="mt-1">
            Auto-refresh in {countdown}s
          </p>
          <p className="mt-4 text-xs text-muted-foreground/60">
            Powered by SupaCrawl
          </p>
        </div>
      </div>
    </div>
  )
}