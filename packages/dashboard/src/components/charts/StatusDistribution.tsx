import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts"
import type { StatusBucket } from "@/lib/api"

const COLORS: Record<string, string> = {
  "2xx": "hsl(142 71% 45%)",
  "3xx": "hsl(48 96% 53%)",
  "4xx": "hsl(0 84% 60%)",
  "5xx": "hsl(0 72% 51%)",
  "1xx": "hsl(220 14% 60%)",
  error: "hsl(0 0% 30%)"
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
            contentStyle={{
              backgroundColor: "hsl(var(--background))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 6
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-3 gap-2 text-xs">
        {data.map((d) => (
          <div key={d.status} className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: COLORS[d.status] ?? "#999" }}
            />
            <span className="font-mono">{d.status}</span>
            <span className="ml-auto text-muted-foreground">{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
