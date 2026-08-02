import { useState } from "react"
import type { SeoInfo } from "@/lib/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, Check, FileText, Search } from "lucide-react"

interface Props {
  seo: SeoInfo | null
  checkedAt?: string
}

export function seoIssues(seo: SeoInfo | null): string[] {
  if (!seo) return []
  const issues: string[] = []
  if (!seo.title) issues.push("Missing <title>")
  else if (seo.titleLength > 60) issues.push(`Title too long (${seo.titleLength} chars)`)
  if (!seo.description) issues.push("Missing meta description")
  else if (seo.descriptionLength > 160) issues.push(`Description too long (${seo.descriptionLength} chars)`)
  if (seo.canonical && seo.canonicalSelfReference === false) issues.push("Canonical points to a different URL")
  if (seo.noindex) issues.push("Blocked with noindex")
  if (seo.h1Count === 0) issues.push("Missing H1")
  else if (seo.h1Count > 1) issues.push(`${seo.h1Count} H1 tags on page`)
  return issues
}

function formatBytes(b: number): string {
  return b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`
}

function OgImagePreview({ src }: { src: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      src={src}
      alt="Open Graph image"
      referrerPolicy="no-referrer"
      className="h-12 w-20 shrink-0 rounded border object-cover"
      onError={() => setFailed(true)}
    />
  )
}

function Row({
  label,
  value,
  sub,
  warn
}: {
  label: string
  value: React.ReactNode
  sub?: string
  warn?: boolean
}) {
  return (
    <div className="space-y-1 border-b border-border/60 py-2 last:border-0">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {label}
        {warn && <AlertTriangle className="h-3 w-3 text-amber-500" />}
      </div>
      <div className="text-sm">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

export default function SeoSnapshot({ seo, checkedAt }: Props) {
  const issues = seoIssues(seo)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            SEO snapshot
          </CardTitle>
          {checkedAt && <CardDescription>Captured {new Date(checkedAt).toLocaleString()}</CardDescription>}
        </div>
        {issues.length > 0 && (
          <Badge variant="warning">{issues.length} issue{issues.length > 1 ? "s" : ""}</Badge>
        )}
      </CardHeader>
      <CardContent>
        {!seo ? (
          <p className="text-sm text-muted-foreground">
            No SEO data captured for this check. SEO is extracted from GET responses below 5 MB.
          </p>
        ) : (
          <div className="space-y-3">
            {issues.length > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-600">
                  <AlertTriangle className="h-3.5 w-3.5" /> Potential issues
                </p>
                <ul className="space-y-0.5 text-xs text-amber-700">
                  {issues.map((i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      <span className="h-1 w-1 rounded-full bg-amber-500" /> {i}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Row
              label="Title"
              warn={!seo.title || seo.titleLength > 60}
              value={
                seo.title ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{seo.title}</span>
                    <Badge variant={seo.titleLength > 60 ? "warning" : "outline"} className="text-[10px]">
                      {seo.titleLength} chars
                    </Badge>
                  </span>
                ) : (
                  <span className="text-destructive">Missing</span>
                )
              }
            />

            <Row
              label="Meta description"
              warn={!seo.description || seo.descriptionLength > 160}
              value={
                seo.description ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">{seo.description}</span>
                    <Badge variant={seo.descriptionLength > 160 ? "warning" : "outline"} className="text-[10px]">
                      {seo.descriptionLength} chars
                    </Badge>
                  </span>
                ) : (
                  <span className="text-destructive">Missing</span>
                )
              }
            />

            <Row
              label="Canonical"
              warn={seo.canonical !== null && seo.canonicalSelfReference === false}
              value={
                seo.canonical ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="break-all font-mono text-xs">{seo.canonical}</span>
                    {seo.canonicalSelfReference === false ? (
                      <Badge variant="warning" className="text-[10px]">different URL</Badge>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                        <Check className="h-3 w-3" /> self-referencing
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Not set</span>
                )
              }
            />

            <Row
              label="Indexing"
              value={
                <div className="flex flex-wrap items-center gap-1.5">
                  {seo.noindex ? (
                    <Badge variant="destructive" className="text-[10px]">noindex</Badge>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                      <Check className="h-3 w-3" /> indexable
                    </span>
                  )}
                  {seo.nofollow && <Badge variant="warning" className="text-[10px]">nofollow</Badge>}
                </div>
              }
            />

            <Row
              label="Headings"
              warn={seo.h1Count !== 1}
              value={<span className="font-medium">{seo.h1Count} H1</span>}
            />

            <Row
              label="Published"
              value={
                seo.publishedAt ? (
                  <span className="font-medium">
                    {new Date(seo.publishedAt).toLocaleString()}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Not set</span>
                )
              }
            />

            <Row
              label="Open Graph title"
              warn={!seo.ogTitle}
              value={
                seo.ogTitle ? (
                  <span className="font-medium">{seo.ogTitle}</span>
                ) : (
                  <span className="text-muted-foreground">Not set</span>
                )
              }
            />

            <Row
              label="Open Graph description"
              warn={!seo.ogDescription}
              value={
                seo.ogDescription ? (
                  <span className="text-muted-foreground">{seo.ogDescription}</span>
                ) : (
                  <span className="text-muted-foreground">Not set</span>
                )
              }
            />

            <Row
              label="Open Graph image"
              warn={!seo.ogImage}
              value={
                seo.ogImage ? (
                  <div className="flex items-start gap-3">
                    <OgImagePreview src={seo.ogImage} />
                    <span className="break-all font-mono text-xs text-muted-foreground">{seo.ogImage}</span>
                  </div>
                ) : (
                  <span className="text-muted-foreground">Not set</span>
                )
              }
            />

            <div className="grid grid-cols-2 gap-3 pt-1 sm:grid-cols-3">
              <div className="rounded-md border p-3 text-center">
                <p className="text-lg font-bold">{seo.wordCount.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">words</p>
              </div>
              <div className="rounded-md border p-3 text-center">
                <p className="text-lg font-bold">{formatBytes(seo.pageWeightBytes)}</p>
                <p className="text-xs text-muted-foreground">page weight</p>
              </div>
              <div className="rounded-md border p-3 text-center">
                <p className="text-lg font-bold">{seo.jsonLdTypes.length || "-"}</p>
                <p className="text-xs text-muted-foreground">schema types</p>
              </div>
            </div>

            {(seo.jsonLdTypes.length > 0 || seo.ogTitle || seo.ogDescription) && (
              <div className="space-y-1 border-t border-border/60 pt-2">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <FileText className="h-3 w-3" /> Structured data
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {seo.jsonLdTypes.map((t) => (
                    <Badge key={t} variant="secondary" className="font-mono text-[10px]">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
