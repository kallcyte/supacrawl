import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import {
  api,
  type CrawlRecord,
  type CrawlResult,
  type CrawlSummary,
  type StatusBucket
} from "@/lib/api"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import StatusDistribution from "@/components/charts/StatusDistribution"
import LiveProgress from "@/components/LiveProgress"
import {
  ArrowLeft,
  AlertTriangle,
  RefreshCw,
  Square,
  Loader2,
  Bug,
  FileSpreadsheet
} from "lucide-react"
import { formatDate, formatDuration, truncate } from "@/lib/utils"
import { buildCrawlReportWorkbook } from "@/lib/crawlReportXlsx"
import { toast } from "@/lib/use-toast"
import { useSession } from "@/lib/auth-client"
import PageInfo from "@/components/PageInfo"
import crawlDetailExplainer from "@/content/crawl-detail-explainer.md?raw"

type Filter = "all" | "broken" | "4xx" | "5xx" | "changed" | "mojibake" | "llmGarbage" | "redirect"

export default function CrawlDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: sessionData } = useSession()
  const role = (sessionData?.user as { role?: string } | undefined)?.role
  const isAdmin = role === "admin"
  const [crawl, setCrawl] = useState<CrawlRecord | null>(null)
  const [results, setResults] = useState<CrawlResult[]>([])
  const [distribution, setDistribution] = useState<StatusBucket[]>([])
  const [summary, setSummary] = useState<CrawlSummary | null>(null)
  const [filter, setFilter] = useState<Filter>("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [tabValue, setTabValue] = useState("results")
  const [excelGenerating, setExcelGenerating] = useState(false)

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
      // Load summary in background
      api.getCrawlSummary(id).then(setSummary).catch(() => {})
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

  async function handleDownloadExcel() {
    if (!crawl) return
    setExcelGenerating(true)
    try {
      // Ensure we have the summary before building the report
      const s =
        summary ??
        (await api.getCrawlSummary(id ?? "").catch(() => null))
      const buffer = await buildCrawlReportWorkbook({
        crawl,
        results,
        summary: s,
        distribution
      })
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `crawl-report-${id?.slice(0, 8) ?? "unknown"}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      toast({ title: "Excel report downloaded", variant: "success" })
    } catch (err) {
      toast({
        title: "Failed to generate Excel report",
        description: (err as Error).message,
        variant: "destructive"
      })
    } finally {
      setExcelGenerating(false)
    }
  }

  if (loading || !crawl) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  const filtered = results
    .filter((r) => {
      if (filter === "broken") return (r.statusCode ?? 0) >= 400
      if (filter === "4xx") return (r.statusCode ?? 0) >= 400 && (r.statusCode ?? 0) < 500
      if (filter === "5xx") return (r.statusCode ?? 0) >= 500
      if (filter === "changed") return r.contentChanged
      if (filter === "mojibake") return r.mojibakeFlagged
      if (filter === "llmGarbage") return r.llmGarbageFlagged
      if (filter === "redirect") return (r.statusCode ?? 0) >= 300 && (r.statusCode ?? 0) < 400
      return true
    })
    .sort((a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime())

  const duration =
    crawl.finishedAt && crawl.startedAt
      ? Date.parse(crawl.finishedAt) - Date.parse(crawl.startedAt)
      : crawl.status === "running" && crawl.startedAt
        ? elapsed
        : null

  const failed = results.filter((r) => (r.statusCode ?? 0) >= 400 || r.error)
  const byCause = new Map<string, { count: number; urls: string[] }>()
  for (const r of failed) {
    const key = r.statusCode !== null ? `HTTP ${r.statusCode}` : describeError(r.error)
    const g = byCause.get(key) ?? { count: 0, urls: [] }
    g.count++
    if (g.urls.length < 3) g.urls.push(r.url)
    byCause.set(key, g)
  }
  const causes = [...byCause.entries()].sort((a, b) => b[1].count - a[1].count)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
          <PageInfo title="Crawl Detail" content={crawlDetailExplainer} className="h-8 w-8" />
          {isAdmin && crawl.status === "running" && crawl.jobId && (
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

      {crawl.status === "failed" && crawl.errorMessage && (
        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          <span className="font-medium">Crawl failed:</span> {crawl.errorMessage}
        </div>
      )}

      {crawl.status === "failed" && !crawl.errorMessage && (
        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          <span className="font-medium">Crawl failed:</span> no error details were recorded
          (the crawler may have crashed or the server restarted mid-crawl).
        </div>
      )}

      {crawl.status !== "failed" && crawl.errorMessage && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700">
          <span className="font-medium">Crawl completed with errors:</span> {crawl.errorMessage}
        </div>
      )}

      {crawl.status === "running" && <LiveProgress crawl={crawl} />}

      {/* Summary cards — always visible */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
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
            <CardDescription>4xx Errors</CardDescription>
            <CardTitle className="text-2xl text-destructive">
              {results.filter((r) => (r.statusCode ?? 0) >= 400 && (r.statusCode ?? 0) < 500).length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>5xx Errors</CardDescription>
            <CardTitle className="text-2xl text-destructive">
              {results.filter((r) => (r.statusCode ?? 0) >= 500).length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Redirects</CardDescription>
            <CardTitle className="text-2xl text-yellow-500">
              {results.filter((r) => (r.statusCode ?? 0) >= 300 && (r.statusCode ?? 0) < 400).length}
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
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>LLM Garbage</CardDescription>
            <CardTitle className="text-2xl text-cyan-600">
              {results.filter((r) => r.llmGarbageFlagged).length}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {failed.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Why {failed.length} URL{failed.length === 1 ? "" : "s"} failed
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {causes.map(([cause, g]) => (
              <div key={cause} className="rounded-md border p-2">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">
                    {cause.startsWith("HTTP ") ? (
                      <Badge variant="destructive">{cause}</Badge>
                    ) : (
                      <span className="text-destructive">{cause}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {g.count} URL{g.count === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="mt-1 space-y-0.5">
                  {g.urls.map((u) => (
                    <li key={u} className="truncate font-mono text-xs" title={u}>
                      <a href={u} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        {u}
                      </a>
                    </li>
                  ))}
                  {g.count > g.urls.length && (
                    <li className="text-xs text-muted-foreground">
                      …and {g.count - g.urls.length} more
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Tabs: Results / Report */}
      <Tabs value={tabValue} onValueChange={setTabValue}>
        <TabsList>
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="report">Report</TabsTrigger>
        </TabsList>

        {/* === Results Tab (existing view) === */}
        <TabsContent value="results">
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
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle>URLs</CardTitle>
                    <CardDescription>{filtered.length} of {results.length} shown</CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant={filter === "all" ? "default" : "outline"}
                      onClick={() => setFilter("all")}
                    >
                      All
                    </Button>
                    <Button
                      size="sm"
                      variant={filter === "4xx" ? "default" : "outline"}
                      onClick={() => setFilter("4xx")}
                    >
                      4xx
                    </Button>
                    <Button
                      size="sm"
                      variant={filter === "5xx" ? "default" : "outline"}
                      onClick={() => setFilter("5xx")}
                    >
                      5xx
                    </Button>
                    <Button
                      size="sm"
                      variant={filter === "redirect" ? "default" : "outline"}
                      onClick={() => setFilter("redirect")}
                    >
                      Redirects
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
                    <Button
                      size="sm"
                      variant={filter === "llmGarbage" ? "default" : "outline"}
                      onClick={() => setFilter("llmGarbage")}
                    >
                      LLM Garbage
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {filtered.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No URLs match the current filter.</p>
                ) : (
                  <div className="max-h-[480px] overflow-auto">
                    <div className="min-w-[600px]">
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
                              {r.llmGarbageFlagged && (
                                <div className="mt-1 flex items-center gap-1 text-xs text-cyan-600">
                                  <Bug className="h-3 w-3" />
                                  LLM garbage
                                  {r.llmGarbageScore !== null && ` (${Math.round(r.llmGarbageScore * 100)}%)`}
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
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* === Report Tab === */}
        <TabsContent value="report">
          {!summary ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="rounded-full bg-primary/10 p-4">
                <FileSpreadsheet className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Download Excel report</h3>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  The report is generated as an Excel workbook with a dashboard
                  overview and separate sheets for 3xx, 4xx, 5xx, changed,
                  mojibake and LLM garbage URLs.
                </p>
              </div>
              <Button size="sm" onClick={handleDownloadExcel} disabled={excelGenerating}>
                {excelGenerating ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="mr-1 h-4 w-4" />
                )}
                Download Excel Report
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>
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

function describeError(err: string | null): string {
  const msg = (err ?? "Unknown error").toLowerCase()
  if (msg.includes("aborted") || msg.includes("timeout")) return "Timeout"
  if (msg.includes("fetch failed")) return "Network error"
  if (msg.includes("redirect")) return "Redirect loop"
  if (msg.includes("certificate") || msg.includes("ssl") || msg.includes("tls")) {
    return "SSL / TLS error"
  }
  return err ?? "Unknown error"
}

function StatBox({
  label,
  value,
  icon,
  color,
  bgColor
}: {
  label: string
  value: number
  icon: string
  color: string
  bgColor: string
}) {
  return (
    <div className={`${bgColor} rounded-lg p-3 text-center`}>
      <span className="text-lg">{icon}</span>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  )
}

function IssueSection({
  title,
  count,
  color,
  items
}: {
  title: string
  count: number
  color: string
  items: { url: string; detail: string }[]
}) {
  const borderColor =
    color === "red"
      ? "border-red-200"
      : color === "amber"
        ? "border-amber-200"
        : color === "orange"
          ? "border-orange-200"
          : "border-purple-200"
  const bgColor =
    color === "red"
      ? "bg-red-50"
      : color === "amber"
        ? "bg-amber-50"
        : color === "orange"
          ? "bg-orange-50"
          : "bg-purple-50"
  const textColor =
    color === "red"
      ? "text-red-700"
      : color === "amber"
        ? "text-amber-700"
        : color === "orange"
          ? "text-orange-700"
          : "text-purple-700"

  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`border ${borderColor} rounded-lg overflow-hidden`}>
      <button
        className={`w-full flex items-center justify-between ${bgColor} px-4 py-3 text-sm font-medium ${textColor}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span>
          {title} ({count})
        </span>
        <span className="text-xs">{expanded ? "▲ Collapse" : "▼ Expand"}</span>
      </button>
      {expanded && (
        <div className="divide-y divide-slate-100">
          {items.map((item, idx) => (
            <div key={idx} className="px-4 py-2 text-sm">
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline break-all"
              >
                {item.url}
              </a>
              {item.detail && (
                <p className="text-xs text-slate-500 mt-0.5">{item.detail}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

