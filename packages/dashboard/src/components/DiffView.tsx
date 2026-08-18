import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight, GitCompare } from "lucide-react"

interface DiffToken {
  text: string
  type: "same" | "added" | "removed"
}

/**
 * Minimal word-level diff. Splits both texts into words and aligns them with a
 * simple LCS over word sequences, then renders added/removed/same spans.
 * Good enough for spotting what changed on a page; not a full text-diff engine.
 */
function diffWords(a: string, b: string): DiffToken[] {
  const split = (s: string) => s.split(/(\s+)/).filter(Boolean)
  const aw = split(a)
  const bw = split(b)
  const n = aw.length
  const m = bw.length
  // LCS table (capped to avoid pathological memory on huge inputs)
  const cap = 4000
  const an = Math.min(n, cap)
  const bn = Math.min(m, cap)
  const lcs: number[][] = Array.from({ length: an + 1 }, () => new Array(bn + 1).fill(0))
  for (let i = an - 1; i >= 0; i--) {
    for (let j = bn - 1; j >= 0; j--) {
      lcs[i]![j] = aw[i] === bw[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const out: DiffToken[] = []
  let i = 0
  let j = 0
  while (i < an && j < bn) {
    if (aw[i] === bw[j]) {
      out.push({ text: aw[i]!, type: "same" })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ text: aw[i]!, type: "removed" })
      i++
    } else {
      out.push({ text: bw[j]!, type: "added" })
      j++
    }
  }
  while (i < an) {
    out.push({ text: aw[i]!, type: "removed" })
    i++
  }
  while (j < bn) {
    out.push({ text: bw[j]!, type: "added" })
    j++
  }
  return out
}

function DiffLine({ tokens }: { tokens: DiffToken[] }) {
  return (
    <div className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
      {tokens.map((t, idx) => (
        <span
          key={idx}
          className={
            t.type === "added"
              ? "bg-success/20 text-success"
              : t.type === "removed"
                ? "bg-destructive/20 text-destructive line-through"
                : ""
          }
        >
          {t.text}
        </span>
      ))}
    </div>
  )
}

export default function DiffView({ previous, current }: { previous: string | null; current: string | null }) {
  const [expanded, setExpanded] = useState(false)
  const tokens = useMemo(() => diffWords(previous ?? "", current ?? ""), [previous, current])

  if (!current && !previous) return null
  const added = tokens.filter((t) => t.type === "added").length
  const removed = tokens.filter((t) => t.type === "removed").length

  return (
    <div className="mt-2 rounded-md border">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-accent"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <GitCompare className="h-3.5 w-3.5" />
        Content diff
        <span className="ml-auto flex gap-2">
          {removed > 0 && <span className="text-destructive">-{removed} removed</span>}
          {added > 0 && <span className="text-success">+{added} added</span>}
        </span>
      </button>
      {expanded && (
        <div className="space-y-2 border-t p-3">
          {previous && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Before</p>
              <DiffLine tokens={tokens.filter((t) => t.type !== "added")} />
            </div>
          )}
          {current && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">After</p>
              <DiffLine tokens={tokens.filter((t) => t.type !== "removed")} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
