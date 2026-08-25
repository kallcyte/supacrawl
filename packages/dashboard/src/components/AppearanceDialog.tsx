import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import {
  MONO_FONTS,
  SANS_FONTS,
  THEMES,
  type MonoFont,
  type SansFont,
  type Theme
} from "@/lib/theme"
import { Check } from "lucide-react"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  theme: Theme
  sansFont: SansFont
  monoFont: MonoFont
  onTheme: (t: Theme) => void
  onSansFont: (font: SansFont) => void
  onMonoFont: (font: MonoFont) => void
}

function FontGrid<T extends string>({
  fonts,
  selected,
  onSelect,
  fallback
}: {
  fonts: readonly { id: T; label: string }[]
  selected: T
  onSelect: (font: T) => void
  fallback: "sans-serif" | "monospace"
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {fonts.map((font) => (
        <button
          key={font.id}
          type="button"
          aria-pressed={selected === font.id}
          onClick={() => onSelect(font.id)}
          className={cn(
            "flex items-center justify-between rounded-sm border px-3 py-2 text-sm transition-colors",
            selected === font.id
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-accent"
          )}
          style={{ fontFamily: `"${font.label}", ${fallback}` }}
        >
          {font.label}
          {selected === font.id && <Check className="h-3.5 w-3.5 shrink-0" />}
        </button>
      ))}
    </div>
  )
}

export default function AppearanceDialog({
  open,
  onOpenChange,
  theme,
  sansFont,
  monoFont,
  onTheme,
  onSansFont,
  onMonoFont
}: Props) {
  const fontMode = THEMES.find((t) => t.id === theme)?.fontMode ?? "mono"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Appearance</DialogTitle>
          <DialogDescription>Theme-specific font options for the app.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Theme</p>
            <div className="grid grid-cols-2 gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={theme === t.id}
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

          {fontMode === "sans" && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sans-serif font</p>
              <FontGrid fonts={SANS_FONTS} selected={sansFont} onSelect={onSansFont} fallback="sans-serif" />
            </div>
          )}

          {fontMode === "mono" && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Monospace font</p>
              <FontGrid fonts={MONO_FONTS} selected={monoFont} onSelect={onMonoFont} fallback="monospace" />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
