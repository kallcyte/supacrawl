import { useEffect, useState } from "react"
import { api, type CrawlRecord } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2 } from "lucide-react"

interface Progress {
  crawlId: string
  total: number
  checked: number
  broken: number
  changed: number
  skipped: number
  currentUrl?: string
  status: "running" | "completed" | "failed" | "pending"
  startedAt: string
  finishedAt?: string
}

export default function LiveProgress({ crawl }: { crawl?: CrawlRecord }) {
  const [progress, setProgress] = useState<Progress | null>(null)
  const [connected, setConnected] = useState(false)

  // Sync from parent crawl prop
  useEffect(() => {
    if (!crawl || crawl.status !== "running") return
    setProgress((prev) =>
      prev && prev.crawlId === crawl.id
        ? {
            ...prev,
            total: crawl.urlsTotal,
            checked: crawl.urlsChecked,
            broken: crawl.urlsBroken,
            changed: crawl.urlsChanged,
            skipped: crawl.urlsSkipped
          }
        : {
            crawlId: crawl.id,
            total: crawl.urlsTotal,
            checked: crawl.urlsChecked,
            broken: crawl.urlsBroken,
            changed: crawl.urlsChanged,
            skipped: crawl.urlsSkipped,
            status: "running",
            startedAt: crawl.startedAt
          }
    )
  }, [crawl])

  useEffect(() => {
    let ws: WebSocket | null = null
    let cancelled = false

    function connect() {
      if (cancelled) return
      const url = new URL("/api/ws/crawl/_all", window.location.href)
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
      ws = new WebSocket(url.toString())
      ws.onopen = () => setConnected(true)
      ws.onclose = () => {
        setConnected(false)
        if (!cancelled) setTimeout(connect, 3000)
      }
      ws.onerror = () => ws?.close()
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === "progress") {
            setProgress(data as Progress)
          }
        } catch {
          /* ignore */
        }
      }
    }

    connect()
    return () => {
      cancelled = true
      ws?.close()
    }
  }, [])

  if (!progress || progress.status !== "running") {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Live progress</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No crawl in progress.</p>
        </CardContent>
      </Card>
    )
  }

  const pct = progress.total > 0 ? Math.floor((progress.checked / progress.total) * 100) : 0

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Crawl in progress
            {connected && (
              <span className="ml-2 h-2 w-2 rounded-full bg-emerald-500" title="WebSocket connected" />
            )}
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {progress.checked} / {progress.total} ({pct}%)
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span>Broken: {progress.broken}</span>
          <span>Changed: {progress.changed}</span>
          <span>Skipped: {progress.skipped}</span>
          {progress.currentUrl && (
            <span className="truncate font-mono" title={progress.currentUrl}>
              → {progress.currentUrl}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
