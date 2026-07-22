import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { api, type CrawlRecord } from "@/lib/api"
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
import { formatDate, formatDuration } from "@/lib/utils"
import { Play, Trash2, Loader2 } from "lucide-react"
import { useCrawlNotifications } from "@/lib/useCrawlNotifications"

export default function CrawlsPage() {
  const navigate = useNavigate()
  const [crawls, setCrawls] = useState<CrawlRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useCrawlNotifications(crawls)

  async function load() {
    try {
      const r = await api.listCrawls(100, 0)
      setCrawls(r.crawls)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function startCrawl() {
    setStarting(true)
    try {
      const { crawlId } = await api.startCrawl()
      navigate(`/crawls/${crawlId}`)
    } catch (err) {
      setError((err as Error).message)
      setStarting(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this crawl and all its results?")) return
    setDeleting(id)
    try {
      await api.deleteCrawl(id)
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDeleting(null)
    }
  }

  useEffect(() => {
    load()
    const i = setInterval(load, 5000)
    return () => clearInterval(i)
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Crawls</h1>
          <p className="text-sm text-muted-foreground">All crawl runs and their results</p>
        </div>
        <Button onClick={startCrawl} disabled={starting}>
          <Play className="mr-1 h-3.5 w-3.5" />
          {starting ? "Starting..." : "Start crawl"}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
          <CardDescription>{crawls.length} crawl(s) recorded</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : crawls.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No crawls yet. Click "Start crawl" to run one.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Checked</TableHead>
                  <TableHead className="text-right">Broken</TableHead>
                  <TableHead className="text-right">Changed</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {crawls.map((c) => {
                  const duration =
                    c.finishedAt && c.startedAt
                      ? Date.parse(c.finishedAt) - Date.parse(c.startedAt)
                      : null
                  return (
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
                      </TableCell>
                      <TableCell className="text-right">{c.urlsTotal}</TableCell>
                      <TableCell className="text-right">{c.urlsChecked}</TableCell>
                      <TableCell className="text-right">
                        {c.urlsBroken > 0 ? (
                          <span className="font-semibold text-destructive">
                            {c.urlsBroken}
                          </span>
                        ) : (
                          c.urlsBroken
                        )}
                      </TableCell>
                      <TableCell className="text-right">{c.urlsChanged}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatDuration(duration)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button asChild variant="ghost" size="sm">
                            <Link to={`/crawls/${c.id}`}>Open</Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDelete(c.id)}
                            disabled={deleting === c.id}
                          >
                            {deleting === c.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
