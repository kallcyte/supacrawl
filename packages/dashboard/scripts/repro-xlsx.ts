import ExcelJS from "exceljs"
import JSZip from "jszip"
import { writeFileSync } from "node:fs"
import { buildCrawlReportWorkbook } from "../src/lib/crawlReportXlsx"

const crawl = {
  id: "crawl_12345678",
  jobId: "job_1",
  startedAt: "2026-08-01T10:00:00.000Z",
  finishedAt: "2026-08-01T10:05:00.000Z",
  status: "completed",
  urlsTotal: 100,
  urlsChecked: 95,
  urlsChanged: 3,
  urlsBroken: 5,
  urlsSkipped: 2,
  errorMessage: null
}

const baseResult = {
  id: "r",
  crawlId: crawl.id,
  url: "https://example.com/",
  statusCode: 200,
  responseTimeMs: 120,
  contentHash: "abc",
  contentChanged: false,
  error: null,
  redirectChain: null,
  sslValidUntil: null,
  sitemapLastmod: null,
  checkedAt: "2026-08-01T10:00:00.000Z",
  checkMethod: "GET",
  mojibakeScore: 0,
  mojibakeFlagged: false,
  llmGarbageScore: 0,
  llmGarbageFlagged: false,
  seo: null
}

const results = [
  { ...baseResult, url: "https://example.com/", statusCode: 200 },
  { ...baseResult, url: "https://example.com/a", statusCode: 301, redirectChain: "https://example.com/a -> https://example.com/a-final" },
  { ...baseResult, url: "https://example.com/b", statusCode: 404, error: "Not found" },
  { ...baseResult, url: "https://example.com/c", statusCode: 500, error: "Server error" },
  { ...baseResult, url: "https://example.com/d", statusCode: 200, contentChanged: true, mojibakeFlagged: true, mojibakeScore: 0.9 },
  { ...baseResult, url: "https://example.com/e", statusCode: 301, redirectChain: "https://example.com/e -> https://example.com/e2" },
  { ...baseResult, url: "https://example.com/f", statusCode: 200, llmGarbageFlagged: true, llmGarbageScore: 0.8 }
]

const summary = {
  crawlId: crawl.id,
  jobName: "Example Site",
  status: "completed",
  startedAt: crawl.startedAt,
  finishedAt: crawl.finishedAt,
  durationMs: 300000,
  totalUrls: 100,
  checkedUrls: 95,
  healthScore: 82,
  avgResponseTimeMs: 120,
  slowestResponseTimeMs: 900,
  fastestResponseTimeMs: 40,
  issues: {
    broken: [{ url: "https://example.com/b", detail: "404", severity: "high" }],
    changed: [{ url: "https://example.com/d", detail: "changed", severity: "medium" }],
    sslExpiring: [],
    mojibake: [{ url: "https://example.com/d", detail: "mojibake", severity: "medium" }],
    llmGarbage: [{ url: "https://example.com/f", detail: "llm", severity: "medium" }]
  }
}

const distribution = [
  { status: "2xx", count: 4 },
  { status: "3xx", count: 2 },
  { status: "4xx", count: 1 },
  { status: "5xx", count: 1 }
]

async function main() {
  const buffer = await buildCrawlReportWorkbook({ crawl, results, summary, distribution })
  writeFileSync("repro.xlsx", Buffer.from(buffer))
  console.log("wrote repro.xlsx", buffer.byteLength, "bytes")

  // 1) Round-trip open with exceljs
  try {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as any)
    console.log("exceljs round-trip: OK, sheets:", wb.worksheets.map((s) => s.name))
  } catch (e) {
    console.log("exceljs round-trip: FAILED", (e as Error).message)
  }

  // 2) Strict XML well-formedness check on every part
  const zip = new JSZip()
  await zip.loadAsync(buffer)
  let bad = 0
  zip.forEach((path, file) => {
    if (path.endsWith(".xml") || path.endsWith(".rels")) {
      file.async("string").then((s) => {
        try {
          new (require("node:util").TextDecoder)()
          // parse with a real XML parser - use exceljs's sax? use DOMParser unavailable.
        } catch {}
      })
    }
  })

  // Use a lightweight well-formedness check by counting tag balance is unreliable.
  // Instead re-open each xml through JSZip and print the sheet1 + drawing + content types.
  const sheet1 = await zip.file("xl/worksheets/sheet1.xml")!.async("string")
  const drawing = await zip.file("xl/drawings/drawing1.xml")!.async("string")
  const ct = await zip.file("[Content_Types].xml")!.async("string")
  const sheetRels = await zip.file("xl/worksheets/_rels/sheet1.xml.rels")!.async("string")
  const chart1 = await zip.file("xl/charts/chart1.xml")!.async("string")
  console.log("\n==== sheet1 tail ====")
  console.log(sheet1.slice(-400))
  console.log("\n==== drawing1 ====")
  console.log(drawing)
  console.log("\n==== content types ====")
  console.log(ct)
  console.log("\n==== sheet1.xml.rels ====")
  console.log(sheetRels)
  console.log("\n==== chart1 head ====")
  console.log(chart1.slice(0, 600))
}

main()
