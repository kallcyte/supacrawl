import { cn } from "@/lib/utils"

interface TooltipPayloadItem {
  name?: string
  value?: string | number
  color?: string
  payload?: Record<string, unknown>
}

export interface ChartTooltipProps {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string
  className?: string
  formatter?: (item: TooltipPayloadItem) => { label?: string; value?: string }
}

export default function ChartTooltip({
  active,
  payload,
  label,
  className,
  formatter,
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md",
        className
      )}
    >
      {label && (
        <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      )}
      {payload.map((item, i) => {
        const formatted = formatter?.(item)
        return (
          <div key={i} className="flex items-center gap-2">
            {item.color && (
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: item.color }}
              />
            )}
            <span className="font-mono font-medium">
              {formatted?.label ?? item.name}
            </span>
            <span className="ml-auto text-muted-foreground">
              {formatted?.value ?? item.value}
            </span>
          </div>
        )
      })}
    </div>
  )
}
