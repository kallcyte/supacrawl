import type { SeoInfo } from "@/lib/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Tags } from "lucide-react"

type RowStatus = "ok" | "missing" | "warn"

interface Row {
  name: string
  value: string
  status: RowStatus
}

function row(name: string, value: string | number | boolean | null | undefined, okValue?: string | number | boolean | null): Row {
  const empty = value === null || value === undefined || value === "" || value === false
  return {
    name,
    value: empty && okValue !== undefined ? String(okValue ?? "") : empty ? "—" : String(value),
    status: empty ? "missing" : "ok"
  }
}

function buildRows(seo: SeoInfo): { search: Row[]; social: Row[]; technical: Row[]; structured: Row[] } {
  const robotFlags = [
    seo.noindex ? "noindex" : null,
    seo.nofollow ? "nofollow" : null,
    seo.robotsNoarchive ? "noarchive" : null,
    seo.robotsMaxImagePreview ? `max-image-preview:${seo.robotsMaxImagePreview}` : null
  ].filter(Boolean)

  const search: Row[] = [
    row("title", seo.title),
    row("meta name=\"description\"", seo.description),
    row("link rel=\"canonical\"", seo.canonical),
    row("meta name=\"robots\"", robotFlags.length ? robotFlags.join(", ") : "", "index, follow"),
    row("html lang", seo.lang),
    row("h1 count", seo.h1Count, 1),
    row("link rel=\"icon\"", seo.favicon)
  ]

  const social: Row[] = [
    row("og:title", seo.ogTitle),
    row("og:description", seo.ogDescription),
    row("og:image", seo.ogImage),
    row("og:image:alt", seo.ogImageAlt),
    row("og:url", seo.ogUrl),
    row("og:site_name", seo.ogSiteName),
    row("og:type", seo.ogType),
    row("og:locale", seo.ogLocale),
    row("twitter:card", seo.twitterCard),
    row("twitter:title", seo.twitterTitle),
    row("twitter:description", seo.twitterDescription),
    row("twitter:image", seo.twitterImage),
    row("twitter:image:alt", seo.twitterImageAlt),
    row("twitter:site", seo.twitterSite),
    row("twitter:creator", seo.twitterCreator)
  ]

  const technical: Row[] = [
    row("meta charset", seo.charset),
    row("meta name=\"viewport\"", seo.viewport),
    row("meta name=\"theme-color\"", seo.themeColor),
    row("meta name=\"author\"", seo.author),
    row("meta name=\"generator\"", seo.generator),
    row("meta property=\"article:published_time\"", seo.publishedAt),
    row("link rel=\"manifest\"", seo.manifest),
    row("link rel=\"alternate\" (hreflang)", seo.hreflangs.map((h) => `${h.hreflang} → ${h.href}`).join("\n") || null)
  ]

  const structured: Row[] =
    seo.jsonLdTypes.map((t, i) => row(`JSON-LD @type #${i + 1}`, t)).concat(
      seo.jsonLdTypes.length === 0 ? [row("JSON-LD structured data", null)] : []
    )

  return { search, social, technical, structured }
}

function StatusBadge({ status }: { status: RowStatus }) {
  if (status === "ok") return <Badge variant="success" className="text-[10px]">set</Badge>
  if (status === "warn") return <Badge variant="warning" className="text-[10px]">check</Badge>
  return <Badge variant="destructive" className="text-[10px]">missing</Badge>
}

function TagTable({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Tag</th>
            <th className="py-2 pr-4 font-medium">Value</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-b border-border/50 last:border-0">
              <td className="py-2 pr-4 align-top font-mono text-xs">{r.name}</td>
              <td className="py-2 pr-4 align-top">
                <span className="block whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">{r.value}</span>
              </td>
              <td className="py-2 align-top"><StatusBadge status={r.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function MetaTagsPanel({ seo }: { seo: SeoInfo | null }) {
  if (!seo) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Extracted meta tags</CardTitle>
          <CardDescription>No tags extracted for this response.</CardDescription>
        </CardHeader>
      </Card>
    )
  }
  const { search, social, technical, structured } = buildRows(seo)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Tags className="h-4 w-4 text-muted-foreground" />
          Extracted meta tags
        </CardTitle>
        <CardDescription>Every SEO-relevant tag found in the page</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="search">
          <TabsList>
            <TabsTrigger value="search">Search engine</TabsTrigger>
            <TabsTrigger value="social">Social media</TabsTrigger>
            <TabsTrigger value="technical">Technical</TabsTrigger>
            <TabsTrigger value="structured">Structured data</TabsTrigger>
          </TabsList>
          <TabsContent value="search"><TagTable rows={search} /></TabsContent>
          <TabsContent value="social"><TagTable rows={social} /></TabsContent>
          <TabsContent value="technical"><TagTable rows={technical} /></TabsContent>
          <TabsContent value="structured"><TagTable rows={structured} /></TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}