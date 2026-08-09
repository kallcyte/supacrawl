import { useEffect, useRef, useState } from "react"
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
  FileDown
} from "lucide-react"
import { formatDate, formatDuration, truncate } from "@/lib/utils"
import { toast } from "@/lib/use-toast"
import { useSession } from "@/lib/auth-client"
import PageInfo from "@/components/PageInfo"
import crawlDetailExplainer from "@/content/crawl-detail-explainer.md?raw"

type Filter = "all" | "broken" | "4xx" | "5xx" | "changed" | "mojibake" | "llmGarbage" | "redirect"

/** Hex approximations of Tailwind v4 CSS variables (which use oklch). */
const TAILWIND_COLORS = `
:root {
  --color-slate-50: #f8fafc;
  --color-slate-100: #f1f5f9;
  --color-slate-200: #e2e8f0;
  --color-slate-300: #cbd5e1;
  --color-slate-400: #94a3b8;
  --color-slate-500: #64748b;
  --color-slate-600: #475569;
  --color-slate-700: #334155;
  --color-slate-800: #1e293b;
  --color-slate-900: #0f172a;
  --color-gray-300: #d1d5db;
  --color-gray-500: #6b7280;
  --color-red-50: #fef2f2;
  --color-red-100: #fee2e2;
  --color-red-200: #fecaca;
  --color-red-600: #dc2626;
  --color-red-700: #b91c1c;
  --color-orange-50: #fff7ed;
  --color-orange-100: #ffedd5;
  --color-orange-200: #fed7aa;
  --color-orange-600: #ea580c;
  --color-orange-700: #c2410c;
  --color-amber-50: #fffbeb;
  --color-amber-100: #fef3c7;
  --color-amber-200: #fde68a;
  --color-amber-300: #fcd34d;
  --color-amber-500: #f59e0b;
  --color-amber-600: #d97706;
  --color-amber-700: #b45309;
  --color-amber-800: #92400e;
  --color-yellow-400: #facc15;
  --color-yellow-500: #eab308;
  --color-yellow-600: #ca8a04;
  --color-green-50: #f0fdf4;
  --color-green-200: #bbf7d0;
  --color-green-600: #16a34a;
  --color-green-700: #15803d;
  --color-emerald-50: #ecfdf5;
  --color-emerald-100: #d1fae5;
  --color-emerald-200: #a7f3d0;
  --color-emerald-300: #6ee7b7;
  --color-emerald-400: #34d399;
  --color-emerald-500: #10b981;
  --color-emerald-600: #059669;
  --color-emerald-700: #047857;
  --color-emerald-900: #064e3b;
  --color-emerald-950: #022c22;
  --color-purple-50: #faf5ff;
  --color-purple-200: #e9d5ff;
  --color-purple-600: #9333ea;
  --color-purple-700: #7e22ce;
  --color-indigo-500: #6366f1;
  --color-indigo-600: #4f46e5;
  --color-indigo-700: #4338ca;
  --color-black: #000;
  --color-white: #fff;
  --color-primary: #0f172a;
  --color-primary-foreground: #f8fafc;
  --color-muted: #f1f5f9;
  --color-muted-foreground: #64748b;
  --color-accent: #f1f5f9;
  --color-accent-foreground: #0f172a;
  --color-secondary: #f1f5f9;
  --color-secondary-foreground: #0f172a;
  --color-card: #fff;
  --color-card-foreground: #0f172a;
  --color-border: #e2e8f0;
  --color-destructive: #dc2626;
  --color-destructive-foreground: #f8fafc;
  --color-background: #fff;
  --color-foreground: #0f172a;
  --color-input: #e2e8f0;
  --color-ring: #0f172a;
  --color-popover: #fff;
  --color-popover-foreground: #0f172a;
  --radius-lg: 0.5rem;
  --radius-md: 0.375rem;
  --radius: 0.5rem;
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
}
`

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
  const [pdfGenerating, setPdfGenerating] = useState(false)
  const reportRef = useRef<HTMLDivElement>(null)

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

  async function handleDownloadPdf() {
    if (!reportRef.current) return
    setPdfGenerating(true)

    type RestoreFn = () => void
    const restoreFns: RestoreFn[] = []

    // ── Collect ALL CSS text from <link> + <style> elements ──────────
    const allCssParts: string[] = []

    // <link rel="stylesheet"> — fetch content, disable link
    const links = document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
    for (const link of links) {
      const wasDisabled = link.disabled
      link.disabled = true
      restoreFns.push(() => { link.disabled = wasDisabled })
      try {
        const res = await fetch(link.href)
        allCssParts.push(await res.text())
      } catch { /* best-effort */ }
    }

    // <style> elements — save textContent for restore, collect text
    const styles = document.querySelectorAll<HTMLStyleElement>('style')
    const savedStyleTexts: { el: HTMLStyleElement; text: string | null }[] = []
    styles.forEach(el => {
      savedStyleTexts.push({ el, text: el.textContent })
      if (el.textContent) allCssParts.push(el.textContent)
      el.textContent = ''
    })
    restoreFns.push(() => {
      savedStyleTexts.forEach(({ el, text }) => { el.textContent = text })
    })

    // ── Clean all CSS: strip oklch + color-mix(in oklab, …) ─────────
    let cleanCss = allCssParts.join('\n')
      // Replace oklch() with a safe placeholder (#000). Variable overrides
      // below will restore the correct hex equivalents for Tailwind vars.
      .replace(/oklch\([^)]+\)/g, '#000')
      // Strip color-mix(in oklab, …) inside @supports blocks — html2canvas
      // may also choke on these. Extract the base color (before the % arg).
      .replace(/color-mix\(in oklab,\s*([^,]+?)\s+\d+%\s*,\s*transparent\s*\)/g, '$1')

    // Append hex overrides for all Tailwind color variables
    cleanCss += TAILWIND_COLORS

    // ── Inject a single temp <style> with the cleaned CSS ────────────
    const tempStyle = document.createElement('style')
    tempStyle.textContent = cleanCss
    document.head.appendChild(tempStyle)
    restoreFns.push(() => tempStyle.remove())

    // ── Inline styles on report elements (unlikely to have oklch, but safe) ─
    const inlineEls = reportRef.current.querySelectorAll<HTMLElement>('[style]')
    const inlineRestores: { el: HTMLElement; style: string }[] = []
    inlineEls.forEach(el => {
      const orig = el.getAttribute('style') ?? ''
      if (orig.includes('oklch')) {
        el.setAttribute('style', orig.replace(/oklch\([^)]+\)/g, '#000'))
        inlineRestores.push({ el, style: orig })
      }
    })
    restoreFns.push(() => {
      inlineRestores.forEach(({ el, style }) => el.setAttribute('style', style))
    })

    // ── Capture ──────────────────────────────────────────────────────
    try {
      const html2canvas = (await import("html2canvas")).default
      const { jsPDF } = await import("jspdf")
      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff"
      })
      const imgData = canvas.toDataURL("image/png")
      const imgWidth = 190
      const imgHeight = (canvas.height * imgWidth) / canvas.width
      const pdf = new jsPDF("p", "mm", "a4")
      pdf.addImage(imgData, "PNG", 10, 10, imgWidth, imgHeight)
      pdf.save(`crawl-report-${id?.slice(0, 8) ?? "unknown"}.pdf`)
      toast({ title: "PDF downloaded", variant: "success" })
    } catch (err) {
      toast({ title: "Failed to generate PDF", description: (err as Error).message, variant: "destructive" })
    } finally {
      // Restore ALL modified CSS sources in reverse order
      for (const fn of restoreFns.reverse()) {
        try { fn() } catch { /* best-effort restore */ }
      }
      setPdfGenerating(false)
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

        {/* === Report Tab (new — for non-technical users) === */}
        <TabsContent value="report">
          {!summary ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-end">
                <Button
                  size="sm"
                  onClick={handleDownloadPdf}
                  disabled={pdfGenerating}
                >
                  {pdfGenerating ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <FileDown className="mr-1 h-4 w-4" />
                  )}
                  Download PDF Report
                </Button>
              </div>

              <div ref={reportRef} className="space-y-6 bg-white p-6 rounded-lg border" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
                {/* Brand Header */}
                <div style={{
                  background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                  borderRadius: "10px",
                  padding: "22px 28px",
                  marginBottom: "20px",
                  color: "#fff"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
                    <div>
                      <div style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", opacity: 0.8, marginBottom: "4px" }}>supacrawl</div>
                      <h2 style={{ fontSize: "22px", fontWeight: 700, margin: 0, lineHeight: 1.2 }}>Crawl Report</h2>
                      <p style={{ fontSize: "12px", opacity: 0.85, margin: "6px 0 0" }}>
                        {summary.jobName && <>{summary.jobName} · </>}
                        Started {formatDate(summary.startedAt)}
                        {summary.finishedAt && <> · Duration {formatDuration(summary.durationMs)}</>}
                      </p>
                    </div>
                    <div style={{
                      background: "rgba(255,255,255,0.15)",
                      borderRadius: "8px",
                      padding: "12px 16px",
                      textAlign: "center",
                      minWidth: "72px"
                    }}>
                      <div style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", opacity: 0.75, marginBottom: "2px" }}>Health</div>
                      <div style={{ fontSize: "28px", fontWeight: 800, lineHeight: 1 }}>{summary.healthScore}%</div>
                    </div>
                  </div>
                </div>

                {/* Stats cards row */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5, 1fr)",
                  gap: "10px",
                  marginBottom: "16px"
                }}>
                  {(() => {
                    const stats = [
                      { label: "Broken", value: summary.issues.broken.length, icon: "\u{1F6A8}", color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
                      { label: "Changed", value: summary.issues.changed.length, icon: "\u{1F504}", color: "#d97706", bg: "#fffbeb", border: "#fde68a" },
                      { label: "SSL Expiring", value: summary.issues.sslExpiring.length, icon: "\u{1F512}", color: "#ea580c", bg: "#fff7ed", border: "#fed7aa" },
                      { label: "Mojibake", value: summary.issues.mojibake.length, icon: "\u{1F524}", color: "#9333ea", bg: "#faf5ff", border: "#e9d5ff" },
                      { label: "LLM Garbage", value: summary.issues.llmGarbage.length, icon: "\u{1F916}", color: "#0891b2", bg: "#ecfeff", border: "#a5f3fc" }
                    ]
                    return stats.map((s, i) => (
                      <div key={i} style={{
                        background: s.bg,
                        border: `1px solid ${s.border}`,
                        borderRadius: "8px",
                        padding: "14px 10px",
                        textAlign: "center"
                      }}>
                        <div style={{ fontSize: "20px", marginBottom: "4px" }}>{s.icon}</div>
                        <div style={{ fontSize: "22px", fontWeight: 700, color: s.value > 0 ? s.color : "#059669" }}>{s.value}</div>
                        <div style={{ fontSize: "10px", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>{s.label}</div>
                      </div>
                    ))
                  })()}
                </div>

                {/* Performance section */}
                <div style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  padding: "16px 18px",
                  marginBottom: "16px"
                }}>
                  <h3 style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a", margin: "0 0 10px" }}>{"\u{1F4CA}"} Performance</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
                    {([
                      { label: "Average", value: summary.avgResponseTimeMs },
                      { label: "Fastest", value: summary.fastestResponseTimeMs },
                      { label: "Slowest", value: summary.slowestResponseTimeMs }
                    ]).map((m, i) => (
                      <div key={i} style={{ textAlign: "center" }}>
                        <div style={{ fontSize: "10px", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "3px" }}>{m.label}</div>
                        <div style={{ fontSize: "15px", fontWeight: 600, color: "#0f172a", fontFamily: "'JetBrains Mono', monospace" }}>
                          {m.value !== null ? `${m.value}ms` : "—"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Issues sections */}
                {summary.issues.broken.length > 0 && (
                  <PdfIssueSection title={"\u{1F6A8} Broken URLs"} count={summary.issues.broken.length} color="#dc2626" bg="#fef2f2" border="#fecaca" items={summary.issues.broken.map((i) => ({ url: i.url, detail: i.detail }))} />
                )}
                {summary.issues.changed.length > 0 && (
                  <PdfIssueSection title={"\u{1F504} Changed URLs"} count={summary.issues.changed.length} color="#d97706" bg="#fffbeb" border="#fde68a" items={summary.issues.changed.map((i) => ({ url: i.url, detail: i.detail }))} />
                )}
                {summary.issues.sslExpiring.length > 0 && (
                  <PdfIssueSection title={"\u{1F512} SSL Certificates Expiring Soon"} count={summary.issues.sslExpiring.length} color="#ea580c" bg="#fff7ed" border="#fed7aa" items={summary.issues.sslExpiring.map((i) => ({ url: i.url, detail: i.detail }))} />
                )}
                {summary.issues.mojibake.length > 0 && (
                  <PdfIssueSection title={"\u{1F524} Mojibake (Garbled Text)"} count={summary.issues.mojibake.length} color="#9333ea" bg="#faf5ff" border="#e9d5ff" items={summary.issues.mojibake.map((i) => ({ url: i.url, detail: i.detail }))} />
                )}
                {summary.issues.llmGarbage.length > 0 && (
                  <PdfIssueSection title={"\u{1F916} LLM Garbage (AI Artifacts)"} count={summary.issues.llmGarbage.length} color="#0891b2" bg="#ecfeff" border="#a5f3fc" items={summary.issues.llmGarbage.map((i) => ({ url: i.url, detail: i.detail }))} />
                )}

                {/* Everything clean */}
                {summary.issues.broken.length === 0 &&
                  summary.issues.changed.length === 0 &&
                  summary.issues.sslExpiring.length === 0 &&
                  summary.issues.mojibake.length === 0 &&
                  summary.issues.llmGarbage.length === 0 && (
                    <div style={{
                      background: "#ecfdf5",
                      border: "1px solid #a7f3d0",
                      borderRadius: "8px",
                      padding: "24px",
                      textAlign: "center"
                    }}>
                      <div style={{ fontSize: "32px", marginBottom: "8px" }}>{"\u2705"}</div>
                      <div style={{ fontSize: "16px", fontWeight: 700, color: "#047857", marginBottom: "4px" }}>All clear!</div>
                      <div style={{ fontSize: "12px", color: "#059669" }}>No issues found in this crawl. All URLs are healthy.</div>
                    </div>
                  )}

                {/* Footer */}
                <div style={{
                  textAlign: "center",
                  fontSize: "10px",
                  color: "#94a3b8",
                  paddingTop: "16px",
                  borderTop: "1px solid #e2e8f0",
                  marginTop: "8px"
                }}>
                  supacrawl · Automated crawl report · ID {summary.crawlId?.slice(0, 8) ?? id?.slice(0, 8)}
                </div>
              </div>
            </>
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

function PdfIssueSection({
  title,
  count,
  color,
  bg,
  border,
  items
}: {
  title: string
  count: number
  color: string
  bg: string
  border: string
  items: { url: string; detail: string }[]
}) {
  return (
    <div style={{
      border: `1px solid ${border}`,
      borderRadius: "8px",
      overflow: "hidden",
      marginBottom: "10px"
    }}>
      <div style={{
        background: bg,
        padding: "10px 16px",
        fontSize: "13px",
        fontWeight: 700,
        color,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center"
      }}>
        <span>{title} ({count})</span>
      </div>
      <div>
        {items.map((item, idx) => (
          <div key={idx} style={{
            padding: "10px 16px",
            borderTop: "1px solid #f1f5f9",
            fontSize: "12px"
          }}>
            <div style={{ color: "#0f172a", wordBreak: "break-all", marginBottom: item.detail ? "2px" : 0 }}>
              {item.url}
            </div>
            {item.detail && (
              <div style={{ color: "#64748b", fontSize: "11px" }}>{item.detail}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
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

