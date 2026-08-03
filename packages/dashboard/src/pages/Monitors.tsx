import { useEffect, useMemo, useState } from "react"
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
  Plus, Pencil, Trash2, Loader2, Activity, ChevronDown, ChevronRight, LayoutGrid, List
} from "lucide-react"
import monitorExplainer from "@/content/monitor-explainer.md?raw"
import PageInfo from "@/components/PageInfo"
import HeartbeatBar from "@/components/HeartbeatBar"
import AddMonitorDialog from "@/components/AddMonitorDialog"
import BulkEditMonitorDialog from "@/components/BulkEditMonitorDialog"
import ConfirmDialog from "@/components/ConfirmDialog"
import { toast } from "@/lib/use-toast"

function getDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname
    return hostname || "unknown"
  } catch {
    return "unknown"
  }
}

function StatusDot({ status }: { status: string | null }) {
  if (status === "up") return <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" title="Up" />
  if (status === "down") return <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" title="Down" />
  return <span className="inline-block h-2.5 w-2.5 rounded-full bg-muted-foreground/30" title="No data" />
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

interface GroupProps {
  domain: string
  monitors: MonitorWithStatus[]
  view: View
  isAdmin: boolean
  selected: Set<string>
  collapsed: boolean
  onToggleCollapse: () => void
  onToggleSelect: (id: string) => void
  onToggleGroup: () => void
  onEdit: (m: MonitorWithStatus) => void
  onDelete: (id: string) => void
}

function MonitorGroup({
  domain,
  monitors,
  view,
  isAdmin,
  selected,
  collapsed,
  onToggleCollapse,
  onToggleSelect,
  onToggleGroup,
  onEdit,
  onDelete
}: GroupProps) {
  const up = monitors.filter((m) => m.currentStatus === "up").length
  const down = monitors.filter((m) => m.currentStatus === "down").length
  const none = monitors.length - up - down
  const allSelected = monitors.length > 0 && monitors.every((m) => selected.has(m.id))

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted"
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {isAdmin && (
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={allSelected}
            onChange={onToggleGroup}
          />
        )}
        <span className="font-medium">{domain}</span>
        <span className="text-xs text-muted-foreground">{monitors.length} monitor{monitors.length === 1 ? "" : "s"}</span>
        <span className="ml-auto flex items-center gap-3 text-xs">
          {up > 0 && <span className="font-medium text-emerald-600">{up} up</span>}
          {down > 0 && <span className="font-medium text-red-600">{down} down</span>}
          {none > 0 && <span className="text-muted-foreground">{none} no data</span>}
        </span>
      </div>

      {!collapsed && view === "grid" && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {monitors.map((m) => (
            <Card key={m.id} className="transition-colors hover:border-primary/40">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2">
                    {isAdmin && (
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-primary"
                        checked={selected.has(m.id)}
                        onChange={() => onToggleSelect(m.id)}
                      />
                    )}
                    <MonitorName m={m} />
                  </div>
                  {isAdmin && (
                    <div className="flex shrink-0 gap-0.5">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(m)} title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => onDelete(m.id)}
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
                    {m.currentStatus === "up" && <span className="font-medium text-emerald-600">UP</span>}
                    {m.currentStatus === "down" && <span className="font-medium text-red-600">DOWN</span>}
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
      )}

      {!collapsed && view === "table" && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                {isAdmin && <TableHead className="w-10" />}
                <TableHead>Monitor</TableHead>
                <TableHead className="w-40">Last 90 checks</TableHead>
                <TableHead className="w-20 text-right">Response</TableHead>
                <TableHead className="w-20 text-right">Uptime 24h</TableHead>
                <TableHead className="w-32">Last checked</TableHead>
                {isAdmin && <TableHead className="w-16 text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {monitors.map((m) => (
                <TableRow key={m.id}>
                  {isAdmin && (
                    <TableCell>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={selected.has(m.id)}
                        onChange={() => onToggleSelect(m.id)}
                      />
                    </TableCell>
                  )}
                  <TableCell><MonitorName m={m} /></TableCell>
                  <TableCell><HeartbeatBar heartbeats={m.recentHeartbeats} /></TableCell>
                  <TableCell className="text-right"><ResponseTime m={m} /></TableCell>
                  <TableCell className="text-right">{formatUptime(m.uptime24h)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {m.latestHeartbeat ? formatDate(m.latestHeartbeat.checkedAt) : "–"}
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      <div className="flex justify-end gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(m)} title="Edit">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => onDelete(m.id)}
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
      )}
    </section>
  )
}

export default function MonitorsPage() {
  const { data: sessionData } = useSession()
  const role = (sessionData?.user as { role?: string } | undefined)?.role
  const isAdmin = role === "admin"
  const [monitors, setMonitors] = useState<MonitorWithStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>("grid")
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(5)
  const [totalPages, setTotalPages] = useState(1)
  const [totalMonitors, setTotalMonitors] = useState(0)
  const [totalDomains, setTotalDomains] = useState(0)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<MonitorWithStatus | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  async function load() {
    try {
      const r = await api.listMonitors({ page, perPage })
      setMonitors(r.monitors)
      setTotalPages(r.totalPages)
      setTotalMonitors(r.totalMonitors)
      setTotalDomains(r.totalDomains)
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
  }, [page, perPage])

  const groups = useMemo(() => {
    const map = new Map<string, MonitorWithStatus[]>()
    for (const m of monitors) {
      const domain = getDomain(m.url)
      const arr = map.get(domain) ?? []
      arr.push(m)
      map.set(domain, arr)
    }
    return [...map.entries()]
      .map(([domain, list]) => ({ domain, monitors: list.sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.domain.localeCompare(b.domain))
  }, [monitors])

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleGroupSelect(domain: string) {
    const ids = groups.find((g) => g.domain === domain)?.monitors.map((m) => m.id) ?? []
    setSelected((prev) => {
      const next = new Set(prev)
      const allSelected = ids.length > 0 && ids.every((id) => next.has(id))
      for (const id of ids) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  function clearSelection() {
    setSelected(new Set())
  }

  function toggleCollapse(domain: string) {
    setCollapsed((prev) => ({ ...prev, [domain]: !prev[domain] }))
  }

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

  async function bulkSetEnabled(enabled: boolean) {
    const ids = [...selected]
    if (ids.length === 0) return
    try {
      await api.bulkUpdateMonitors(ids, { enabled })
      clearSelection()
      await load()
      toast({ title: `${enabled ? "Enabled" : "Disabled"} ${ids.length} monitors`, variant: "success" })
    } catch (err) {
      toast({ title: "Failed to update monitors", description: (err as Error).message, variant: "destructive" })
    }
  }

  async function handleBulkEdit(patch: Partial<Monitor>) {
    const ids = [...selected]
    try {
      await api.bulkUpdateMonitors(ids, patch)
      clearSelection()
      await load()
      toast({ title: `Updated ${ids.length} monitors`, variant: "success" })
    } catch (err) {
      toast({ title: "Failed to update monitors", description: (err as Error).message, variant: "destructive" })
      throw err
    }
  }

  async function confirmBulkDelete() {
    const ids = [...selected]
    if (ids.length === 0) return
    setDeleting(true)
    try {
      await api.bulkDeleteMonitors(ids)
      setConfirmingBulkDelete(false)
      clearSelection()
      await load()
      toast({ title: `Deleted ${ids.length} monitors`, variant: "success" })
    } catch (err) {
      toast({ title: "Failed to delete monitors", description: (err as Error).message, variant: "destructive" })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Monitors</h1>
          <p className="text-sm text-muted-foreground">
            {totalMonitors} monitor{totalMonitors === 1 ? "" : "s"}
            {totalDomains > 0 && <> across {totalDomains} domain{totalDomains === 1 ? "" : "s"}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PageInfo title="Monitors" content={monitorExplainer} className="h-8 w-8" />
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

      {isAdmin && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => bulkSetEnabled(true)}>Enable</Button>
            <Button size="sm" onClick={() => bulkSetEnabled(false)}>Disable</Button>
            <Button size="sm" variant="outline" onClick={() => setBulkEditOpen(true)}>Edit</Button>
            <Button size="sm" variant="destructive" onClick={() => setConfirmingBulkDelete(true)}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
          </div>
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
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <MonitorGroup
              key={group.domain}
              domain={group.domain}
              monitors={group.monitors}
              view={view}
              isAdmin={isAdmin}
              selected={selected}
              collapsed={!!collapsed[group.domain]}
              onToggleCollapse={() => toggleCollapse(group.domain)}
              onToggleSelect={toggleSelect}
              onToggleGroup={() => toggleGroupSelect(group.domain)}
              onEdit={(m) => { setEditing(m); setDialogOpen(true) }}
              onDelete={(id) => setConfirmingDelete(id)}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-8 rounded-md border bg-background px-2 text-xs"
              value={perPage}
              onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); clearSelection() }}
            >
              <option value={5}>5 domains</option>
              <option value={10}>10 domains</option>
              <option value={25}>25 domains</option>
            </select>
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => { setPage((p) => p - 1); clearSelection() }}
            >
              Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => { setPage((p) => p + 1); clearSelection() }}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <AddMonitorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={editing ? handleUpdate : handleCreate}
        initial={editing}
      />

      <BulkEditMonitorDialog
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        onSubmit={handleBulkEdit}
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

      <ConfirmDialog
        open={confirmingBulkDelete}
        onOpenChange={setConfirmingBulkDelete}
        title={`Delete ${selected.size} monitor${selected.size === 1 ? "" : "s"}?`}
        description="This will permanently remove the selected monitors and all their heartbeat history. This action cannot be undone."
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={confirmBulkDelete}
      />
    </div>
  )
}
