export type Theme = "tokyo-night" | "tokyo-day" | "mocha" | "macchiato" | "frappe" | "latte" | "nord"

export type UiFont = "space-mono" | "jetbrains-mono" | "fira-code" | "roboto-mono" | "ibm-plex-mono" | "source-code-pro"

export const THEMES: { id: Theme; label: string; dark: boolean; swatch: string[] }[] = [
  { id: "tokyo-night", label: "Tokyo Night", dark: true, swatch: ["#1a1b26", "#7aa2f7", "#bb9af7"] },
  { id: "tokyo-day", label: "Tokyo Day", dark: false, swatch: ["#e1e2e7", "#2e7de9", "#9854f1"] },
  { id: "mocha", label: "Catppuccin Mocha", dark: true, swatch: ["#1e1e2e", "#89b4fa", "#cba6f7"] },
  { id: "macchiato", label: "Catppuccin Macchiato", dark: true, swatch: ["#24273a", "#8aadf4", "#c6a0f6"] },
  { id: "frappe", label: "Catppuccin Frappé", dark: true, swatch: ["#303446", "#8caaee", "#ca9ee6"] },
  { id: "latte", label: "Catppuccin Latte", dark: false, swatch: ["#eff1f5", "#1e66f5", "#8839ef"] },
  { id: "nord", label: "Nord", dark: true, swatch: ["#2e3440", "#81a1c1", "#b48ead"] }
]

export const FONTS: { id: UiFont; label: string }[] = [
  { id: "space-mono", label: "Space Mono" },
  { id: "jetbrains-mono", label: "JetBrains Mono" },
  { id: "fira-code", label: "Fira Code" },
  { id: "roboto-mono", label: "Roboto Mono" },
  { id: "ibm-plex-mono", label: "IBM Plex Mono" },
  { id: "source-code-pro", label: "Source Code Pro" }
]

const THEME_KEY = "theme"
const FONT_KEY = "ui-font"

const isTheme = (v: string | null): v is Theme => THEMES.some((t) => t.id === v)
const isFont = (v: string | null): v is UiFont => FONTS.some((f) => f.id === v)

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
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    const dark = THEMES.find((t) => t.id === theme)?.dark ?? true
    meta.setAttribute("content", dark ? "#1a1b26" : "#e1e2e7")
  }
}

export function getInitialFont(): UiFont {
  if (typeof window === "undefined") return "space-mono"
  const stored = localStorage.getItem(FONT_KEY)
  return isFont(stored) ? stored : "space-mono"
}

export function applyFont(font: UiFont): void {
  document.documentElement.setAttribute("data-font", font)
  localStorage.setItem(FONT_KEY, font)
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
  }
}
