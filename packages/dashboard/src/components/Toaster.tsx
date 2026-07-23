import { X } from "lucide-react"
import { useToast } from "@/lib/use-toast"
import { cn } from "@/lib/utils"

const variantStyles: Record<string, string> = {
  default: "border-border bg-background text-foreground",
  success: "border-emerald-500/30 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  destructive: "border-destructive/30 bg-destructive/10 text-destructive"
}

export default function Toaster() {
  const { toasts } = useToast()

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg text-sm animate-in slide-in-from-right-2 fade-in-0 duration-200",
            variantStyles[t.variant ?? "default"]
          )}
        >
          <div className="flex-1 min-w-0">
            {t.title && <p className="font-semibold">{t.title}</p>}
            {t.description && <p className="text-xs opacity-80">{t.description}</p>}
          </div>
          <button
            onClick={() => {
              /* auto-dismiss handles removal */
            }}
            className="shrink-0 rounded-sm opacity-60 hover:opacity-100 transition-opacity"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
