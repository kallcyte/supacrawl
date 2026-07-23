import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import type { DurationPoint } from "@/lib/api"

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

export default function CrawlDurationBar({ data }: { data: DurationPoint[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No data yet.</p>
  }
  const chartData = data.map((d) => ({ ...d, durationSec: Math.round(d.durationMs / 1000) }))
  const maxSec = Math.max(...chartData.map((d) => d.durationSec), 1)
  const useMinutes = maxSec > 120
  const ticks = useMinutes
    ? Array.from({ length: Math.ceil(maxSec / 60) + 1 }, (_, i) => i * 60)
    : undefined
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="startedAt"
          tickFormatter={(v) => v.slice(5, 10)}
          stroke="hsl(var(--muted-foreground))"
          fontSize={12}
        />
        <YAxis
          dataKey="durationSec"
          stroke="hsl(var(--muted-foreground))"
          fontSize={12}
          tickFormatter={(v: number) => `${useMinutes ? Math.round(v / 60) : v}`}
          ticks={ticks}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--background))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 6
          }}
          labelFormatter={(v: string) => v.slice(0, 10)}
          formatter={((_value: number, _name: string, item: { payload?: DurationPoint }) => [formatDuration(item.payload?.durationMs ?? 0), "Duration"]) as unknown as (value: number, name: string) => React.ReactNode}
        />
        <Bar dataKey="durationSec" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
