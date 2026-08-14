import { useMemo } from "react"
import type { SeoInfo } from "@/lib/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Search, AlertTriangle } from "lucide-react"
import { faviconUrl } from "@/lib/utils"

interface Props {
  seo: SeoInfo | null
  finalUrl: string | null
}

export default function SearchPreview({ seo, finalUrl }: Props) {
  const url = finalUrl ?? ""
  const { hostname, breadcrumb } = useMemo(() => {
    try {
      const u = new URL(url)
      const parts = u.pathname.split("/").filter(Boolean)
      const crumbs = [u.hostname.replace(/^www\./, ""), ...parts.slice(0, 2)]
      return { hostname: crumbs.join(" › "), breadcrumb: url }
    } catch {
      return { hostname: url, breadcrumb: url }
    }
  }, [url])

  const title = seo?.title ?? null
  const description = seo?.description ?? null
  const titleTruncated = title != null && title.length > 60
  const descTruncated = description != null && description.length > 160

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Search className="h-4 w-4 text-muted-foreground" />
            Google search preview
          </CardTitle>
          <CardDescription>How your page appears in an organic result</CardDescription>
        </div>
        {(titleTruncated || descTruncated) && (
          <Badge variant="warning">may be truncated</Badge>
        )}
      </CardHeader>
      <CardContent>
        <div className="rounded-xl border bg-background p-4">
          <div className="flex items-center gap-2">
            <img
              src={faviconUrl(url)}
              alt=""
              className="h-5 w-5 rounded-full"
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
            <span className="truncate text-xs text-emerald-700 dark:text-emerald-400">{hostname}</span>
          </div>
          <div className="mt-1 text-sm text-muted-foreground">{breadcrumb}</div>
          {title ? (
            <div className="mt-1 cursor-pointer text-lg leading-snug text-blue-700 hover:underline dark:text-blue-400">
              <span className="line-clamp-2">{title}</span>
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-1.5 text-lg text-muted-foreground">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              No title tag
            </div>
          )}
          {description ? (
            <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              {description}
            </p>
          ) : (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              No meta description — search engines will pick arbitrary text
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
