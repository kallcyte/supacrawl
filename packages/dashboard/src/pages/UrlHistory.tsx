import { useEffect, useState } from "react"
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
import { formatDate, formatDuration, truncate } from "@/lib/utils"

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">URL History</h1>
        <p className="text-sm text-muted-foreground">
          Inspect how a single URL has changed across crawls
        </p>
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
              <div className="max-h-32 space-y-1 overflow-auto text-sm">
                {urls.slice(0, 12).map((u) => (
                  <button
                    key={u.url}
                    className="block w-full truncate text-left text-primary hover:underline"
                    onClick={() => {
                      setUrl(u.url)
                      setParams({ url: u.url })
                      loadHistory(u.url)
                    }}
                  >
                    {u.url}
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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Checked</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Response time</TableHead>
                      <TableHead>Changed?</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((h) => (
                      <TableRow key={h.id}>
                        <TableCell className="font-mono text-xs">
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
                        <TableCell>
                          {h.contentChanged ? (
                            <Badge variant="warning">changed</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
