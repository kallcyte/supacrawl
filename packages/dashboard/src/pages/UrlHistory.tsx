import { useEffect, useState, useMemo } from "react"
import { useSearchParams } from "react-router-dom"
import { api, type CrawlResult, type UrlState } from "@/lib/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
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
import ResponseTimeLine from "@/components/charts/ResponseTimeLine"
import SeoSnapshot from "@/components/SeoSnapshot"
import { formatDate, formatDuration, truncate } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { Activity, ArrowRightLeft, Bug, Clock, Gauge, Info, ShieldAlert, TrendingDown, TrendingUp } from "lucide-react"
import PageInfo from "@/components/PageInfo"
import urlHistoryExplainer from "@/content/url-history-explainer.md?raw"

function seoChanges(curr: CrawlResult["seo"], prev: CrawlResult["seo"]): string[] {
  if (!curr) return []
  if (!prev) return ["captured"]
  const changed: string[] = []
  if (curr.title !== prev.title) changed.push("title")
  if (curr.description !== prev.description) changed.push("description")
  if (curr.canonical !== prev.canonical) changed.push("canonical")
  if (curr.noindex !== prev.noindex) changed.push("noindex")
  if (curr.nofollow !== prev.nofollow) changed.push("nofollow")
  if (curr.h1Count !== prev.h1Count) changed.push("h1")
  if (curr.wordCount !== prev.wordCount) changed.push("words")
  if (curr.jsonLdTypes.join(",") !== prev.jsonLdTypes.join(",")) changed.push("json-ld")
  if (curr.ogTitle !== prev.ogTitle || curr.ogDescription !== prev.ogDescription || curr.ogImage !== prev.ogImage) changed.push("og tags")
  if (curr.publishedAt !== prev.publishedAt) changed.push("published date")
  return changed
}

export default function UrlHistoryPage() {
  const [params, setParams] = useSearchParams()
  const initial = params.get("url") ?? ""
  const [url, setUrl] = useState(initial)
  const [urls, setUrls] = useState<UrlState[]>([])
  const [history, setHistory] = useState<CrawlResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.listUrls(500).then((r) => setUrls(r.urls)).catch(() => {})
  }, [])

  async function loadHistory(target: string) {
    if (!target) return
    setLoading(true)
    setError(null)
    try {
      const r = await api.getUrlHistory(target, 200)
      setHistory(r.history)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (initial) loadHistory(initial)
  }, [initial])

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setParams({ url })
    loadHistory(url)
  }

  const summary = useMemo(() => {
    if (history.length === 0) return null
    const last = history[0]
    const failed = history.filter((h) => (h.statusCode ?? 0) >= 400 || h.statusCode === null).length
    const changed = history.filter((h) => h.contentChanged).length
    const redirects = history.filter((h) => (h.statusCode ?? 0) >= 300 && (h.statusCode ?? 0) < 400).length
    const mojibake = history.filter((h) => h.mojibakeFlagged).length
    const avgTime = history.reduce((sum, h) => sum + (h.responseTimeMs ?? 0), 0) / history.length
    const sslExpiring = history.some((h) => {
      if (!h.sslValidUntil) return false
      const days = (new Date(h.sslValidUntil).getTime() - Date.now()) / 86400000
      return days > 0 && days < 30
    })
    const firstEntry = history[history.length - 1]
    const firstTime = firstEntry ? new Date(firstEntry.checkedAt).getTime() : Date.now()
    const timeRangeDays = Math.max(1, Math.round((Date.now() - firstTime) / 86400000))
    const avgPerDay = (history.length / timeRangeDays).toFixed(1)
    return {
      last,
      failed,
      changed,
      redirects,
      mojibake,
      avgTime,
      sslExpiring,
      failureRate: Math.round((failed / history.length) * 100),
      changeRate: Math.round((changed / history.length) * 100),
      avgPerDay
    }
  }, [history])

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">URL History</h1>
          <p className="text-sm text-muted-foreground">
            Inspect how a single URL has changed across crawls
          </p>
        </div>
        <PageInfo title="URL History" content={urlHistoryExplainer} className="ml-auto h-8 w-8" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Choose a URL</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex gap-2">
            <Input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/page"
              required
            />
            <Button type="submit" disabled={loading}>
              {loading ? "Loading..." : "View history"}
            </Button>
          </form>
          {urls.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                Recent URLs
              </p>
              <div className="max-h-36 space-y-1 overflow-auto text-sm">
                {urls.slice(0, 12).map((u) => (
                  <button
                    key={u.url}
                    className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-muted/50"
                    onClick={() => {
                      setUrl(u.url)
                      setParams({ url: u.url })
                      loadHistory(u.url)
                    }}
                  >
                    <span className="truncate text-primary hover:underline">{u.url}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {u.lastStatusCode !== null && u.lastStatusCode < 300 ? (
                        <Badge variant="success" className="px-1 py-0 text-[10px]">
                          {u.lastStatusCode}
                        </Badge>
                      ) : u.lastStatusCode !== null && u.lastStatusCode < 400 ? (
                        <Badge variant="warning" className="px-1 py-0 text-[10px]">
                          {u.lastStatusCode}
                        </Badge>
                      ) : u.lastStatusCode !== null ? (
                        <Badge variant="destructive" className="px-1 py-0 text-[10px]">
                          {u.lastStatusCode}
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="px-1 py-0 text-[10px]">ERR</Badge>
                      )}
                      {u.consecutiveFailures > 0 && (
                        <span className="text-[11px] text-muted-foreground">
                          {u.consecutiveFailures}x
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
        </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {initial && summary && (
        <TooltipProvider>
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center gap-1.5">
                <CardDescription className="text-xs">Status</CardDescription>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="inline-flex"><Info className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground" /></button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px]">
                    The HTTP status code from the most recent check. 2xx = healthy, 3xx = redirect, 4xx/5xx = broken.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Activity className="h-3.5 w-3.5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <Badge
                variant={
                  summary.last.statusCode !== null && summary.last.statusCode < 300
                    ? "success"
                    : summary.last.statusCode !== null && summary.last.statusCode < 400
                      ? "warning"
                      : "destructive"
                }
              >
                {summary.last.statusCode ?? "ERR"}
              </Badge>
              {summary.last.error && (
                <p className="mt-1 text-xs text-muted-foreground truncate" title={summary.last.error}>
                  {summary.last.error}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center gap-1.5">
                <CardDescription className="text-xs">Response Time</CardDescription>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="inline-flex"><Info className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground" /></button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px]">
                    Response time from the latest check, plus the average across all recorded checks.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{formatDuration(summary.last.responseTimeMs)}</div>
              <p className="text-xs text-muted-foreground">avg {formatDuration(Math.round(summary.avgTime))}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center gap-1.5">
                <CardDescription className="text-xs">Failure Rate</CardDescription>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="inline-flex"><Info className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground" /></button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px]">
                      Percentage of checks that returned a 4xx/5xx status code or connection error. Lower is better.
                  </TooltipContent>
                </Tooltip>
              </div>
              <TrendingDown className="h-3.5 w-3.5 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-destructive">{summary.failureRate}%</div>
              <p className="text-xs text-muted-foreground">{summary.failed} of {history.length} checks</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center gap-1.5">
                <CardDescription className="text-xs">Content Changes</CardDescription>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="inline-flex"><Info className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground" /></button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px]">
                    Percentage of checks where the page content hash differed from the previous check, indicating the page was updated.
                  </TooltipContent>
                </Tooltip>
              </div>
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{summary.changeRate}%</div>
              <p className="text-xs text-muted-foreground">{summary.changed} changes detected</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center gap-1.5">
                <CardDescription className="text-xs">Check Frequency</CardDescription>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="inline-flex"><Info className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground" /></button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px]">
                    Average number of times this URL is checked per day, based on all recorded crawls. Higher values mean more frequent monitoring.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{summary.avgPerDay}</div>
              <p className="text-xs text-muted-foreground">checks per day</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center gap-1.5">
                <CardDescription className="text-xs">SSL</CardDescription>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="inline-flex"><Info className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground" /></button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px]">
                    Days until the TLS/SSL certificate expires. If no certificate is present or the URL uses plain HTTP, this shows N/A.
                  </TooltipContent>
                </Tooltip>
              </div>
              {summary.sslExpiring ? (
                <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
              ) : (
                <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </CardHeader>
            <CardContent>
              {summary.last.sslValidUntil ? (
                <>
                  <div className="text-xl font-bold">
                    {Math.round((new Date(summary.last.sslValidUntil).getTime() - Date.now()) / 86400000)}d
                  </div>
                  <p className="text-xs text-muted-foreground">until expiry</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">N/A</p>
              )}
            </CardContent>
          </Card>
        </div>
        </TooltipProvider>
      )}

      {initial && summary && summary.last.seo && (
        <SeoSnapshot seo={summary.last.seo} checkedAt={summary.last.checkedAt} />
      )}

      {initial && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Response time</CardTitle>
              <CardDescription>{truncate(initial, 80)}</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-64 w-full" />
              ) : history.length === 0 ? (
                <p className="text-sm text-muted-foreground">No history yet for this URL.</p>
              ) : (
                <ResponseTimeLine
                  data={history.map((h) => ({
                    time: h.checkedAt,
                    value: h.responseTimeMs ?? 0
                  }))}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Crawl history</CardTitle>
              <CardDescription>{history.length} entries</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <div className="overflow-auto">
                <div className="min-w-[800px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Checked</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Time</TableHead>
                      <TableHead>Details</TableHead>
                      <TableHead>Changed</TableHead>
                      <TableHead>SEO</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((h, index) => (
                      <TableRow key={h.id}>
                        <TableCell className="font-mono text-xs whitespace-nowrap">
                          {formatDate(h.checkedAt)}
                        </TableCell>
                        <TableCell>
                          {h.statusCode === null ? (
                            <Badge variant="destructive">ERR</Badge>
                          ) : (
                            <Badge
                              variant={
                                h.statusCode < 300
                                  ? "success"
                                  : h.statusCode < 400
                                    ? "warning"
                                    : "destructive"
                              }
                            >
                              {h.statusCode}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-xs">
                            {h.checkMethod}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {formatDuration(h.responseTimeMs)}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex flex-wrap items-center gap-1">
                            {h.error && (
                              <span className="text-destructive" title={h.error}>
                                {h.error}
                              </span>
                            )}
                            {h.redirectChain && (
                              <span className="inline-flex items-center gap-0.5 text-yellow-600 dark:text-yellow-400" title={h.redirectChain}>
                                <ArrowRightLeft className="h-3 w-3" />
                                {h.redirectChain.split(" → ").length - 1} hop(s)
                              </span>
                            )}
                            {h.mojibakeFlagged && (
                              <span className="inline-flex items-center gap-0.5 text-amber-500" title={`Mojibake score: ${h.mojibakeScore !== null ? Math.round(h.mojibakeScore * 100) : "?"}%`}>
                                <Bug className="h-3 w-3" />
                                {h.mojibakeScore !== null ? `${Math.round(h.mojibakeScore * 100)}%` : ""}
                              </span>
                            )}
                            {h.sslValidUntil && (
                              <span className="text-muted-foreground" title={`SSL expires ${new Date(h.sslValidUntil).toLocaleDateString()}`}>
                                SSL {Math.round((new Date(h.sslValidUntil).getTime() - Date.now()) / 86400000)}d
                              </span>
                            )}
                            {h.sitemapLastmod && (
                              <span className="text-muted-foreground" title={`Sitemap lastmod: ${h.sitemapLastmod}`}>
                                mod
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {h.contentChanged ? (
                            <Badge variant="warning">changed</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {h.seo ? (
                            <div className="flex flex-wrap items-center gap-1">
                              {h.seo.noindex && (
                                <Badge variant="destructive" className="text-[10px]">noindex</Badge>
                              )}
                              {h.seo.canonical && h.seo.canonicalSelfReference === false && (
                                <Badge variant="warning" className="text-[10px]" title={`Canonical: ${h.seo.canonical}`}>
                                  canon
                                </Badge>
                              )}
                              {!h.seo.title && (
                                <Badge variant="warning" className="text-[10px]" title="Missing title tag">no title</Badge>
                              )}
                              {!h.seo.description && (
                                <Badge variant="warning" className="text-[10px]" title="Missing meta description">no desc</Badge>
                              )}
                              {h.seo.h1Count === 0 && (
                                <Badge variant="warning" className="text-[10px]" title="Missing H1">no h1</Badge>
                              )}
                              {h.seo.h1Count > 1 && (
                                <Badge variant="warning" className="text-[10px]" title={`${h.seo.h1Count} H1 tags`}>h1 x{h.seo.h1Count}</Badge>
                              )}
                              {seoChanges(h.seo, history[index + 1]?.seo ?? null).map((c) => (
                                <Badge key={c} variant="secondary" className="text-[10px]">
                                  {c} changed
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
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
        </>
      )}
    </div>
  )
}
