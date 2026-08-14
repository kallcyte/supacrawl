import type { SeoContentStats, SeoInfo } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ImageIcon, Link2, Hash, Scale } from "lucide-react"

interface Props {
  seo: SeoInfo | null
  content: SeoContentStats | null
  pageWeightBytes: number
  gzippedBytes: number
  responseTimeMs: number | null
  sslValidUntil: string | null
}

function formatBytes(b: number): string {
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(2)} MB`
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${b} B`
}

function Stat({
  icon,
  label,
  value,
  sub
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  sub?: string
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg font-bold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

export default function PageWeight({ seo, content, pageWeightBytes, gzippedBytes, responseTimeMs, sslValidUntil }: Props) {
  const savings = gzippedBytes > 0 ? Math.round((1 - gzippedBytes / Math.max(1, pageWeightBytes)) * 100) : 0
  const sslDays = sslValidUntil ? Math.round((new Date(sslValidUntil).getTime() - Date.now()) / 86400000) : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Scale className="h-4 w-4 text-muted-foreground" />
          Page weight &amp; content
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Stat icon={<Scale className="h-3.5 w-3.5" />} label="HTML size" value={formatBytes(pageWeightBytes)} />
          <Stat icon={<Scale className="h-3.5 w-3.5" />} label="Gzipped size" value={formatBytes(gzippedBytes)} sub={gzippedBytes > 0 ? `${savings}% saved` : undefined} />
          <Stat
            icon={<Hash className="h-3.5 w-3.5" />}
            label="Words"
            value={(content?.wordCount ?? seo?.wordCount ?? 0).toLocaleString()}
          />
          <Stat
            icon={<Hash className="h-3.5 w-3.5" />}
            label="H1 / H2"
            value={`${seo?.h1Count ?? 0} / ${content?.h2Count ?? 0}`}
          />
          <Stat
            icon={<ImageIcon className="h-3.5 w-3.5" />}
            label="Images"
            value={content?.imageCount ?? 0}
            sub={
              (content?.imagesMissingAlt ?? 0) > 0
                ? `${content!.imagesMissingAlt} missing alt`
                : content?.imageCount ? "all have alt" : undefined
            }
          />
          <Stat
            icon={<Link2 className="h-3.5 w-3.5" />}
            label="Links"
            value={content?.linkCount ?? 0}
            sub={content?.internalLinkCount != null ? `${content.internalLinkCount} internal` : undefined}
          />
          <Stat
            icon={<Link2 className="h-3.5 w-3.5" />}
            label="Schema types"
            value={seo?.jsonLdTypes.length ?? 0}
            sub={seo && seo.jsonLdTypes.length > 0 ? seo.jsonLdTypes.slice(0, 3).join(", ") : undefined}
          />
          <Stat
            icon={<Link2 className="h-3.5 w-3.5" />}
            label="Response"
            value={responseTimeMs != null ? `${responseTimeMs}ms` : "-"}
            sub={sslDays != null ? `SSL ${sslDays}d` : undefined}
          />
        </div>
      </CardContent>
    </Card>
  )
}
