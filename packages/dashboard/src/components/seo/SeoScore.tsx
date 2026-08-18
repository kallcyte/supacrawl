import type { SeoAudit, SeoCategoryScore } from "@/lib/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CheckCircle2, AlertTriangle, XCircle, Lightbulb } from "lucide-react"

interface Props {
  score: number
  categories: SeoCategoryScore[]
  audits: SeoAudit[]
}

function scoreColor(score: number): string {
  if (score >= 80) return "hsl(var(--success))"
  if (score >= 50) return "hsl(var(--warning))"
  return "hsl(var(--destructive))"
}

function ScoreRing({ score }: { score: number }) {
  const color = scoreColor(score)
  const pct = Math.max(0, Math.min(100, score))
  return (
    <div
      className="relative h-36 w-36 shrink-0 rounded-full"
      style={{ background: `conic-gradient(${color} ${pct * 3.6}deg, hsl(var(--muted)) ${pct * 3.6}deg 360deg)` }}
    >
      <div className="absolute inset-[10px] flex flex-col items-center justify-center rounded-full bg-background">
        <span className="text-4xl font-bold" style={{ color }}>
          {score}
        </span>
        <span className="text-xs text-muted-foreground">out of 100</span>
      </div>
    </div>
  )
}

const SEVERITY_LABEL = { pass: "Passed", warn: "Warnings", fail: "Failed" } as const

export default function SeoScore({ score, categories, audits }: Props) {
  const groups: { key: "fail" | "warn" | "pass"; items: SeoAudit[] }[] = []
  for (const key of ["fail", "warn", "pass"] as const) {
    const items = audits.filter((a) => a.severity === key)
    if (items.length > 0) groups.push({ key, items })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Lightbulb className="h-4 w-4 text-muted-foreground" />
            SEO score &amp; recommendations
          </CardTitle>
          <CardDescription>Lighthouse-style assessment of the current page</CardDescription>
        </div>
        <ScoreRing score={score} />
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-2 sm:grid-cols-2">
          {categories.map((c) => (
            <div key={c.id} className="rounded-lg border p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{c.label}</span>
                <span className="font-bold" style={{ color: scoreColor(c.score) }}>
                  {c.score}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded bg-muted">
                <div className="h-full rounded" style={{ width: `${c.score}%`, backgroundColor: scoreColor(c.score) }} />
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                {c.pass} pass · {c.warn} warn · {c.fail} fail · {Math.round(c.weight * 100)}% weight
              </p>
            </div>
          ))}
        </div>

        {groups.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No audits were produced — the page may not have returned parseable HTML.
          </p>
        )}

        <div className="space-y-4">
          {groups.map(({ key, items }) => (
            <div key={key}>
              <div className="mb-2 flex items-center gap-2">
                {key === "fail" && <XCircle className="h-4 w-4 text-destructive" />}
                {key === "warn" && <AlertTriangle className="h-4 w-4 text-warning" />}
                {key === "pass" && <CheckCircle2 className="h-4 w-4 text-success" />}
                <h3 className="text-sm font-semibold">
                  {SEVERITY_LABEL[key]}
                  <span className="ml-1.5 text-muted-foreground">({items.length})</span>
                </h3>
              </div>
              <div className="space-y-2">
                {items.map((a) => (
                  <div key={a.id} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={a.severity === "pass" ? "success" : a.severity === "warn" ? "warning" : "destructive"} className="text-[10px]">
                        {a.severity}
                      </Badge>
                      <span className="text-sm font-medium">{a.title}</span>
                    </div>
                    {a.detail && (
                      <p className="mt-1 break-all text-xs text-muted-foreground">{a.detail}</p>
                    )}
                    {a.recommendation && (
                      <p className="mt-1.5 text-xs leading-relaxed">
                        <span className="font-medium">Fix:</span> {a.recommendation}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
