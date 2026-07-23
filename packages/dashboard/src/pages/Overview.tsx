import { useEffect, useState } from "react"
import { api, type CrawlRecord, type OverviewStats, type TimelinePoint, type DurationPoint } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Activity, AlertTriangle, ArrowRight, FileCheck2, Globe } from "lucide-react"
import { Link } from "react-router-dom"
import { formatDate } from "@/lib/utils"
import HealthRatioArea from "@/components/charts/HealthRatioArea"
import CrawlDurationBar from "@/components/charts/CrawlDurationBar"
import LiveProgress from "@/components/LiveProgress"

function StatCard({
  title,
  value,
  icon: Icon,
  description
}: {
  title: string
  value: string | number
  icon: React.ComponentType<{ className?: string }>
  description?: string
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </CardContent>
    </Card>
  )
}

export default function OverviewPage() {
  const [overview, setOverview] = useState<OverviewStats | null>(null)
  const [timeline, setTimeline] = useState<TimelinePoint[]>([])
  const [duration, setDuration] = useState<DurationPoint[]>([])
  const [activeCrawl, setActiveCrawl] = useState<CrawlRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const [ov, tl, du, ac] = await Promise.all([
        api.getOverview(),
        api.getTimeline(),
        api.getDurationTrend(),
        api.getActiveCrawls()
      ])
      setOverview(ov)
      setTimeline(tl.timeline)
      setDuration(du.trend)
      setActiveCrawl(ac.crawls[0] ?? null)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const i = setInterval(load, 4000)
    return () => clearInterval(i)
  }, [])

  if (loading && !overview) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Sitemap health and crawl activity
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/crawls">
              View crawls <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
          <Button size="sm" onClick={load}>
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Tracked URLs"
          value={overview?.totalUrls ?? 0}
          icon={Globe}
          description="Unique URLs discovered"
        />
        <StatCard
          title="Total Crawls"
          value={overview?.totalCrawls ?? 0}
          icon={Activity}
          description={overview?.lastCrawlAt ? `Last: ${formatDate(overview.lastCrawlAt)}` : "No crawls yet"}
        />
        <StatCard
          title="Broken Right Now"
          value={overview?.brokenNow ?? 0}
          icon={AlertTriangle}
          description="URLs with 4xx/5xx"
        />
        <StatCard
          title="Last Crawl Issues"
          value={`${overview?.lastCrawlBroken ?? 0} broken · ${overview?.lastCrawlChanged ?? 0} changed`}
          icon={FileCheck2}
        />
      </div>

      <LiveProgress crawl={activeCrawl ?? undefined} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Healthy vs Broken</CardTitle>
            <CardDescription>Last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            <HealthRatioArea data={timeline} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Crawl Duration</CardTitle>
            <CardDescription>Last 30 runs</CardDescription>
          </CardHeader>
          <CardContent>
            <CrawlDurationBar data={duration} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
