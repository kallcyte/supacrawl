import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { api, type CrawlRecord, type CrawlResult, type StatusBucket } from "@/lib/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table"
import StatusDistribution from "@/components/charts/StatusDistribution"
import LiveProgress from "@/components/LiveProgress"
import { ArrowLeft, AlertTriangle, RefreshCw, Square, Loader2, Bug } from "lucide-react"
import { formatDate, formatDuration, truncate } from "@/lib/utils"
import { toast } from "@/lib/use-toast"

type Filter = "all" | "broken" | "changed" | "mojibake"

export default function CrawlDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [crawl, setCrawl] = useState<CrawlRecord | null>(null)
  const [results, setResults] = useState<CrawlResult[]>([])
  const [distribution, setDistribution] = useState<StatusBucket[]>([])
  const [filter, setFilter] = useState<Filter>("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)

  async function handleStop() {
    if (!crawl?.jobId) return
    setStopping(true)
    try {
      await api.stopCrawlJob(crawl.jobId)
      await load()
      toast({ title: "Crawl stopped", variant: "success" })
    } catch (err) {
      setError((err as Error).message)
      toast({ title: "Failed to stop crawl", description: (err as Error).message, variant: "destructive" })
    } finally {
      setStopping(false)
    }
  }

  async function load() {
    if (!id) return
    try {
      const [c, r, d] = await Promise.all([
        api.getCrawl(id),
        api.listResults(id),
        api.getStatusDistribution(id)
      ])
      setCrawl(c)
      setResults(r.results)
      setDistribution(d)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    load()
    const i = setInterval(load, 4000)
    return () => clearInterval(i)
  }, [id])

  useEffect(() => {
    if (!crawl || crawl.status !== "running" || !crawl.startedAt) return
    setElapsed(Date.now() - Date.parse(crawl.startedAt))
    const i = setInterval(() => setElapsed(Date.now() - Date.parse(crawl.startedAt)), 1000)
    return () => clearInterval(i)
  }, [crawl?.status, crawl?.startedAt])

  if (loading || !crawl) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  const filtered = results.filter((r) => {
    if (filter === "broken") return (r.statusCode ?? 0) >= 400
    if (filter === "changed") return r.contentChanged
    if (filter === "mojibake") return r.mojibakeFlagged
    return true
  })

  const duration =
    crawl.finishedAt && crawl.startedAt
      ? Date.parse(crawl.finishedAt) - Date.parse(crawl.startedAt)
      : crawl.status === "running" && crawl.startedAt
        ? elapsed
        : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link to="/crawls">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Crawl detail</h1>
            <p className="text-sm text-muted-foreground">
              Started {formatDate(crawl.startedAt)} · ID {crawl.id.slice(0, 8)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {crawl.status === "running" && crawl.jobId && (
            <Button variant="outline" size="sm" onClick={handleStop} disabled={stopping} className="text-destructive">
              {stopping ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Square className="mr-1 h-3.5 w-3.5" />
              )}
              Stop
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {crawl.status === "running" && <LiveProgress crawl={crawl} />}

      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Status</CardDescription>
            <CardTitle className="text-base">
              <Badge
                variant={
                  crawl.status === "completed"
                    ? "success"
                    : crawl.status === "failed"
                      ? "destructive"
                      : "secondary"
                }
              >
                {crawl.status}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Duration: {formatDuration(duration)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>URLs Total</CardDescription>
            <CardTitle className="text-2xl">{crawl.urlsTotal}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Broken</CardDescription>
            <CardTitle className="text-2xl text-destructive">
              {crawl.urlsBroken}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Content changes</CardDescription>
            <CardTitle className="text-2xl">{crawl.urlsChanged}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Mojibake</CardDescription>
            <CardTitle className="text-2xl text-amber-500">
              {results.filter((r) => r.mojibakeFlagged).length}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Status distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusDistribution data={distribution} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>URLs</CardTitle>
                <CardDescription>{filtered.length} of {results.length} shown</CardDescription>
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={filter === "all" ? "default" : "outline"}
                  onClick={() => setFilter("all")}
                >
                  All
                </Button>
                <Button
                  size="sm"
                  variant={filter === "broken" ? "default" : "outline"}
                  onClick={() => setFilter("broken")}
                >
                  Broken
                </Button>
                <Button
                  size="sm"
                  variant={filter === "changed" ? "default" : "outline"}
                  onClick={() => setFilter("changed")}
                >
                  Changed
                </Button>
                <Button
                  size="sm"
                  variant={filter === "mojibake" ? "default" : "outline"}
                  onClick={() => setFilter("mojibake")}
                >
                  Mojibake
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">No URLs match the current filter.</p>
            ) : (
              <div className="max-h-[480px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>URL</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline"
                            title={r.url}
                          >
                            {truncate(r.url, 60)}
                          </a>
                          {r.error && (
                            <div className="mt-1 flex items-center gap-1 text-xs text-destructive">
                              <AlertTriangle className="h-3 w-3" /> {r.error}
                            </div>
                          )}
                          {r.mojibakeFlagged && (
                            <div className="mt-1 flex items-center gap-1 text-xs text-amber-500">
                              <Bug className="h-3 w-3" />
                              Mojibake detected
                              {r.mojibakeScore !== null && ` (${Math.round(r.mojibakeScore * 100)}%)`}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge code={r.statusCode} />
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-xs">
                            {r.checkMethod}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {r.responseTimeMs !== null ? `${r.responseTimeMs}ms` : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StatusBadge({ code }: { code: number | null }) {
  if (code === null) return <Badge variant="destructive">ERR</Badge>
  if (code < 300) return <Badge variant="success">{code}</Badge>
  if (code < 400) return <Badge variant="warning">{code}</Badge>
  if (code < 500) return <Badge variant="destructive">{code}</Badge>
  return <Badge variant="destructive">{code}</Badge>
}
