import { randomUUID } from "node:crypto"
import type { Config, CrawlProgress, Storage, Notifier } from "@supacrawl/core"
import { runCrawlWithPersistence } from "@supacrawl/core"

export class CrawlManager {
  private activeCrawls = new Map<string, AbortController>()
  constructor(
    private config: Config,
    private storage: Storage,
    private notifier: Notifier,
    private onProgress: (p: CrawlProgress) => void
  ) {}

  listActive(): string[] {
    return [...this.activeCrawls.keys()]
  }

  isActive(crawlId: string): boolean {
    return this.activeCrawls.has(crawlId)
  }

  async startCrawl(): Promise<string> {
    const id = randomUUID()
    const controller = new AbortController()
    this.activeCrawls.set(id, controller)
    runCrawlWithPersistence({
      crawlId: id,
      config: this.config,
      storage: this.storage,
      notifier: this.notifier,
      abortSignal: controller.signal,
      onProgress: (p) => this.onProgress(p)
    })
      .catch((err) => {
        this.onProgress({
          crawlId: id,
          total: 0,
          checked: 0,
          changed: 0,
          broken: 0,
          skipped: 0,
          status: "failed",
          startedAt: new Date().toISOString()
        })
        console.error(`[crawl ${id}] failed:`, err)
      })
      .finally(() => {
        this.activeCrawls.delete(id)
      })
    return id
  }

  async cancelCrawl(crawlId: string): Promise<boolean> {
    const c = this.activeCrawls.get(crawlId)
    if (!c) return false
    c.abort()
    this.activeCrawls.delete(crawlId)
    return true
  }
}
