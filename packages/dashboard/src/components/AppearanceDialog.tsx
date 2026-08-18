import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { THEMES, FONTS, type Theme, type UiFont } from "@/lib/theme"
import { Check } from "lucide-react"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  theme: Theme
  font: UiFont
  onTheme: (t: Theme) => void
  onFont: (f: UiFont) => void
}

export default function AppearanceDialog({ open, onOpenChange, theme, font, onTheme, onFont }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Appearance</DialogTitle>
          <DialogDescription>Theme and terminal font for the whole app.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Theme</p>
            <div className="grid grid-cols-2 gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onTheme(t.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-sm border p-2 text-left text-xs transition-colors",
                    theme === t.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent"
                  )}
                >
                  <span className="flex shrink-0 gap-0.5">
                    {t.swatch.map((c) => (
                      <span key={c} className="h-3 w-3 rounded-sm border border-black/20" style={{ backgroundColor: c }} />
                    ))}
                  </span>
                  <span className="flex-1 truncate">{t.label}</span>
                  {theme === t.id && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Font</p>
            <div className="grid grid-cols-2 gap-2">
              {FONTS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => onFont(f.id)}
                  className={cn(
                    "flex items-center justify-between rounded-sm border px-3 py-2 text-sm transition-colors",
                    font === f.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent"
                  )}
                  style={{ fontFamily: `"${f.label}", monospace` }}
                >
                  {f.label}
                  {font === f.id && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
