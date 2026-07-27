import { randomUUID } from "node:crypto"
import type { Config, CrawlJob, CrawlProgress, CrawlConfig, Storage, Notifier } from "@supacrawl/core"
import { runCrawlWithPersistence } from "@supacrawl/core"

export interface StartCrawlOptions {
  job?: CrawlJob
}

export class CrawlManager {
  private activeCrawls = new Map<string, AbortController>()
  private jobCrawlMap = new Map<string, string>()

  constructor(
    private config: Config,
    private storage: Storage,
    private notifier: Notifier,
    private onProgress: (p: CrawlProgress) => void
  ) {}

  setNotifier(notifier: Notifier): void {
    this.notifier = notifier
  }

  listActive(): string[] {
    return [...this.activeCrawls.keys()]
  }

  isActive(crawlId: string): boolean {
    return this.activeCrawls.has(crawlId)
  }

  isJobRunning(jobId: string): boolean {
    return this.jobCrawlMap.has(jobId)
  }

  async startCrawl(opts?: StartCrawlOptions): Promise<string> {
    if (opts?.job && this.jobCrawlMap.has(opts.job.id)) {
      throw new Error("A crawl is already running for this job")
    }

    const id = randomUUID()
    const controller = new AbortController()
    this.activeCrawls.set(id, controller)
    if (opts?.job) {
      this.jobCrawlMap.set(opts.job.id, id)
    }
    const crawlConfig: CrawlConfig = opts?.job
      ? {
          delayMs: opts.job.delayMs,
          maxConcurrency: opts.job.maxConcurrency,
          timeoutMs: opts.job.timeoutMs,
          userAgent: opts.job.userAgent,
          respectRobotsTxt: opts.job.respectRobotsTxt,
          maxUrls: opts.job.maxUrls,
          retryOnTransientError: this.config.crawl.retryOnTransientError,
          maxRetries: this.config.crawl.maxRetries,
          detectMojibake: opts.job.detectMojibake
        }
      : this.config.crawl
    runCrawlWithPersistence({
      crawlId: id,
      config: { ...this.config, crawl: crawlConfig },
      sitemaps: opts?.job ? (opts.job.sitemapUrls ?? [opts.job.sitemapUrl]) : undefined,
      jobId: opts?.job?.id,
      storage: this.storage,
      notifier: this.notifier,
      abortSignal: controller.signal,
      onProgress: (p) => this.onProgress(p)
    })
      .then(({ record }) => {
        if (opts?.job) {
          this.storage.updateCrawlJob(opts.job.id, {
            lastRunAt: new Date().toISOString(),
            lastRunStatus: record.status
          })
        }
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
        if (opts?.job) {
          this.jobCrawlMap.delete(opts.job.id)
        }
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

  async cancelJobCrawl(jobId: string): Promise<boolean> {
    const crawlId = this.jobCrawlMap.get(jobId)
    if (!crawlId) return false
    this.jobCrawlMap.delete(jobId)
    return this.cancelCrawl(crawlId)
  }
}
