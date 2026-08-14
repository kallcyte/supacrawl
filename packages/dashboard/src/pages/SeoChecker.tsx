import { useEffect, useMemo, useState } from "react"
import { usePageTitle } from "@/lib/usePageTitle"
import { useSearchParams } from "react-router-dom"
import { api, type SeoCheckResult, type UrlState } from "@/lib/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import PageInfo from "@/components/PageInfo"
import SearchPreview from "@/components/seo/SearchPreview"
import SocialPreviews from "@/components/seo/SocialPreviews"
import SeoScore from "@/components/seo/SeoScore"
import MetaTagsPanel from "@/components/seo/MetaTagsPanel"
import PageWeight from "@/components/seo/PageWeight"
import { SearchCheck, Loader2, AlertCircle, Globe, ArrowRightLeft, Clock, RefreshCw } from "lucide-react"
import seoExplainer from "@/content/seo-explainer.md?raw"
import { formatDuration } from "@/lib/utils"

function ResultSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-96 lg:col-span-2" />
        <Skeleton className="h-64" />
      </div>
      <Skeleton className="h-64" />
      <Skeleton className="h-48" />
    </div>
  )
}

export default function SeoCheckerPage() {
  usePageTitle("SEO Checker")
  const [params, setParams] = useSearchParams()
  const initial = params.get("url") ?? ""
  const [url, setUrl] = useState(initial)
  const [urls, setUrls] = useState<UrlState[]>([])
  const [result, setResult] = useState<SeoCheckResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.listUrls(500).then((r) => setUrls(r.urls)).catch(() => {})
  }, [])

  async function runCheck(target: string) {
    if (!target) return
    setLoading(true)
    setError(null)
    try {
      const r = await api.seoCheck(target)
      setResult(r)
    } catch (err) {
      setError((err as Error).message)
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (initial) runCheck(initial)
  }, [initial])

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setParams({ url })
    runCheck(url)
  }

  const analysis = result?.analysis ?? null
  const seo = analysis?.seo ?? null
  const failed = analysis?.statusCode == null || analysis.statusCode >= 400
  const redirected = (analysis?.redirectChain.length ?? 0) > 0

  const badgeVariant = useMemo(() => {
    if (analysis?.statusCode == null) return "destructive" as const
    if (analysis.statusCode < 300) return "success" as const
    if (analysis.statusCode < 400) return "warning" as const
    return "destructive" as const
  }, [analysis?.statusCode])

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">SEO Checker</h1>
          <p className="text-sm text-muted-foreground">
            Preview search &amp; social snippets and get an actionable SEO score
          </p>
        </div>
        <PageInfo title="SEO Checker" content={seoExplainer} className="ml-auto h-8 w-8" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SearchCheck className="h-4 w-4 text-muted-foreground" />
            Check a URL
          </CardTitle>
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
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Check SEO
            </Button>
          </form>
          {urls.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                From crawl history
              </p>
              <div className="max-h-32 space-y-1 overflow-auto text-sm">
                {urls.slice(0, 12).map((u) => (
                  <button
                    key={u.url}
                    className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-muted/50"
                    onClick={() => {
                      setUrl(u.url)
                      setParams({ url: u.url })
                      runCheck(u.url)
                    }}
                  >
                    <span className="truncate text-primary hover:underline">{u.url}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {u.lastStatusCode !== null && u.lastStatusCode < 300 ? (
                        <Badge variant="success" className="px-1 py-0 text-[10px]">{u.lastStatusCode}</Badge>
                      ) : u.lastStatusCode !== null && u.lastStatusCode < 400 ? (
                        <Badge variant="warning" className="px-1 py-0 text-[10px]">{u.lastStatusCode}</Badge>
                      ) : u.lastStatusCode !== null ? (
                        <Badge variant="destructive" className="px-1 py-0 text-[10px]">{u.lastStatusCode}</Badge>
                      ) : (
                        <Badge variant="destructive" className="px-1 py-0 text-[10px]">ERR</Badge>
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

      {loading && <ResultSkeleton />}

      {result && !loading && analysis && (
        <>
          {(failed || redirected || analysis.error) && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div>
                <p className="font-medium text-amber-700 dark:text-amber-300">
                  {analysis.error
                    ? `Could not retrieve the page: ${analysis.error}`
                    : statusText(analysis.statusCode)}
                </p>
                {failed && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    SEO data may be unavailable because the page did not return a successful HTML response.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              {result.score !== undefined && (
                <SeoScore score={result.score} categories={result.categories} audits={result.audits} />
              )}
            </div>
            <div className="space-y-4">
              <SearchPreview seo={seo} finalUrl={analysis.finalUrl} />
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Check details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Globe className="h-3.5 w-3.5" /> Status</span>
                    <Badge variant={badgeVariant}>{analysis.statusCode ?? "ERR"}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><ArrowRightLeft className="h-3.5 w-3.5" /> Redirects</span>
                    <span className="font-mono text-xs">{redirected ? `${analysis.redirectChain.length} hop(s)` : "none"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" /> Response time</span>
                    <span className="font-mono text-xs">{formatDuration(analysis.responseTimeMs)}</span>
                  </div>
                  {analysis.finalUrl && analysis.finalUrl !== analysis.url && (
                    <p className="break-all font-mono text-xs text-muted-foreground" title="Final URL after redirects">
                      → {analysis.finalUrl}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          <SocialPreviews seo={seo} finalUrl={analysis.finalUrl} />

          <PageWeight
            seo={seo}
            content={analysis.content}
            pageWeightBytes={analysis.pageWeightBytes}
            gzippedBytes={analysis.gzippedBytes}
            responseTimeMs={analysis.responseTimeMs}
            sslValidUntil={analysis.sslValidUntil}
          />

          <MetaTagsPanel seo={seo} />
        </>
      )}
    </div>
  )
}

function statusText(code: number | null): string {
  if (code == null) return "The page could not be retrieved."
  if (code >= 500) return `The server returned an error (${code}).`
  if (code >= 400) return `The page returned ${code} (client error).`
  if (code >= 300) return `The page redirected (${code}) before the final response was captured.`
  return `The page responded with ${code}.`
}