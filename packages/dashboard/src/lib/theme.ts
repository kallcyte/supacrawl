export type Theme = "tokyo-night" | "tokyo-day" | "mocha" | "macchiato" | "frappe" | "latte" | "nord" | "scandinavian" | "scandinavian-dusk"
export type FontMode = "sans" | "mono"

export type SansFont = "manrope" | "dm-sans" | "source-sans-3" | "work-sans" | "plus-jakarta-sans"
export type MonoFont = "space-mono" | "jetbrains-mono" | "fira-code" | "roboto-mono" | "ibm-plex-mono" | "source-code-pro"

type ThemeDefinition = {
  id: Theme
  label: string
  dark: boolean
  fontMode: FontMode
  swatch: string[]
}

export const THEMES: ThemeDefinition[] = [
  { id: "tokyo-night", label: "Tokyo Night", dark: true, fontMode: "mono", swatch: ["#1a1b26", "#7aa2f7", "#bb9af7"] },
  { id: "tokyo-day", label: "Tokyo Day", dark: false, fontMode: "mono", swatch: ["#e1e2e7", "#2e7de9", "#9854f1"] },
  { id: "mocha", label: "Catppuccin Mocha", dark: true, fontMode: "mono", swatch: ["#1e1e2e", "#89b4fa", "#cba6f7"] },
  { id: "macchiato", label: "Catppuccin Macchiato", dark: true, fontMode: "mono", swatch: ["#24273a", "#8aadf4", "#c6a0f6"] },
  { id: "frappe", label: "Catppuccin Frappé", dark: true, fontMode: "mono", swatch: ["#303446", "#8caaee", "#ca9ee6"] },
  { id: "latte", label: "Catppuccin Latte", dark: false, fontMode: "mono", swatch: ["#eff1f5", "#1e66f5", "#8839ef"] },
  { id: "nord", label: "Nord", dark: true, fontMode: "mono", swatch: ["#2e3440", "#81a1c1", "#b48ead"] },
  { id: "scandinavian", label: "Scandinavian", dark: false, fontMode: "sans", swatch: ["#f4f1e9", "#456d68", "#d97761"] },
  { id: "scandinavian-dusk", label: "Scandinavian Dusk", dark: true, fontMode: "sans", swatch: ["#202826", "#7dbca9", "#d99272"] }
]

export const SANS_FONTS: { id: SansFont; label: string }[] = [
  { id: "manrope", label: "Manrope" },
  { id: "dm-sans", label: "DM Sans" },
  { id: "source-sans-3", label: "Source Sans 3" },
  { id: "work-sans", label: "Work Sans" },
  { id: "plus-jakarta-sans", label: "Plus Jakarta Sans" }
]

export const MONO_FONTS: { id: MonoFont; label: string }[] = [
  { id: "space-mono", label: "Space Mono" },
  { id: "jetbrains-mono", label: "JetBrains Mono" },
  { id: "fira-code", label: "Fira Code" },
  { id: "roboto-mono", label: "Roboto Mono" },
  { id: "ibm-plex-mono", label: "IBM Plex Mono" },
  { id: "source-code-pro", label: "Source Code Pro" }
]

const THEME_KEY = "theme"
const SANS_FONT_KEY = "ui-sans-font"
const MONO_FONT_KEY = "ui-mono-font"
const LEGACY_FONT_KEY = "ui-font"

const isTheme = (v: string | null): v is Theme => THEMES.some((t) => t.id === v)
const isSansFont = (v: string | null): v is SansFont => SANS_FONTS.some((f) => f.id === v)
const isMonoFont = (v: string | null): v is MonoFont => MONO_FONTS.some((f) => f.id === v)

/** The theme set directly on <html>. Auto preference resolves to Tokyo flavors. */
export function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "tokyo-night"
  const stored = localStorage.getItem(THEME_KEY)
  if (isTheme(stored)) return stored
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "tokyo-night" : "tokyo-day"
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme)
  localStorage.setItem(THEME_KEY, theme)
  // Keep the browser chrome (address bar etc.) in sync with the theme.
  const themeColor = THEMES.find((t) => t.id === theme)?.swatch[0] ?? "#1a1b26"
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute("content", themeColor)
  })
}

export function getInitialSansFont(): SansFont {
  if (typeof window === "undefined") return "manrope"
  const stored = localStorage.getItem(SANS_FONT_KEY)
  if (isSansFont(stored)) return stored
  const legacy = localStorage.getItem(LEGACY_FONT_KEY)
  return isSansFont(legacy) ? legacy : "manrope"
}

export function getInitialMonoFont(): MonoFont {
  if (typeof window === "undefined") return "space-mono"
  const stored = localStorage.getItem(MONO_FONT_KEY)
  if (isMonoFont(stored)) return stored
  const legacy = localStorage.getItem(LEGACY_FONT_KEY)
  return isMonoFont(legacy) ? legacy : "space-mono"
}

export function applySansFont(font: SansFont): void {
  document.documentElement.setAttribute("data-sans-font", font)
  localStorage.setItem(SANS_FONT_KEY, font)
}

export function applyMonoFont(font: MonoFont): void {
  document.documentElement.setAttribute("data-mono-font", font)
  localStorage.setItem(MONO_FONT_KEY, font)
}

/**
 * The opposite-mode theme for the quick toggle: a dark theme's counterpart is
 * the light theme of the same family (or the other Tokyo flavor), so the
 * toggle never jumps to an unrelated palette.
 */
export function themeCounterpart(theme: Theme): Theme {
  switch (theme) {
    case "tokyo-night":
      return "tokyo-day"
    case "tokyo-day":
      return "tokyo-night"
    case "mocha":
    case "macchiato":
    case "frappe":
      return "latte"
    case "latte":
      return "mocha"
    case "nord":
      return "tokyo-day"
    case "scandinavian":
      return "scandinavian-dusk"
    case "scandinavian-dusk":
      return "scandinavian"
  }
}
