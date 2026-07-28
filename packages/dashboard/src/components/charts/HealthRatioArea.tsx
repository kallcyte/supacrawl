import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import type { TimelinePoint } from "@/lib/api"
import ChartTooltip from "./ChartTooltip"

export default function HealthRatioArea({ data }: { data: TimelinePoint[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No data yet.</p>
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
        <Tooltip
          content={
            <ChartTooltip
              formatter={(item) => ({
                label: item.name,
                value: String(item.value),
              })}
            />
          }
        />
        <Area
          type="monotone"
          dataKey="healthy"
          stackId="1"
          stroke="hsl(142 71% 45%)"
          fill="hsl(142 71% 45% / 0.3)"
          name="Healthy"
        />
        <Area
          type="monotone"
          dataKey="broken"
          stackId="1"
          stroke="hsl(0 84% 60%)"
          fill="hsl(0 84% 60% / 0.3)"
          name="Broken"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
