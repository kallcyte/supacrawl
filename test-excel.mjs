// Test excel generation in node
import { buildCrawlReportWorkbook } from "./packages/dashboard/src/lib/crawlReportXlsx.ts"

const data = {
  crawl: {
    id: "test-crawl-123",
    startedAt: "2026-08-11T10:00:00.000Z",
    finishedAt: "2026-08-11T10:01:00.000Z",
    status: "completed",
    urlsTotal: 100,
    urlsChecked: 100,
    urlsChanged: 5,
    urlsBroken: 10,
    urlsSkipped: 0,
    errorMessage: null,
    jobId: null
  },
  results: [
    { id: "r1", crawlId: "test-crawl-123", url: "https://example.com/", statusCode: 200, responseTimeMs: 100, contentHash: "abc", contentChanged: false, error: null, checkedAt: "2026-08-11T10:00:01.000Z", checkMethod: "http" },
    { id: "r2", crawlId: "test-crawl-123", url: "https://example.com/404", statusCode: 404, responseTimeMs: 50, contentHash: "def", contentChanged: false, error: null, checkedAt: "2026-08-11T10:00:01.000Z", checkMethod: "http" },
    { id: "r3", crawlId: "test-crawl-123", url: "https://example.com/500", statusCode: 500, responseTimeMs: 200, contentHash: "ghi", contentChanged: false, error: null, checkedAt: "2026-08-11T10:00:01.000Z", checkMethod: "http" }
  ],
  summary: {
      crawlId: "test-crawl-123",
      status: "completed",
      startedAt: "2026-08-11T10:00:00.000Z",
      finishedAt: "2026-08-11T10:01:00.000Z",
      durationMs: 60000,
      totalUrls: 100,
      checkedUrls: 100,
      healthScore: 90,
      avgResponseTimeMs: 120,
      issues: { broken: [], changed: [], sslExpiring: [], mojibake: [], llmGarbage: [] }
    },
  distribution: [
    { status: "2xx", count: 90 },
    { status: "4xx", count: 5 },
    { status: "5xx", count: 5 }
  ]
}

const buffer = await buildCrawlReportWorkbook(data)
console.log("Buffer size:", buffer.byteLength)
console.log("First bytes:", new Uint8Array(buffer).slice(0, 4))
// XLSX files start with PK (ZIP signature)
const fs = await import("node:fs")
import path from "node:path"
const out = path.join(process.env.TEMP || process.env.TMP || ".", "test.xlsx")
fs.writeFileSync(out, Buffer.from(buffer))
console.log("Written to", out)