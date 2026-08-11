import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "-"
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return `${m}m${rs}s`
  const h = Math.floor(m / 60)
  return `${h}h${m % 60}m`
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-"
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function formatLocalTime(iso: string | null | undefined): string {
  if (!iso) return "-"
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    })
  } catch {
    return iso
  }
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s
}

/**
 * Build a favicon URL for a site URL using Google's favicon service.
 * Falls back to the domain's /favicon.ico if the URL is invalid.
 */
export function faviconUrl(url: string): string {
  try {
    const domain = new URL(url).hostname
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`
  } catch {
    return ""
  }
}
