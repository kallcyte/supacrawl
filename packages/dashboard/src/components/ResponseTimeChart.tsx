import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts"
import ChartTooltip from "./charts/ChartTooltip"
import type { Heartbeat } from "@/lib/api"

interface Point {
  time: string
  ms: number
}

interface Props {
  heartbeats: Heartbeat[]
  acceptedResponseTimeMs?: number
  height?: number
}

export default function ResponseTimeChart({
  heartbeats,
  acceptedResponseTimeMs = 5000,
  height = 240
}: Props) {
  const data: Point[] = heartbeats
    .filter((h) => h.responseTimeMs != null)
    .map((h) => ({ time: h.checkedAt, ms: h.responseTimeMs! }))

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No response time data yet.</p>
  }

  const maxData = Math.max(...data.map((d) => d.ms), acceptedResponseTimeMs)
  const yMax = Math.ceil(Math.max(maxData * 1.1, acceptedResponseTimeMs * 1.2))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="time"
          tickFormatter={(v: string) => new Date(v).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
          })}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          minTickGap={40}
        />
        <YAxis
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          domain={[0, yMax]}
          tickFormatter={(v) => `${v}ms`}
        />
        <ReferenceArea
          y1={acceptedResponseTimeMs}
          y2={yMax}
          fill="hsl(var(--destructive))"
          fillOpacity={0.08}
        />
        <ReferenceLine
          y={acceptedResponseTimeMs}
          stroke="hsl(var(--destructive))"
          strokeDasharray="4 4"
          label={{
            value: `${acceptedResponseTimeMs}ms`,
            position: "insideTopRight",
            fill: "hsl(var(--muted-foreground))",
            fontSize: 11
          }}
        />
        <Tooltip
          content={
            <ChartTooltip
              formatter={(item) => ({
                label: new Date(String(item.payload?.time)).toLocaleString(),
                value: `${item.value}ms`
              })}
            />
          }
        />
        <Line
          type="monotone"
          dataKey="ms"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
