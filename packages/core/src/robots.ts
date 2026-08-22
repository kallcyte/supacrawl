import robotsParser from "robots-parser"
import { URL } from "node:url"

export interface RobotsResult {
  allowed: (url: string) => boolean
  crawlDelay: number | null
  sitemaps: string[]
}

export async function fetchAndParseRobots(
  origin: string,
  fetchImpl: typeof fetch = fetch
): Promise<RobotsResult> {
  const url = new URL("/robots.txt", origin).toString()
  const allowed = (u: string): boolean => true
  const noop: RobotsResult = { allowed, crawlDelay: null, sitemaps: [] }
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: "text/plain, */*" }
    })
    if (!res.ok) return noop
    const text = await res.text()
    const robot = robotsParser(url, text)
    const sitemaps: string[] = []
    for (const entry of robot.getSitemaps()) {
      try {
        const absolute = new URL(entry, url).toString()
        if (!sitemaps.includes(absolute)) sitemaps.push(absolute)
      } catch {
        // drop sitemap entries that cannot be parsed as a URL
      }
    }
    return {
      allowed: (u: string) => robot.isAllowed(u, "*") ?? true,
      crawlDelay: robot.getCrawlDelay("*") ?? null,
      sitemaps
    }
  } catch {
    return noop
  }
}
