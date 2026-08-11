import { useEffect, useState, useRef } from "react"
import { Link, useNavigate } from "react-router-dom"
import { api, type CrawlJob, type CrawlRecord } from "@/lib/api"
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
import { formatDate, faviconUrl } from "@/lib/utils"
import { Plus, Play, Pencil, Trash2, Loader2, History, Square, ExternalLink, Download, Upload } from "lucide-react"
import { useCrawlNotifications } from "@/lib/useCrawlNotifications"
import AddCrawlJobDialog from "@/components/AddCrawlJobDialog"
import ConfirmDialog from "@/components/ConfirmDialog"
import { toast } from "@/lib/use-toast"
import PageInfo from "@/components/PageInfo"
import crawlsExplainer from "@/content/crawls-explainer.md?raw"

export default function CrawlsPage() {
  const navigate = useNavigate()
  const { data: sessionData } = useSession()
  const role = (sessionData?.user as { role?: string } | undefined)?.role
  const isAdmin = role === "admin"
  const [jobs, setJobs] = useState<CrawlJob[]>([])
  const [runningJobs, setRunningJobs] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<CrawlJob | null>(null)
  const [starting, setStarting] = useState<string | null>(null)
  const [stopping, setStopping] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [expandedJob, setExpandedJob] = useState<string | null>(null)
  const [jobHistory, setJobHistory] = useState<Record<string, CrawlRecord[]>>({})
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)

  const allCrawls = Object.values(jobHistory).flat()
  useCrawlNotifications(allCrawls)

  async function load() {
    try {
      const r = await api.listCrawlJobs()
      setJobs(r.jobs)
      setRunningJobs(new Set(r.running))
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(data: Partial<CrawlJob>) {
    try {
      await api.createCrawlJob(data)
      await load()
      toast({ title: "Crawl job created", variant: "success" })
    } catch (err) {
      toast({ title: "Failed to create crawl job", description: (err as Error).message, variant: "destructive" })
      throw err
    }
  }

  async function handleUpdate(data: Partial<CrawlJob>) {
    if (!editing) return
    try {
      await api.updateCrawlJob(editing.id, data)
      setEditing(null)
      await load()
      toast({ title: "Crawl job updated", variant: "success" })
    } catch (err) {
      toast({ title: "Failed to update crawl job", description: (err as Error).message, variant: "destructive" })
      throw err
    }
  }

  async function handleStart(id: string) {
    setStarting(id)
    try {
      const { crawlId } = await api.startCrawlJob(id)
      toast({ title: "Crawl started", variant: "success" })
      navigate(`/crawls/${crawlId}`)
    } catch (err) {
      setError((err as Error).message)
      toast({ title: "Failed to start crawl", description: (err as Error).message, variant: "destructive" })
      setStarting(null)
    }
  }

  async function handleStop(id: string) {
    setStopping(id)
    try {
      await api.stopCrawlJob(id)
      await load()
      toast({ title: "Crawl stopped", variant: "success" })
    } catch (err) {
      setError((err as Error).message)
      toast({ title: "Failed to stop crawl", description: (err as Error).message, variant: "destructive" })
    } finally {
      setStopping(null)
    }
  }

  async function handleDelete(id: string) {
    setConfirmingDelete(id)
  }

  async function confirmDelete() {
    const id = confirmingDelete
    if (!id) return
    setDeleting(id)
    try {
      await api.deleteCrawlJob(id)
      setConfirmingDelete(null)
      await load()
      toast({ title: "Crawl job deleted", variant: "success" })
    } catch (err) {
      setError((err as Error).message)
      toast({ title: "Failed to delete crawl job", description: (err as Error).message, variant: "destructive" })
    } finally {
      setDeleting(null)
    }
  }

  async function navigateToLatestCrawl(jobId: string) {
    try {
      const r = await api.getCrawlJobHistory(jobId)
      if (r.crawls.length > 0) {
        navigate(`/crawls/${r.crawls[0].id}`)
      }
    } catch {
      // silently fail
    }
  }

  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleExport() {
    try {
      const data = await api.exportCrawlJobs()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `supacrawl-jobs-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast({ title: "Crawl jobs exported", variant: "success" })
    } catch (err) {
      toast({ title: "Export failed", description: (err as Error).message, variant: "destructive" })
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const result = await api.importCrawlJobs(data)
      await load()
      toast({ title: `${result.imported} crawl job(s) imported`, variant: "success" })
    } catch (err) {
      toast({ title: "Import failed", description: (err as Error).message, variant: "destructive" })
    }
    e.target.value = ""
  }

  async function toggleHistory(jobId: string) {
    if (expandedJob === jobId) {
      setExpandedJob(null)
      return
    }
    setExpandedJob(jobId)
    if (!jobHistory[jobId]) {
      try {
        const r = await api.getCrawlJobHistory(jobId)
        setJobHistory((prev) => ({ ...prev, [jobId]: r.crawls }))
      } catch {
        // silently fail
      }
    }
  }

  useEffect(() => {
    load()
    const i = setInterval(load, 10000)
    return () => clearInterval(i)
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Crawl Jobs</h1>
          <p className="text-sm text-muted-foreground">
            Scheduled crawl jobs that monitor your sitemaps
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PageInfo title="Crawl Jobs" content={crawlsExplainer} className="h-8 w-8" />
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="mr-1 h-3.5 w-3.5" />
            <span className="hidden sm:inline">Export</span>
          </Button>
          {isAdmin && (
            <>
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="mr-1 h-3.5 w-3.5" />
                <span className="hidden sm:inline">Import</span>
              </Button>
              <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
              <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true) }}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                <span className="hidden sm:inline">Add Crawl Job</span>
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
          <CardTitle>Jobs</CardTitle>
          <CardDescription>{jobs.length} job(s) configured</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No crawl jobs yet. Click &ldquo;Add Crawl Job&rdquo; to create one.
            </p>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => {
                const isRunning = runningJobs.has(job.id)
                return (
                  <div key={job.id} className="rounded-lg border p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex-1">
                        <div className="flex items-start gap-3">
                          <img
                            src={faviconUrl(job.sitemapUrl)}
                            alt=""
                            className="mt-1 h-5 w-5 shrink-0 rounded"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{job.name}</span>
                          <Badge variant={job.enabled ? "default" : "secondary"}>
                            {job.enabled ? "Run on Schedule" : "Not Scheduled"}
                          </Badge>
                          {isRunning && (
                            <Badge variant="secondary" className="animate-pulse">
                              Running
                            </Badge>
                          )}
                          {!isRunning && job.lastRunStatus && (
                            <Badge
                              variant={
                                job.lastRunStatus === "completed"
                                  ? "success"
                                  : job.lastRunStatus === "failed"
                                    ? "destructive"
                                    : "secondary"
                              }
                            >
                              {job.lastRunStatus}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {job.sitemapUrl} &middot; Every {job.intervalValue} {job.intervalUnit}
                          {job.runAt && <> at {job.runAt}</>}
                          {job.enabled && job.nextRunAt && (
                            <> &middot; Next run {formatDate(job.nextRunAt)}</>
                          )}
                          {job.enabled && !job.nextRunAt && (
                            <> &middot; Run once to start scheduling</>
                          )}
                          {job.lastRunAt && (
                            <> &middot; Last run {formatDate(job.lastRunAt)}</>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                        {isAdmin && (isRunning ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleStop(job.id)}
                            disabled={stopping === job.id}
                            className="text-destructive"
                          >
                            {stopping === job.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Square className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleStart(job.id)}
                            disabled={starting === job.id}
                          >
                            {starting === job.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Play className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        ))}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigateToLatestCrawl(job.id)}
                          title="Open latest crawl detail"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                        {isAdmin && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => { setEditing(job); setDialogOpen(true) }}
                              disabled={isRunning}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(job.id)}
                              disabled={deleting === job.id || isRunning}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              {deleting === job.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleHistory(job.id)}
                        >
                          <History className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {expandedJob === job.id && (
                      <div className="mt-3 border-t pt-3">
                        <p className="mb-2 text-xs font-medium text-muted-foreground">Run History</p>
                        {jobHistory[job.id]?.length ? (
                          <div className="overflow-auto">
                          <div className="min-w-[500px]">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Started</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Checked</TableHead>
                                <TableHead className="text-right">Broken</TableHead>
                                <TableHead></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {jobHistory[job.id].map((c) => (
                                <TableRow key={c.id}>
                                  <TableCell className="font-mono text-xs">
                                    {formatDate(c.startedAt)}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={
                                        c.status === "completed"
                                          ? "success"
                                          : c.status === "failed"
                                            ? "destructive"
                                            : "secondary"
                                      }
                                    >
                                      {c.status}
                                    </Badge>
                                    {c.status === "failed" && c.errorMessage && (
                                      <div
                                        className="mt-1 max-w-[320px] truncate text-xs text-destructive"
                                        title={c.errorMessage}
                                      >
                                        {c.errorMessage}
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right">{c.urlsChecked}</TableCell>
                                  <TableCell className="text-right text-destructive">
                                    {c.urlsBroken || "-"}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button asChild variant="ghost" size="sm">
                                      <Link to={`/crawls/${c.id}`}>View</Link>
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                          </div>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">No runs yet.</p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <AddCrawlJobDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={editing ? handleUpdate : handleCreate}
        initial={editing}
      />

      <ConfirmDialog
        open={!!confirmingDelete}
        onOpenChange={(open) => { if (!open) setConfirmingDelete(null) }}
        title="Delete crawl job?"
        description="This will permanently remove the job and all its crawl history. This action cannot be undone."
        confirmLabel="Delete"
        loading={!!deleting}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
