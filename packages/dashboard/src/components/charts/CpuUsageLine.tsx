import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts"
import ChartTooltip from "./ChartTooltip"
import { formatLocalTime } from "@/lib/utils"

interface Point {
  time: string
  value: number
}

export default function CpuUsageLine({ data }: { data: Point[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No data yet.</p>
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="time"
          tickFormatter={(v) => formatLocalTime(v)}
          stroke="hsl(var(--muted-foreground))"
          fontSize={12}
        />
        <YAxis
          stroke="hsl(var(--muted-foreground))"
          fontSize={12}
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip
          labelFormatter={(v) => formatLocalTime(v)}
          content={
            <ChartTooltip
              formatter={(item) => ({
                label: item.name,
                value: `${item.value}%`
              })}
            />
          }
        />
        <Line
          type="monotone"
          dataKey="value"
          name="CPU %"
          stroke="hsl(var(--chart-4, 0 85% 60%))"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
