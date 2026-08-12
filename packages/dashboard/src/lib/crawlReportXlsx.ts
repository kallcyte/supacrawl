import ExcelJS from "exceljs"
import JSZip from "jszip"
import type { CrawlRecord, CrawlResult, CrawlSummary, StatusBucket } from "./api"

export interface CrawlReportXlsxData {
  crawl: CrawlRecord
  results: CrawlResult[]
  summary: CrawlSummary | null
  distribution: StatusBucket[]
}

// ---- Theme ---------------------------------------------------------------
const BUCKET_COLORS: Record<string, string> = {
  "1xx": "059669",
  "2xx": "16A34A",
  "3xx": "D97706",
  "4xx": "EA580C",
  "5xx": "DC2626",
  error: "EF4444"
}
const BUCKET_ORDER = ["1xx", "2xx", "3xx", "4xx", "5xx", "error"]

const ISSUE_COLORS = ["DC2626", "EA580C", "D97706", "0014CC", "0891B2"]

// ---- Worksheet helpers ----------------------------------------------------
function addHeaderRow(
  ws: ExcelJS.Worksheet,
  headers: string[],
  rowNumber: number,
  fill = "001C44"
): void {
  const r = ws.getRow(rowNumber)
  headers.forEach((h, i) => {
    const cell = r.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 }
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + fill } }
    cell.alignment = { vertical: "middle", horizontal: "left" }
  })
  r.height = 22
}

function writeIssueSheet(
  wb: ExcelJS.Workbook,
  name: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
  widths: number[],
  title: string
): void {
  const ws = wb.addWorksheet(name, { properties: { defaultRowHeight: 16 } })
  ws.views = [{ state: "frozen", ySplit: 3 }]

  // Title
  const titleCell = ws.getCell("A1")
  titleCell.value = title
  titleCell.font = { bold: true, size: 14, color: { argb: "FF0F172A" } }
  ws.mergeCells(1, 1, 1, headers.length)
  ws.getRow(1).height = 24

  // Subtitle (count)
  ws.getCell("A2").value = `${rows.length} URL${rows.length === 1 ? "" : "s"}`
  ws.getCell("A2").font = { size: 11, color: { argb: "FF64748B" } }

  addHeaderRow(ws, headers, 3)

  rows.forEach((vals) => {
    const r = ws.addRow(vals)
    r.eachCell((cell, col) => {
      cell.border = {
        bottom: { style: "hair", color: { argb: "FFE2E8F0" } }
      }
      if (typeof cell.value === "string" && cell.value.startsWith("http")) {
        cell.font = { color: { argb: "FF001C44" }, size: 11 }
        cell.value = { text: cell.value, hyperlink: cell.value }
        cell.alignment = { wrapText: true, vertical: "top" }
      }
    })
  })
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: headers.length } }

  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w
  })
}

// ---- Native chart XML (injected into the xlsx package) ----------------------

const NS = {
  c: "http://schemas.openxmlformats.org/drawingml/2006/chart",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  xdr: "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
  rel: "http://schemas.openxmlformats.org/package/2006/relationships"
}

function chartTitleXml(text: string): string {
  return `<c:title>
    <c:tx>
      <c:rich>
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p>
          <a:pPr><a:defRPr sz="1400" b="1"><a:solidFill><a:srgbClr val="001C44"/></a:solidFill></a:defRPr></a:pPr>
          <a:r><a:rPr lang="en-US" sz="1400" b="1"><a:solidFill><a:srgbClr val="001C44"/></a:solidFill></a:rPr><a:t>${text}</a:t></a:r>
        </a:p>
      </c:rich>
    </c:tx>
    <c:overlay val="0"/>
  </c:title>
  <c:autoTitleDeleted val="0"/>`
}

function barChartXml(
  dataStart: number,
  dataEnd: number,
  colors: string[]
): string {
  const dPt = colors
    .map(
      (c, i) => `<c:dPt>
        <c:idx val="${i}"/>
        <c:spPr>
          <a:solidFill><a:srgbClr val="${c}"/></a:solidFill>
        </c:spPr>
      </c:dPt>`
    )
    .join("")

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS.c}" xmlns:a="${NS.a}" xmlns:r="${NS.r}">
  <c:lang val="en-US"/>
  <c:chart>
    ${chartTitleXml("URLs by HTTP status")}
    <c:plotArea>
      <c:layout/>
      <c:barChart>
        <c:barDir val="col"/>
        <c:grouping val="clustered"/>
        <c:varyColors val="0"/>
        <c:ser>
          <c:idx val="0"/>
          <c:order val="0"/>
          ${dPt}
          <c:cat>
            <c:strRef>
              <c:f>Dashboard!$A$${dataStart}:$A$${dataEnd}</c:f>
            </c:strRef>
          </c:cat>
          <c:val>
            <c:numRef>
              <c:f>Dashboard!$B$${dataStart}:$B$${dataEnd}</c:f>
            </c:numRef>
          </c:val>
        </c:ser>
        <c:axId val="1601547776"/>
        <c:axId val="1601544320"/>
      </c:barChart>
      <c:catAx>
        <c:axId val="1601547776"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        <c:crossAx val="1601544320"/>
        <c:crosses val="autoZero"/>
        <c:auto val="1"/>
        <c:lblAlgn val="ctr"/>
        <c:lblOffset val="100"/>
        <c:noMultiLvlLbl val="0"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="1601544320"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:majorGridlines/>
        <c:numFmt formatCode="General" sourceLinked="1"/>
        <c:majorTickMark val="out"/>
        <c:minorTickMark val="none"/>
        <c:tickLblPos val="nextTo"/>
        <c:crossAx val="1601547776"/>
        <c:crosses val="autoZero"/>
        <c:crossBetween val="between"/>
      </c:valAx>
    </c:plotArea>
    <c:legend>
      <c:legendPos val="b"/>
      <c:overlay val="0"/>
    </c:legend>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
</c:chartSpace>`
}

function donutChartXml(
  dataStart: number,
  dataEnd: number,
  colors: string[]
): string {
  const dPt = colors
    .map(
      (c, i) => `<c:dPt>
        <c:idx val="${i}"/>
        <c:spPr>
          <a:solidFill><a:srgbClr val="${c}"/></a:solidFill>
        </c:spPr>
      </c:dPt>`
    )
    .join("")

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS.c}" xmlns:a="${NS.a}" xmlns:r="${NS.r}">
  <c:lang val="en-US"/>
  <c:chart>
    ${chartTitleXml("Issues breakdown")}
    <c:plotArea>
      <c:layout/>
      <c:doughnutChart>
        <c:varyColors val="0"/>
        <c:ser>
          <c:idx val="0"/>
          <c:order val="0"/>
          ${dPt}
          <c:cat>
            <c:strRef>
              <c:f>Dashboard!$A$${dataStart}:$A$${dataEnd}</c:f>
            </c:strRef>
          </c:cat>
          <c:val>
            <c:numRef>
              <c:f>Dashboard!$B$${dataStart}:$B$${dataEnd}</c:f>
            </c:numRef>
          </c:val>
        </c:ser>
        <c:holeSize val="55"/>
      </c:doughnutChart>
    </c:plotArea>
    <c:legend>
      <c:legendPos val="r"/>
      <c:overlay val="0"/>
    </c:legend>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
</c:chartSpace>`
}

function chartRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS.rel}">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="../worksheets/sheet1.xml"/>
</Relationships>`
}

function drawingXml(barAnchor: DrawingAnchor | null, donutAnchor: DrawingAnchor | null): string {
  const frame = (id: number, name: string, anchor: DrawingAnchor, rId: string): string =>
    `<xdr:twoCellAnchor>
      <xdr:from>
        <xdr:col>${anchor.fromCol}</xdr:col>
        <xdr:colOff>0</xdr:colOff>
        <xdr:row>${anchor.fromRow}</xdr:row>
        <xdr:rowOff>0</xdr:rowOff>
      </xdr:from>
      <xdr:to>
        <xdr:col>${anchor.toCol}</xdr:col>
        <xdr:colOff>0</xdr:colOff>
        <xdr:row>${anchor.toRow}</xdr:row>
        <xdr:rowOff>0</xdr:rowOff>
      </xdr:to>
      <xdr:graphicFrame macro="">
        <xdr:nvGraphicFramePr>
          <xdr:cNvPr id="${id}" name="${name}"/>
          <xdr:cNvGraphicFramePr/>
        </xdr:nvGraphicFramePr>
        <xdr:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
        </xdr:xfrm>
        <a:graphic>
          <a:graphicData uri="${NS.c}">
            <c:chart xmlns:c="${NS.c}" r:id="${rId}"/>
          </a:graphicData>
        </a:graphic>
      </xdr:graphicFrame>
      <xdr:clientData/>
    </xdr:twoCellAnchor>`

  const bar = barAnchor ? frame(2, "Chart 1", barAnchor, "rId1") : ""
  const donut = donutAnchor ? frame(3, "Chart 2", donutAnchor, "rId2") : ""

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="${NS.xdr}" xmlns:a="${NS.a}" xmlns:r="${NS.r}">
  ${bar}
  ${donut}
</xdr:wsDr>`
}

function drawingRelsXml(hasBar: boolean, hasDonut: boolean): string {
  const parts = []
  if (hasBar) {
    parts.push('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>')
  }
  if (hasDonut) {
    parts.push('<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart2.xml"/>')
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS.rel}">
  ${parts.join("\n  ")}
</Relationships>`
}

function sheetRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS.rel}">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`
}

interface DrawingAnchor {
  fromCol: number
  fromRow: number
  toCol: number
  toRow: number
}

// ---- Buffer post-processing: inject native charts ---------------------------
async function injectNativeCharts(
  buffer: ArrayBuffer,
  spec: {
    distStart: number
    distDataEnd: number
    distColors: string[]
    issueStart: number
    issueDataEnd: number
    issueColors: string[]
    hasBar: boolean
    hasDonut: boolean
  }
): Promise<ArrayBuffer> {
  const zip = new JSZip()
  await zip.loadAsync(buffer)

  // No charts to show — leave the plain ExcelJS workbook untouched.
  if (!spec.hasBar && !spec.hasDonut) return buffer

  // 1. Chart parts
  if (spec.hasBar) {
    zip.file("xl/charts/chart1.xml", barChartXml(spec.distStart, spec.distDataEnd, spec.distColors))
    zip.file("xl/charts/_rels/chart1.xml.rels", chartRelsXml())
  }
  if (spec.hasDonut) {
    zip.file("xl/charts/chart2.xml", donutChartXml(spec.issueStart, spec.issueDataEnd, spec.issueColors))
    zip.file("xl/charts/_rels/chart2.xml.rels", chartRelsXml())
  }

  // 2. Drawing part (anchors both charts)
  const barAnchor: DrawingAnchor | null = spec.hasBar
    ? { fromCol: 0, fromRow: 37, toCol: 5, toRow: 55 }
    : null
  const donutAnchor: DrawingAnchor | null = spec.hasDonut
    ? { fromCol: 0, fromRow: 56, toCol: 5, toRow: 76 }
    : null
  zip.file(
    "xl/drawings/drawing1.xml",
    drawingXml(barAnchor, donutAnchor)
  )
  zip.file("xl/drawings/_rels/drawing1.xml.rels", drawingRelsXml(spec.hasBar, spec.hasDonut))

  // 3. Sheet drawing reference
  const sheet1 = await zip.file("xl/worksheets/sheet1.xml")!.async("string")
  const withDrawing = sheet1.replace(
    "</worksheet>",
    '<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></worksheet>'
  )
  zip.file("xl/worksheets/sheet1.xml", withDrawing)

  // 4. Sheet rels (create if missing)
  const sheet1RelsPath = "xl/worksheets/_rels/sheet1.xml.rels"
  const existingSheetRels = await zip.file(sheet1RelsPath)?.async("string")
  if (existingSheetRels) {
    const withRels = existingSheetRels.replace(
      "</Relationships>",
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>'
    )
    zip.file(sheet1RelsPath, withRels)
  } else {
    zip.file(sheet1RelsPath, sheetRelsXml())
  }

  // 5. Content types
  const contentTypePath = "[Content_Types].xml"
  const contentTypes = await zip.file(contentTypePath)!.async("string")
  const withContentType = (xml: string, override: string): string =>
    xml.replace("</Types>", `${override}</Types>`)
  let newContentTypes = withContentType(
    contentTypes,
    '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
  )
  if (spec.hasBar) {
    newContentTypes = withContentType(
      newContentTypes,
      '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>'
    )
  }
  if (spec.hasDonut) {
    newContentTypes = withContentType(
      newContentTypes,
      '<Override PartName="/xl/charts/chart2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>'
    )
  }
  zip.file(contentTypePath, newContentTypes)

  return await zip.generateAsync({ type: "arraybuffer" })
}

// ---- Main builder ----------------------------------------------------------
export async function buildCrawlReportWorkbook(data: CrawlReportXlsxData): Promise<ArrayBuffer> {
  const { crawl, results, summary, distribution } = data
  const wb = new ExcelJS.Workbook()

  // ---- Dashboard ---------------------------------------------------------
  const dash = wb.addWorksheet("Dashboard", { properties: { defaultRowHeight: 16 } })
  dash.views = [{ showGridLines: false }]
  const colWidths = [22, 16, 16, 16, 16, 16]
  colWidths.forEach((w, i) => (dash.getColumn(i + 1).width = w))

  // Brand header
  dash.mergeCells("A1:F1")
  const brand = dash.getCell("A1")
  brand.value = "supacrawl · Crawl Report"
  brand.font = { bold: true, size: 9, color: { argb: "FF94A3B8" }, italic: true }
  dash.getRow(1).height = 18

  dash.mergeCells("A2:F2")
  const hTitle = dash.getCell("A2")
  hTitle.value = summary?.jobName ? `Crawl Report — ${summary.jobName}` : "Crawl Report"
  hTitle.font = { bold: true, size: 18, color: { argb: "FF0F172A" } }
  dash.getRow(2).height = 28

  dash.mergeCells("A3:F3")
  const sub = dash.getCell("A3")
  sub.value = `ID ${crawl.id} · Started ${toExcelDate(crawl.startedAt)}${
    crawl.finishedAt ? ` · Finished ${toExcelDate(crawl.finishedAt)}` : ""
  }`
  sub.font = { size: 10, color: { argb: "FF64748B" } }
  dash.getRow(3).height = 16

  // Health score banner
  dash.mergeCells("A5:F5")
  const healthColor = healthHex(summary?.healthScore ?? 0)
  const health = dash.getCell("A5")
  health.value = `Health Score`
  health.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } }
  health.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + healthColor } }
  health.alignment = { horizontal: "left", vertical: "middle" }
  const healthVal = dash.getCell("F5")
  healthVal.value = `${summary?.healthScore ?? 0}%`
  healthVal.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } }
  healthVal.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + healthColor } }
  healthVal.alignment = { horizontal: "right", vertical: "middle" }
  dash.getRow(5).height = 26

  // Overview stats
  dash.mergeCells("A7:F7")
  dash.getCell("A7").value = "Overview"
  dash.getCell("A7").font = { bold: true, size: 12, color: { argb: "FF0F172A" } }

  const overviewLabels = [
    "URLs found",
    "URLs checked",
    "3xx redirects",
    "4xx errors",
    "5xx errors",
    "Changed",
    "Mojibake",
    "LLM garbage",
    "Avg response",
    "Fastest",
    "Slowest"
  ]
  const count3xx = results.filter((r) => (r.statusCode ?? 0) >= 300 && (r.statusCode ?? 0) < 400).length
  const count4xx = results.filter((r) => (r.statusCode ?? 0) >= 400 && (r.statusCode ?? 0) < 500).length
  const count5xx = results.filter((r) => (r.statusCode ?? 0) >= 500).length
  const changed = results.filter((r) => r.contentChanged).length
  const mojibake = results.filter((r) => r.mojibakeFlagged).length
  const llmGarbage = results.filter((r) => r.llmGarbageFlagged).length
  const avg = summary?.avgResponseTimeMs
  const fastest = summary?.fastestResponseTimeMs
  const slowest = summary?.slowestResponseTimeMs

  const overviewValues: (string | number)[] = [
    crawl.urlsTotal,
    summary?.checkedUrls ?? crawl.urlsChecked,
    count3xx,
    count4xx,
    count5xx,
    changed,
    mojibake,
    llmGarbage,
    avg != null ? `${avg} ms` : "—",
    fastest != null ? `${fastest} ms` : "—",
    slowest != null ? `${slowest} ms` : "—"
  ]

  overviewLabels.forEach((label, i) => {
    const row = 8 + i
    const lc = dash.getCell(row, 1)
    lc.value = label
    lc.font = { size: 11, color: { argb: "FF334155" } }
    lc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } }
    lc.alignment = { vertical: "middle" }
    const vc = dash.getCell(row, 2)
    vc.value = overviewValues[i]
    vc.font = { bold: true, size: 11, color: { argb: "FF0F172A" } }
  })

  // Status distribution table
  const distStart = 21
  dash.mergeCells(`A${distStart}:F${distStart}`)
  dash.getCell(`A${distStart}`).value = "Status distribution"
  dash.getCell(`A${distStart}`).font = { bold: true, size: 12, color: { argb: "FF0F172A" } }

  const distByKey = new Map(distribution.map((d) => [d.status, d.count]))
  const buckets = BUCKET_ORDER.map((b) => ({
    label: b === "error" ? "Error" : b,
    count: distByKey.get(b) ?? 0
  })).filter((b) => b.count > 0)

  addHeaderRow(dash, ["Status", "Count"], distStart + 1)
  buckets.forEach((b, i) => {
    const row = distStart + 2 + i
    dash.getCell(row, 1).value = b.label
    dash.getCell(row, 2).value = b.count
    if (BUCKET_COLORS[b.label.toLowerCase() === "error" ? "error" : b.label]) {
      dash.getCell(row, 1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF" + BUCKET_COLORS[b.label.toLowerCase() === "error" ? "error" : b.label].replace("#", "") }
      }
      dash.getCell(row, 1).font = { bold: true, color: { argb: "FFFFFFFF" } }
    }
  })

  // Issues table
  const issuesStart = 30
  const issueLabels = [
    { label: "Broken", count: summary?.issues.broken.length ?? 0 },
    { label: "Changed", count: summary?.issues.changed.length ?? 0 },
    { label: "SSL expiring", count: summary?.issues.sslExpiring.length ?? 0 },
    { label: "Mojibake", count: summary?.issues.mojibake.length ?? 0 },
    { label: "LLM garbage", count: summary?.issues.llmGarbage.length ?? 0 }
  ]
  dash.mergeCells(`A${issuesStart}:F${issuesStart}`)
  dash.getCell(`A${issuesStart}`).value = "Issues by category"
  dash.getCell(`A${issuesStart}`).font = { bold: true, size: 12, color: { argb: "FF0F172A" } }

  addHeaderRow(dash, ["Category", "Count"], issuesStart + 1)
  issueLabels.forEach((it, i) => {
    const row = issuesStart + 2 + i
    dash.getCell(row, 1).value = it.label
    dash.getCell(row, 2).value = it.count
    if (it.count > 0) {
      dash.getCell(row, 1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF" + ISSUE_COLORS[i].replace("#", "") }
      }
      dash.getCell(row, 1).font = { bold: true, color: { argb: "FFFFFFFF" } }
    }
  })

  // ---- Issue sheets ------------------------------------------------------
  const finalStr = (v: string | number | null | undefined): string =>
    v == null ? "—" : String(v)

  writeIssueSheet(
    wb,
    "3xx",
    ["URL", "Status", "Redirect chain", "Response time", "Method", "Checked at"],
    results
      .filter((r) => (r.statusCode ?? 0) >= 300 && (r.statusCode ?? 0) < 400)
      .map((r) => [r.url, r.statusCode, formatRedirectChain(r), r.responseTimeMs != null ? `${r.responseTimeMs} ms` : null, r.checkMethod, r.checkedAt]),
    [50, 10, 40, 14, 10, 20],
    "3xx Redirects"
  )

  writeIssueSheet(
    wb,
    "4xx",
    ["URL", "Status", "Error", "Response time", "Method", "Checked at"],
    results
      .filter((r) => (r.statusCode ?? 0) >= 400 && (r.statusCode ?? 0) < 500)
      .map((r) => [r.url, r.statusCode, formatError(r), r.responseTimeMs != null ? `${r.responseTimeMs} ms` : null, r.checkMethod, r.checkedAt]),
    [50, 10, 40, 14, 10, 20],
    "4xx Client Errors"
  )

  writeIssueSheet(
    wb,
    "5xx",
    ["URL", "Status", "Error", "Response time", "Method", "Checked at"],
    results
      .filter((r) => (r.statusCode ?? 0) >= 500)
      .map((r) => [r.url, r.statusCode, formatError(r), r.responseTimeMs != null ? `${r.responseTimeMs} ms` : null, r.checkMethod, r.checkedAt]),
    [50, 10, 40, 14, 10, 20],
    "5xx Server Errors"
  )

  writeIssueSheet(
    wb,
    "Changed",
    ["URL", "Status", "Response time", "Method", "Checked at"],
    results
      .filter((r) => r.contentChanged)
      .map((r) => [r.url, r.statusCode, r.responseTimeMs != null ? `${r.responseTimeMs} ms` : null, r.checkMethod, r.checkedAt]),
    [50, 10, 14, 10, 20],
    "Changed URLs"
  )

  writeIssueSheet(
    wb,
    "Mojibake",
    ["URL", "Mojibake score", "Sample text", "Status", "Response time", "Checked at"],
    results
      .filter((r) => r.mojibakeFlagged)
      .map((r) => [r.url, formatScore(r.mojibakeScore), r.mojibakeSample ?? null, r.statusCode, r.responseTimeMs != null ? `${r.responseTimeMs} ms` : null, r.checkedAt]),
    [50, 16, 60, 10, 14, 20],
    "Mojibake (Garbled Text)"
  )

  writeIssueSheet(
    wb,
    "LLM Garbage",
    ["URL", "LLM garbage score", "Sample text", "Status", "Response time", "Checked at"],
    results
      .filter((r) => r.llmGarbageFlagged)
      .map((r) => [r.url, formatScore(r.llmGarbageScore), r.llmGarbageSample ?? null, r.statusCode, r.responseTimeMs != null ? `${r.responseTimeMs} ms` : null, r.checkedAt]),
    [50, 18, 60, 10, 14, 20],
    "LLM Garbage (AI Artifacts)"
  )

  // ---- Buffer + native chart injection ------------------------------------
  const hasBar = buckets.length > 0
  const issueChart = issueLabels.filter((it) => it.count > 0)
  const hasDonut = issueChart.length > 0

  const raw = await wb.xlsx.writeBuffer()
  const buffer = raw instanceof ArrayBuffer ? raw : await new Blob([raw as Blob]).arrayBuffer()

  return await injectNativeCharts(buffer, {
    distStart: distStart + 2,
    distDataEnd: distStart + 1 + buckets.length,
    distColors: buckets.map(
      (b) => BUCKET_COLORS[b.label.toLowerCase() === "error" ? "error" : b.label] ?? "001C44"
    ),
    issueStart: issuesStart + 2,
    issueDataEnd: issuesStart + 1 + issueLabels.length,
    issueColors: ISSUE_COLORS.slice(0, issueLabels.length),
    hasBar,
    hasDonut
  })
}

function formatRedirectChain(r: CrawlResult): string {
  if (r.error === "Redirect loop") return "Redirect loop"
  let sources: string[] = []
  if (r.redirectChain) {
    try {
      const parsed = JSON.parse(r.redirectChain)
      if (Array.isArray(parsed)) sources = parsed.filter((x): x is string => typeof x === "string")
    } catch {
      sources = [r.redirectChain]
    }
  }
  if (r.finalUrl && r.finalUrl !== r.url && sources[sources.length - 1] !== r.finalUrl) {
    sources = [...sources, r.finalUrl]
  }
  if (!sources.length) return "—"
  return sources.join(" → ")
}

function formatError(r: CrawlResult): string {
  if (r.error) return r.error
  const reason = httpStatusText(r.statusCode)
  return reason ? `${r.statusCode} — ${reason}` : `${r.statusCode}`
}

const STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  407: "Proxy Authentication Required",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Payload Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  417: "Expectation Failed",
  418: "I'm a teapot",
  421: "Misdirected Request",
  422: "Unprocessable Entity",
  423: "Locked",
  424: "Failed Dependency",
  425: "Too Early",
  426: "Upgrade Required",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
  506: "Variant Also Negotiates",
  507: "Insufficient Storage",
  508: "Loop Detected",
  510: "Not Extended",
  511: "Network Authentication Required"
}

function httpStatusText(statusCode: number | null): string | null {
  if (statusCode == null) return null
  return STATUS_TEXT[statusCode] ?? null
}

function formatScore(score: number | null): string | number | null {
  if (score == null) return null
  return `${Math.round(score * 100)}%`
}

function toExcelDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toISOString().replace("T", " ").slice(0, 19)
}

function healthHex(score: number): string {
  if (score >= 90) return "059669"
  if (score >= 70) return "D97706"
  return "DC2626"
}