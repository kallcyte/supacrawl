import { useEffect, useState } from "react"
import { usePageTitle } from "@/lib/usePageTitle"
import { Link } from "react-router-dom"
import { api, type Monitor, type MonitorWithStatus } from "@/lib/api"
import { useSession } from "@/lib/auth-client"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { formatDate } from "@/lib/utils"
import {
  Plus, Pencil, Trash2, Activity, LayoutGrid, List
} from "lucide-react"
import monitorExplainer from "@/content/monitor-explainer.md?raw"
import PageInfo from "@/components/PageInfo"
import HeartbeatBar from "@/components/HeartbeatBar"
import AddMonitorDialog from "@/components/AddMonitorDialog"
import ConfirmDialog from "@/components/ConfirmDialog"
import { toast } from "@/lib/use-toast"

function StatusDot({ status }: { status: string | null }) {
  if (status === "up") return <span className="inline-block h-2.5 w-2.5 rounded-sm bg-success" title="Up" />
  if (status === "down") return <span className="inline-block h-2.5 w-2.5 rounded-sm bg-destructive" title="Down" />
  return <span className="inline-block h-2.5 w-2.5 rounded-sm bg-muted-foreground/30" title="No data" />
}

function formatUptime(v: number | null): string {
  if (v === null) return "–"
  return `${v.toFixed(1)}%`
}

function MonitorName({ m }: { m: MonitorWithStatus }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <StatusDot status={m.currentStatus} />
        <Link to={`/monitors/${m.id}`} className="truncate font-medium hover:underline">
          {m.name}
        </Link>
        <Badge variant="secondary" className="shrink-0 capitalize">{m.type}</Badge>
        {m.source === "crawl_job" && (
          <Badge variant="outline" className="shrink-0">crawl job</Badge>
        )}
      </div>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{m.url}</p>
    </div>
  )
}

function ResponseTime({ m }: { m: MonitorWithStatus }) {
  const ms = m.latestHeartbeat?.responseTimeMs
  if (ms == null) return <span className="text-muted-foreground">–</span>
  const slow = m.acceptedResponseTimeMs > 0 && ms > m.acceptedResponseTimeMs
  return (
    <span className={slow ? "font-medium text-amber-600" : ""}>
      {ms}ms
    </span>
  )
}

type View = "grid" | "table"

export default function MonitorsPage() {
  usePageTitle("Monitors")
  const { data: sessionData } = useSession()
  const role = (sessionData?.user as { role?: string } | undefined)?.role
  const isAdmin = role === "admin"
  const [monitors, setMonitors] = useState<MonitorWithStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>("grid")
  const [groupFilter, setGroupFilter] = useState("all")
  const [totalMonitors, setTotalMonitors] = useState(0)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<MonitorWithStatus | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function load() {
    try {
      const r = await api.listAllMonitors()
      setMonitors(r.monitors)
      setTotalMonitors(r.monitors.length)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const i = setInterval(load, 10000)
    return () => clearInterval(i)
  }, [])

  async function handleCreate(data: Partial<Monitor>) {
    try {
      await api.createMonitor(data)
      await load()
      toast({ title: "Monitor created", variant: "success" })
    } catch (err) {
      toast({ title: "Failed to create monitor", description: (err as Error).message, variant: "destructive" })
      throw err
    }
  }

  async function handleUpdate(data: Partial<Monitor>) {
    if (!editing) return
    try {
      await api.updateMonitor(editing.id, data)
      setEditing(null)
      await load()
      toast({ title: "Monitor updated", variant: "success" })
    } catch (err) {
      toast({ title: "Failed to update monitor", description: (err as Error).message, variant: "destructive" })
      throw err
    }
  }

  async function confirmDelete() {
    const id = confirmingDelete
    if (!id) return
    setDeleting(true)
    try {
      await api.deleteMonitor(id)
      setConfirmingDelete(null)
      await load()
      toast({ title: "Monitor deleted", variant: "success" })
    } catch (err) {
      toast({ title: "Failed to delete monitor", description: (err as Error).message, variant: "destructive" })
    } finally {
      setDeleting(false)
    }
  }

  const groupNames = [...new Set(monitors.map((m) => m.group?.trim() ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const filteredMonitors = groupFilter === "all" ? monitors : monitors.filter((m) => (m.group?.trim() ?? "") === groupFilter)
  const grouped = new Map<string, MonitorWithStatus[]>()
  for (const m of filteredMonitors) {
    const key = m.group?.trim() || "__ungrouped__"
    const list = grouped.get(key) ?? []
    list.push(m)
    grouped.set(key, list)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Monitors</h1>
          <p className="text-sm text-muted-foreground">
            {totalMonitors} monitor{totalMonitors === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PageInfo title="Monitors" content={monitorExplainer} className="h-8 w-8" />
          <select
            className="h-8 rounded-md border bg-background px-2 text-xs"
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
          >
            <option value="all">All groups</option>
            {groupNames.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          <div className="flex items-center rounded-md border">
            <button
              type="button"
              onClick={() => setView("grid")}
              className={`flex h-8 w-8 items-center justify-center rounded-l-md ${view === "grid" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted"}`}
              title="Grid view"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setView("table")}
              className={`flex h-8 w-8 items-center justify-center rounded-r-md ${view === "table" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted"}`}
              title="Table view"
            >
              <List className="h-4 w-4" />
            </button>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true) }}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              <span className="hidden sm:inline">Add Monitor</span>
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-36 w-full" />
            ))}
          </div>
        </div>
      ) : monitors.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Activity className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No monitors yet. Click "Add Monitor" to start tracking an endpoint.
            </p>
            {isAdmin && (
              <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true) }}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add Monitor
              </Button>
            )}
          </CardContent>
        </Card>
      ) : view === "grid" ? (
        <div className="space-y-6">
          {[...grouped.entries()].map(([key, groupMonitors]) => {
            const hasNamedGroups = groupNames.length > 0
            const groupLabel = key === "__ungrouped__" ? (hasNamedGroups ? "Other" : "") : key
            return (
              <div key={key} className="space-y-3">
                {groupLabel && (
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {groupLabel}
                  </h2>
                )}
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {groupMonitors.map((m) => (
                    <Card key={m.id} className="transition-colors hover:border-primary/40">
                      <CardContent className="space-y-3 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-start gap-2">
                            <MonitorName m={m} />
                          </div>
                          {isAdmin && (
                            <div className="flex shrink-0 gap-0.5">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(m); setDialogOpen(true) }} title="Edit">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => setConfirmingDelete(m.id)}
                                title="Delete"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </div>

                        <HeartbeatBar heartbeats={m.recentHeartbeats} />

                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            {m.currentStatus === "up" && <span className="font-medium text-success">UP</span>}
                            {m.currentStatus === "down" && <span className="font-medium text-destructive">DOWN</span>}
                            {m.currentStatus == null && <span>No checks yet</span>}
                            <ResponseTime m={m} />
                          </span>
                          <span>
                            Uptime 24h: <span className="font-medium text-foreground">{formatUptime(m.uptime24h)}</span>
                            {m.latestHeartbeat && (
                              <span className="ml-2">· {formatDate(m.latestHeartbeat.checkedAt)}</span>
                            )}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="space-y-6">
          {[...grouped.entries()].map(([key, groupMonitors]) => {
            const hasNamedGroups = groupNames.length > 0
            const groupLabel = key === "__ungrouped__" ? (hasNamedGroups ? "Other" : "") : key
            return (
              <div key={key} className="space-y-3">
                {groupLabel && (
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {groupLabel}
                  </h2>
                )}
                <Card>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Monitor</TableHead>
                        <TableHead className="w-40">Last 90 checks</TableHead>
                        <TableHead className="w-20 text-right">Response</TableHead>
                        <TableHead className="w-20 text-right">Uptime 24h</TableHead>
                        <TableHead className="w-32">Last checked</TableHead>
                        {isAdmin && <TableHead className="w-16 text-right">Actions</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {groupMonitors.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell><MonitorName m={m} /></TableCell>
                          <TableCell><HeartbeatBar heartbeats={m.recentHeartbeats} /></TableCell>
                          <TableCell className="text-right tabular-nums"><ResponseTime m={m} /></TableCell>
                          <TableCell className="text-right tabular-nums">{formatUptime(m.uptime24h)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {m.latestHeartbeat ? formatDate(m.latestHeartbeat.checkedAt) : "–"}
                          </TableCell>
                          {isAdmin && (
                            <TableCell>
                              <div className="flex justify-end gap-0.5">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(m); setDialogOpen(true) }} title="Edit">
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                  onClick={() => setConfirmingDelete(m.id)}
                                  title="Delete"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              </div>
            )
          })}
        </div>
      )}

      <AddMonitorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={editing ? handleUpdate : handleCreate}
        initial={editing}
        existingGroups={groupNames}
      />

      <ConfirmDialog
        open={!!confirmingDelete}
        onOpenChange={(open) => { if (!open) setConfirmingDelete(null) }}
        title="Delete monitor?"
        description="This will permanently remove the monitor and all its heartbeat history. This action cannot be undone."
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
