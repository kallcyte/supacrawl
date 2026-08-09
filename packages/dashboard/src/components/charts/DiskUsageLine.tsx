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

interface Point {
  time: string
  value: number
}

export default function DiskUsageLine({ data }: { data: Point[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No data yet.</p>
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="time"
          tickFormatter={(v) => v.slice(11, 16)}
          stroke="hsl(var(--muted-foreground))"
          fontSize={12}
        />
        <YAxis
          stroke="hsl(var(--muted-foreground))"
          fontSize={12}
          tickFormatter={(v) => `${v}MB`}
        />
        <Tooltip
          content={
            <ChartTooltip
              formatter={(item) => ({
                label: item.name,
                value: `${item.value}MB`
              })}
            />
          }
        />
        <Line
          type="monotone"
          dataKey="value"
          name="Disk Used"
          stroke="hsl(var(--chart-5, 170 75% 45%))"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
