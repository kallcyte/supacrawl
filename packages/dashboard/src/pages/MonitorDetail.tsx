import { useCallback, useEffect, useState } from "react"
import { usePageTitle } from "@/lib/usePageTitle"
import { useNavigate, useParams } from "react-router-dom"
import { api, type Heartbeat, type Monitor, type MonitorStats } from "@/lib/api"
import { useSession } from "@/lib/auth-client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table"
import { formatDate } from "@/lib/utils"
import { ArrowLeft, Loader2, Pause, Play, Pencil, Trash2 } from "lucide-react"
import HeartbeatBar from "@/components/HeartbeatBar"
import ResponseTimeChart from "@/components/ResponseTimeChart"
import AddMonitorDialog from "@/components/AddMonitorDialog"
import ConfirmDialog from "@/components/ConfirmDialog"
import { toast } from "@/lib/use-toast"
import PageInfo from "@/components/PageInfo"
import monitorDetailExplainer from "@/content/monitor-detail-explainer.md?raw"

type Range = "24h" | "7d" | "30d"

const RANGES: { value: Range; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" }
]

function UptimeCard({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold">{value === null ? "–" : `${value.toFixed(1)}%`}</p>
    </div>
  )
}

export default function MonitorDetailPage() {
  usePageTitle("Monitor Detail")
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: sessionData } = useSession()
  const isAdmin = (sessionData?.user as { role?: string } | undefined)?.role === "admin"

  const [monitor, setMonitor] = useState<Monitor | null>(null)
  const [stats, setStats] = useState<MonitorStats | null>(null)
  const [running, setRunning] = useState(false)
  const [heartbeats, setHeartbeats] = useState<Heartbeat[]>([])
  const [range, setRange] = useState<Range>("24h")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [toggling, setToggling] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    try {
      const [detail, hb] = await Promise.all([
        api.getMonitor(id),
        api.getMonitorHeartbeats(id, range)
      ])
      setMonitor(detail.monitor)
      setStats(detail.stats)
      setRunning(detail.running)
      setHeartbeats(hb.heartbeats)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [id, range])

  useEffect(() => {
    load()
    const i = setInterval(load, 15000)
    return () => clearInterval(i)
  }, [load])

  async function handleUpdate(data: Partial<Monitor>) {
    if (!monitor) return
    try {
      await api.updateMonitor(monitor.id, data)
      setEditOpen(false)
      await load()
      toast({ title: "Monitor updated", variant: "success" })
    } catch (err) {
      toast({ title: "Failed to update monitor", description: (err as Error).message, variant: "destructive" })
      throw err
    }
  }

  async function handleToggle() {
    if (!monitor) return
    setToggling(true)
    try {
      if (monitor.enabled) await api.stopMonitor(monitor.id)
      else await api.startMonitor(monitor.id)
      await load()
      toast({ title: monitor.enabled ? "Monitor paused" : "Monitor started", variant: "success" })
    } catch (err) {
      toast({ title: "Action failed", description: (err as Error).message, variant: "destructive" })
    } finally {
      setToggling(false)
    }
  }

  async function confirmDelete() {
    if (!monitor) return
    setDeleting(true)
    try {
      await api.deleteMonitor(monitor.id)
      toast({ title: "Monitor deleted", variant: "success" })
      navigate("/monitors")
    } catch (err) {
      toast({ title: "Failed to delete monitor", description: (err as Error).message, variant: "destructive" })
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!monitor) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">{error ?? "Monitor not found"}</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/monitors")}>
          <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back to monitors
        </Button>
      </div>
    )
  }

  const currentStatus = heartbeats.length > 0 ? heartbeats[heartbeats.length - 1].status : null

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/monitors")} title="Back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{monitor.name}</h1>
              <Badge
                variant={
                  monitor.enabled
                    ? currentStatus === "down"
                      ? "destructive"
                      : "success"
                    : "secondary"
                }
              >
                {!monitor.enabled
                  ? "Paused"
                  : currentStatus === "down"
                    ? "DOWN"
                    : currentStatus === "up"
                      ? "UP"
                      : "PENDING"}
              </Badge>
              <Badge variant="outline" className="capitalize">{monitor.type}</Badge>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{monitor.url}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PageInfo title="Monitor Detail" content={monitorDetailExplainer} className="h-8 w-8" />
          {isAdmin && (
            <>
              <Button variant="outline" size="sm" onClick={handleToggle} disabled={toggling}>
                {toggling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : monitor.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {monitor.enabled ? "Pause" : "Resume"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
              </Button>
              <Button variant="outline" size="sm" className="text-destructive" onClick={() => setConfirmingDelete(true)}>
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <UptimeCard label="24h uptime" value={stats?.uptime24h ?? null} />
        <UptimeCard label="7d uptime" value={stats?.uptime7d ?? null} />
        <UptimeCard label="30d uptime" value={stats?.uptime30d ?? null} />
        <UptimeCard label="365d uptime" value={stats?.uptime365d ?? null} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Card className="flex-1">
          <CardHeader>
            <CardTitle className="text-sm">Heartbeat (last 90 checks)</CardTitle>
            <CardDescription>Green = up, red = down, gray = no data</CardDescription>
          </CardHeader>
          <CardContent>
            <HeartbeatBar heartbeats={heartbeats} className="py-1" />
          </CardContent>
        </Card>
        <div className="inline-flex rounded-md border">
          {RANGES.map((r) => (
            <button
              key={r.value}
              className={`px-3 py-2 text-xs font-medium transition-colors ${range === r.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
              onClick={() => setRange(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Response time</CardTitle>
          <CardDescription>
            Response times over the selected period (threshold {monitor.acceptedResponseTimeMs}ms)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponseTimeChart
            heartbeats={heartbeats}
            acceptedResponseTimeMs={monitor.acceptedResponseTimeMs}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Heartbeat log</CardTitle>
          <CardDescription>Recent checks for the selected period</CardDescription>
        </CardHeader>
        <CardContent>
          {heartbeats.length === 0 ? (
            <p className="text-sm text-muted-foreground">No checks recorded in this period.</p>
          ) : (
            <div className="max-h-80 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Response time</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead className="text-right">Checked at</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...heartbeats].reverse().map((hb) => (
                    <TableRow key={hb.id}>
                      <TableCell>
                        <Badge variant={hb.status === "up" ? "success" : hb.status === "down" ? "destructive" : "secondary"}>
                          {hb.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {hb.responseTimeMs != null ? `${hb.responseTimeMs}ms` : "–"}
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                        {hb.message ?? "–"}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {formatDate(hb.checkedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AddMonitorDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        onSubmit={handleUpdate}
        initial={monitor}
      />

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="Delete monitor?"
        description="This will permanently remove the monitor and all its heartbeat history. This action cannot be undone."
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
