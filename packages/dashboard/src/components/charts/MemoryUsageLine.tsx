import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend
} from "recharts"
import ChartTooltip from "./ChartTooltip"
import { formatLocalTime } from "@/lib/utils"

interface Point {
  time: string
  rss: number
  heapUsed: number
  heapTotal: number
}

export default function MemoryUsageLine({ data }: { data: Point[] }) {
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
          tickFormatter={(v) => `${v}MB`}
        />
        <Tooltip
          labelFormatter={(v) => formatLocalTime(v)}
          content={
            <ChartTooltip
              formatter={(item) => ({
                label: item.name,
                value: `${item.value}MB`
              })}
            />
          }
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="rss"
          name="RSS"
          stroke="hsl(var(--chart-1, 217 91% 60%))"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="heapUsed"
          name="Heap Used"
          stroke="hsl(var(--chart-2, 280 65% 60%))"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="heapTotal"
          name="Heap Total"
          stroke="hsl(var(--chart-3, 30 80% 55%))"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
