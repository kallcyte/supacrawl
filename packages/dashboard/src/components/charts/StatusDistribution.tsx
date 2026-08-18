import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts"
import type { StatusBucket } from "@/lib/api"
import ChartTooltip from "./ChartTooltip"

const COLORS: Record<string, string> = {
  "2xx": "hsl(var(--success))",
  "3xx": "hsl(var(--warning))",
  "4xx": "hsl(var(--chart-5))",
  "5xx": "hsl(var(--destructive))",
  "1xx": "hsl(var(--info))",
  error: "hsl(var(--destructive))"
}

export default function StatusDistribution({ data }: { data: StatusBucket[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No data yet.</p>
  }
  return (
    <div className="space-y-2">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="status"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
          >
            {data.map((d) => (
              <Cell key={d.status} fill={COLORS[d.status] ?? "hsl(220 14% 60%)"} />
            ))}
          </Pie>
          <Tooltip
            content={({ payload }) => {
              if (!payload?.length) return null
              const item = payload[0]
              return (
                <div className="rounded-md border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="font-mono font-medium">{item.name}</span>
                    <span className="ml-auto text-muted-foreground">{item.value}</span>
                  </div>
                </div>
              )
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-3 gap-2 text-xs">
        {data.map((d) => (
          <div key={d.status} className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: COLORS[d.status] ?? "hsl(var(--muted-foreground))" }}
            />
            <span className="font-mono">{d.status}</span>
            <span className="ml-auto text-muted-foreground">{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
