import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip"
import type { Heartbeat, HeartbeatStatus } from "@/lib/api"

interface Tick {
  heartbeat: Heartbeat | null
  index: number
}

function tickColor(status: HeartbeatStatus | null): string {
  if (status === "up") return "bg-emerald-500"
  if (status === "down") return "bg-red-500"
  return "bg-muted-foreground/15"
}

function formatTick(heartbeat: Heartbeat | null): { label: string; detail: string } {
  if (!heartbeat) return { label: "No data", detail: "No data yet" }
  const date = new Date(heartbeat.checkedAt).toLocaleString()
  const status = heartbeat.status === "up" ? "Up" : heartbeat.status === "down" ? "Down" : "Pending"
  const rt = heartbeat.responseTimeMs != null ? ` · ${heartbeat.responseTimeMs}ms` : ""
  return { label: `${status}`, detail: `${date} · ${status}${rt}` }
}

interface HeartbeatBarProps {
  heartbeats: Heartbeat[]
  ticks?: number
  className?: string
}

/**
 * UptimeKuma-style heartbeat bar. Each tick is one check interval.
 * Green = up, red = down, gray = no data. Hover shows timestamp + status.
 */
export default function HeartbeatBar({ heartbeats, ticks = 90, className }: HeartbeatBarProps) {
  const sorted = [...heartbeats].sort(
    (a, b) => Date.parse(a.checkedAt) - Date.parse(b.checkedAt)
  )
  const recent = sorted.slice(-ticks)
  const padded: Tick[] = []
  for (let i = 0; i < ticks - recent.length; i++) {
    padded.push({ heartbeat: null, index: i })
  }
  recent.forEach((hb, i) => padded.push({ heartbeat: hb, index: padded.length + i }))

  return (
    <TooltipProvider delayDuration={50}>
      <div className={cn("flex items-center gap-[2px]", className)}>
        {padded.map((tick) => {
          const { label, detail } = formatTick(tick.heartbeat)
          return (
            <Tooltip key={tick.index}>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "h-8 flex-1 rounded-[2px] transition-opacity hover:opacity-80",
                    tickColor(tick.heartbeat?.status ?? null)
                  )}
                />
              </TooltipTrigger>
              <TooltipContent side="top">
                <div className="space-y-0.5">
                  <p className="font-medium capitalize">{label}</p>
                  <p className="text-muted-foreground">{detail}</p>
                </div>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
