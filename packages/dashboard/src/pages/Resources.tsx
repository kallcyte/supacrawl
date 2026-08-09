import { useEffect, useState, useCallback } from "react"
import { api, type ResourceSnapshot } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Cpu, HardDrive, MemoryStick, RefreshCw, Clock, Database } from "lucide-react"
import MemoryUsageLine from "@/components/charts/MemoryUsageLine"
import CpuUsageLine from "@/components/charts/CpuUsageLine"
import DiskUsageLine from "@/components/charts/DiskUsageLine"

function formatUptime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const parts = []
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  parts.push(`${sec}s`)
  return parts.join(" ")
}

function rangeLabel(r: string): string {
  const labels: Record<string, string> = { "15m": "15 min", "1h": "1 hour", "6h": "6 hours", "24h": "24 hours" }
  return labels[r] ?? r
}

export default function ResourcesPage() {
  const [now, setNow] = useState<{
    rssMb: number; heapTotalMb: number; heapUsedMb: number
    externalMb: number; cpuUserMs: number; cpuSystemMs: number
    diskUsedMb: number
    uptime: number
  } | null>(null)
  const [snapshots, setSnapshots] = useState<ResourceSnapshot[]>([])
  const [range, setRange] = useState<"15m" | "1h" | "6h" | "24h">("1h")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [n, h] = await Promise.all([
        api.getResourceNow(),
        api.getResourceHistory(range)
      ])
      setNow(n)
      setSnapshots(h.snapshots)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    load()
    const i = setInterval(load, 5000)
    return () => clearInterval(i)
  }, [load])

  const memoryData = snapshots.map((s) => ({
    time: s.recordedAt,
    rss: s.rssMb,
    heapUsed: s.heapUsedMb,
    heapTotal: s.heapTotalMb
  }))

  const cpuData = snapshots.map((s) => ({
    time: s.recordedAt,
    value: s.cpuPercent
  }))

  const diskData = snapshots
    .filter((s) => s.diskUsedMb > 0)
    .map((s) => ({
      time: s.recordedAt,
      value: s.diskUsedMb
    }))

  const heapUsedPct = now?.heapTotalMb ? Math.round((now.heapUsedMb / now.heapTotalMb) * 100) : 0
  const heapColor = heapUsedPct > 85 ? "destructive" : heapUsedPct > 60 ? "default" : "secondary"

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Resources</h1>
          <p className="text-sm text-muted-foreground">
            Monitor supacrawl memory, CPU, and storage usage
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        {now ? `Uptime: ${formatUptime(now.uptime)}` : "—"}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">RSS Memory</CardTitle>
            <MemoryStick className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{now?.rssMb ?? "—"} MB</div>
            <p className="text-xs text-muted-foreground">Resident Set Size</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Heap Used</CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {now ? `${now.heapUsedMb} / ${now.heapTotalMb}` : "—"} MB
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Badge variant={heapColor} className="h-4 px-1 text-[10px]">
                {heapUsedPct}%
              </Badge>
              of heap allocated
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Data Directory</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{now?.diskUsedMb ?? "—"} MB</div>
            <p className="text-xs text-muted-foreground">DB + crawl artifacts</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">CPU Usage</CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{snapshots.length > 0 ? `${snapshots[snapshots.length - 1].cpuPercent}%` : "—"}</div>
            <p className="text-xs text-muted-foreground">
              {now ? `User ${now.cpuUserMs}ms · System ${now.cpuSystemMs}ms` : "Process CPU time"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Range:</span>
        {(["15m", "1h", "6h", "24h"] as const).map((r) => (
          <Button
            key={r}
            variant={range === r ? "default" : "outline"}
            size="sm"
            onClick={() => setRange(r)}
          >
            {rangeLabel(r)}
          </Button>
        ))}
      </div>

      {loading && snapshots.length === 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Memory Usage</CardTitle>
              <CardDescription>RSS, Heap Used, Heap Total</CardDescription>
            </CardHeader>
            <CardContent>
              <MemoryUsageLine data={memoryData} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>CPU Usage</CardTitle>
              <CardDescription>Process CPU percentage</CardDescription>
            </CardHeader>
            <CardContent>
              <CpuUsageLine data={cpuData} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Data Directory Size</CardTitle>
              <CardDescription>DB + crawl artifacts storage</CardDescription>
            </CardHeader>
            <CardContent>
              <DiskUsageLine data={diskData} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
