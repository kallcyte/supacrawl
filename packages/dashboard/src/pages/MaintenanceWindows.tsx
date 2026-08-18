import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { usePageTitle } from "@/lib/usePageTitle"
import { api, type MaintenanceWindow, type Monitor } from "@/lib/api"
import { useSession } from "@/lib/auth-client"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { formatDate } from "@/lib/utils"
import { CalendarClock, Plus, Trash2, Loader2 } from "lucide-react"
import ConfirmDialog from "@/components/ConfirmDialog"
import { toast } from "@/lib/use-toast"

function toLocalInputValue(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function MaintenanceWindowsPage() {
  usePageTitle("Maintenance Windows")
  const { data: sessionData } = useSession()
  const role = (sessionData?.user as { role?: string } | undefined)?.role
  const isAdmin = role === "admin"

  const [windows, setWindows] = useState<MaintenanceWindow[]>([])
  const [monitors, setMonitors] = useState<Monitor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [monitorId, setMonitorId] = useState("")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [startAt, setStartAt] = useState("")
  const [endAt, setEndAt] = useState("")

  const [confirmingDelete, setConfirmingDelete] = useState<MaintenanceWindow | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function load() {
    try {
      const r = await api.listMaintenanceWindows()
      setWindows(r.windows)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    api.listAllMonitors()
      .then((r) => setMonitors(r.monitors))
      .catch(() => setMonitors([]))
  }, [])

  function openCreate() {
    setMonitorId("")
    setTitle("")
    setDescription("")
    const now = new Date()
    const end = new Date(now.getTime() + 60 * 60 * 1000)
    setStartAt(toLocalInputValue(now.toISOString()))
    setEndAt(toLocalInputValue(end.toISOString()))
    setFormError(null)
    setCreateOpen(true)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      await api.createMaintenanceWindow({
        monitorId,
        title,
        description: description.trim() ? description.trim() : null,
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString()
      })
      setCreateOpen(false)
      await load()
      toast({ title: "Maintenance window created", variant: "success" })
    } catch (err) {
      setFormError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    const w = confirmingDelete
    if (!w) return
    setDeleting(true)
    try {
      await api.deleteMaintenanceWindow(w.id)
      setConfirmingDelete(null)
      await load()
      toast({ title: "Maintenance window deleted", variant: "success" })
    } catch (err) {
      toast({ title: "Failed to delete maintenance window", description: (err as Error).message, variant: "destructive" })
    } finally {
      setDeleting(false)
    }
  }

  const nowIso = new Date().toISOString()
  const sorted = [...windows].sort((a, b) => (a.startAt < b.startAt ? 1 : -1))

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Maintenance Windows</h1>
          <p className="text-sm text-muted-foreground">
            Schedule downtime so monitors don't fire false alerts
          </p>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            New Window
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <CalendarClock className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No maintenance windows yet. Create one to suppress alerts during planned downtime.
            </p>
            {isAdmin && (
              <Button size="sm" onClick={openCreate}>
                <Plus className="mr-1 h-3.5 w-3.5" /> New Window
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sorted.map((w) => {
            const active = w.startAt <= nowIso && w.endAt >= nowIso
            const upcoming = w.startAt > nowIso
            return (
              <Card key={w.id} className="transition-colors hover:border-primary/40">
                <CardContent className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{w.title}</span>
                      {active && <Badge className="bg-warning/15 text-warning">Active</Badge>}
                      {upcoming && <Badge variant="outline">Upcoming</Badge>}
                      {!active && !upcoming && <Badge variant="secondary">Ended</Badge>}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      <Link to={`/monitors/${w.monitorId}`} className="hover:underline">
                        {w.monitorName || "Unknown monitor"}
                      </Link>
                      {" · "}
                      {formatDate(w.startAt)} → {formatDate(w.endAt)}
                    </div>
                    {w.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{w.description}</p>
                    )}
                  </div>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setConfirmingDelete(w)}
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Maintenance Window</DialogTitle>
            <DialogDescription>
              While active, this monitor's down alerts are suppressed.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            {formError && (
              <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                {formError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="mw-monitor">Monitor</Label>
              <select
                id="mw-monitor"
                className="h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={monitorId}
                onChange={(e) => setMonitorId(e.target.value)}
                required
              >
                <option value="" disabled>Select a monitor…</option>
                {monitors.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mw-title">Title</Label>
              <Input id="mw-title" value={title} placeholder="e.g. Scheduled database migration" onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mw-description">Description (optional)</Label>
              <Textarea id="mw-description" value={description} placeholder="What's happening?" onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="mw-start">Start</Label>
                <Input id="mw-start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mw-end">End</Label>
                <Input id="mw-end" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} required />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmingDelete}
        onOpenChange={(open) => { if (!open) setConfirmingDelete(null) }}
        title="Delete maintenance window?"
        description="This window will no longer suppress alerts for its monitor."
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
