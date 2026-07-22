import { useEffect } from "react"
import type { CrawlRecord } from "./api"

const NOTIF_KEY = "supacrawl_notifications_enabled"
const NOTIFIED_KEY = "supacrawl_notified_crawls"

export function isPushEnabled(): boolean {
  return localStorage.getItem(NOTIF_KEY) !== "false"
}

export function setPushEnabled(enabled: boolean): void {
  localStorage.setItem(NOTIF_KEY, String(enabled))
}

function getNotified(): Set<string> {
  try {
    const raw = localStorage.getItem(NOTIFIED_KEY)
    return new Set<string>(raw ? JSON.parse(raw) : [])
  } catch {
    return new Set()
  }
}

function addNotified(id: string): void {
  const set = getNotified()
  set.add(id)
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...set]))
}

export function useCrawlNotifications(crawls: CrawlRecord[]): void {
  useEffect(() => {
    if (!isPushEnabled()) return
    if (!("Notification" in window)) return
    if (Notification.permission !== "granted") return

    const notified = getNotified()
    const done = crawls.filter(
      (c) => (c.status === "completed" || c.status === "failed") && !notified.has(c.id)
    )
    if (done.length === 0) return

    const latest = done.reduce((a, b) =>
      a.startedAt > b.startedAt ? a : b
    )

    addNotified(latest.id)
    new Notification(
      latest.status === "completed" ? "Crawl complete" : "Crawl failed",
      {
        body: latest.status === "completed"
          ? `Checked ${latest.urlsChecked} of ${latest.urlsTotal} URLs, ${latest.urlsBroken} broken`
          : latest.errorMessage ?? "An error occurred during the crawl",
        icon: "/favicon.ico"
      }
    )
  }, [crawls])
}
