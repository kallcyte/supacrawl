import { useCallback, useEffect, useRef, useState } from "react"
import { usePageTitle } from "@/lib/usePageTitle"
import { useSession } from "@/lib/auth-client"
import { api, type StatusPageRecord, type MonitorWithStatus } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { formatDate } from "@/lib/utils"
import { Plus, Pencil, Trash2, ExternalLink, Copy, Check, Download, Upload } from "lucide-react"
import StatusPageDialog from "@/components/StatusPageDialog"
import ConfirmDialog from "@/components/ConfirmDialog"
import { toast } from "@/lib/use-toast"

export default function StatusPagesPage() {
  usePageTitle("Status Pages")
  const { data: sessionData } = useSession()
  const role = (sessionData?.user as { role?: string } | undefined)?.role
  const isAdmin = role === "admin"
  const [pages, setPages] = useState<(StatusPageRecord & { monitorCount: number })[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editPage, setEditPage] = useState<StatusPageRecord | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await api.listStatusPages()
      setPages(res.pages as (StatusPageRecord & { monitorCount: number })[])
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleCreate(data: Parameters<typeof api.createStatusPage>[0] & { monitors: { id: string; groupName?: string }[] }) {
    const page = await api.createStatusPage(data)
    if (data.monitors.length > 0) {
      await api.setStatusPageMonitors(page.id, data.monitors)
    }
    await load()
  }

  async function handleEdit(id: string, data: Parameters<typeof api.updateStatusPage>[1] & { monitors: { id: string; groupName?: string }[] }) {
    await api.updateStatusPage(id, data)
    if (data.monitors) {
      await api.setStatusPageMonitors(id, data.monitors)
    }
    await load()
  }

  async function handleDelete(id: string) {
    await api.deleteStatusPage(id)
    setConfirmDelete(null)
    await load()
  }

  function getShareUrl(slug: string) {
    const base = window.location.origin
    return `${base}/status/${slug}`
  }

  async function copyLink(slug: string, id: string) {
    const url = getShareUrl(slug)
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(id)
      toast({ title: "Link copied", description: url })
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" })
    }
  }

  const spFileRef = useRef<HTMLInputElement>(null)

  async function handleExport() {
    try {
      const data = await api.exportStatusPages()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `supacrawl-status-pages-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast({ title: "Status pages exported", variant: "success" })
    } catch (err) {
      toast({ title: "Export failed", description: (err as Error).message, variant: "destructive" })
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      const result = await api.importStatusPages(parsed)
      await load()
      toast({
        title: `${result.imported} imported, ${result.updated} updated`,
        description: result.droppedLinks > 0 ? `${result.droppedLinks} link(s) dropped (unknown monitor)` : undefined,
        variant: "success"
      })
    } catch (err) {
      toast({ title: "Import failed", description: (err as Error).message, variant: "destructive" })
    }
    e.target.value = ""
  }

  if (loading && pages.length === 0) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Status Pages</h1>
          <p className="text-sm text-muted-foreground">
            Create public status pages to share live monitoring status
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExport}>
            <Download className="mr-1 h-4 w-4" /> Export
          </Button>
          {isAdmin && (
            <>
              <Button variant="outline" onClick={() => spFileRef.current?.click()}>
                <Upload className="mr-1 h-4 w-4" /> Import
              </Button>
              <input ref={spFileRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
              <Button onClick={() => { setEditPage(null); setDialogOpen(true) }}>
                <Plus className="mr-1 h-4 w-4" /> Create Status Page
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All Status Pages</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Monitors</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pages.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No status pages yet. Create one to share monitoring status publicly.
                  </TableCell>
                </TableRow>
              ) : (
                pages.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.title}</TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{p.slug}</code>
                    </TableCell>
                    <TableCell>
                      {p.public ? (
                        <Badge variant="default" className="bg-success">Public</Badge>
                      ) : (
                        <Badge variant="secondary">Private</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">{p.monitorCount}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{formatDate(p.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => window.open(getShareUrl(p.slug), "_blank")}
                          title="View public page"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => copyLink(p.slug, p.id)}
                          title="Copy share link"
                        >
                          {copiedId === p.id ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => { setEditPage(p); setDialogOpen(true) }}
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => setConfirmDelete(p.id)}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <StatusPageDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={async (data) => {
          if (editPage) {
            await handleEdit(editPage.id, data)
          } else {
            await handleCreate(data)
          }
          setDialogOpen(false)
          setEditPage(null)
        }}
        initial={editPage}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(open) => { if (!open) setConfirmDelete(null) }}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        title="Delete status page?"
        description="This will remove the public status page. The monitors themselves will not be affected."
        confirmLabel="Delete"
      />
    </div>
  )
}