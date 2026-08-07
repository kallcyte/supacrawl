export interface ReportUrl {
  url: string
  detail?: string
}

export function buildCrawlReportHtml(opts: {
  crawlId: string
  healthScore: number
  totalChecked: number
  totalFound: number
  brokenCount: number
  changedCount: number
  sslCount: number
  mojibakeCount: number
  llmGarbageCount: number
  brokenUrls: ReportUrl[]
  changedUrls: ReportUrl[]
  sslUrls: string[]
}): string {
  const healthColor = opts.healthScore >= 90 ? "#059669" : opts.healthScore >= 70 ? "#d97706" : "#dc2626"
  const healthBg = opts.healthScore >= 90 ? "#d1fae5" : opts.healthScore >= 70 ? "#fef3c7" : "#fee2e2"

  function statCard(num: number, label: string, icon: string, color: string, bg: string, border: string) {
    return `<td style="padding:6px;width:25%;">
      <div style="background:${bg};border:1px solid ${border};border-radius:8px;padding:14px 8px;text-align:center;">
        <div style="font-size:18px;margin-bottom:4px;">${icon}</div>
        <div style="font-size:20px;font-weight:700;color:${num > 0 ? color : "#059669"};">${num}</div>
        <div style="font-size:9px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.3px;">${label}</div>
      </div>
    </td>`
  }

  function issueSection(title: string, count: number, color: string, bg: string, urls: ReportUrl[]) {
    if (urls.length === 0) return ""
    return `<div style="margin-top:14px;border:1px solid ${color}33;border-radius:8px;overflow:hidden;">
      <div style="background:${bg};padding:10px 16px;font-size:13px;font-weight:700;color:${color};">
        ${title} (${count})
      </div>
      ${urls.map((r, i) => `<div style="padding:8px 16px;border-top:1px solid #f1f5f9;font-size:12px;${i > 0 ? "" : ""}">
        <div style="color:#1e293b;word-break:break-all;">${r.url}</div>
        ${r.detail ? `<div style="color:#64748b;font-size:11px;font-family:'JetBrains Mono',monospace;margin-top:2px;">${r.detail}</div>` : ""}
      </div>`).join("")}
    </div>`
  }

  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:580px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#6366f1 0%,#4f46e5 100%);color:#fff;border-radius:10px;padding:22px 28px;margin-bottom:16px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
      <div>
        <div style="font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:1px;opacity:0.8;margin-bottom:4px;">supacrawl</div>
        <h1 style="margin:0;font-size:20px;font-weight:700;line-height:1.2;">Crawl Report</h1>
        <p style="margin:4px 0 0;font-size:11px;opacity:0.85;">ID: ${opts.crawlId.slice(0, 8)}</p>
      </div>
      <div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:10px 16px;text-align:center;min-width:64px;">
        <div style="font-size:8px;font-weight:600;text-transform:uppercase;opacity:0.75;margin-bottom:2px;">Health</div>
        <div style="font-size:26px;font-weight:800;line-height:1;">${opts.healthScore}%</div>
      </div>
    </div>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
    <tr>
      ${statCard(opts.brokenCount, "Broken", "&#x1F6A8;", "#dc2626", "#fef2f2", "#fecaca")}
      ${statCard(opts.changedCount, "Changed", "&#x1F504;", "#d97706", "#fffbeb", "#fde68a")}
      ${statCard(opts.sslCount, "SSL Expiring", "&#x1F512;", "#ea580c", "#fff7ed", "#fed7aa")}
      ${statCard(opts.mojibakeCount, "Mojibake", "&#x1F524;", "#9333ea", "#faf5ff", "#e9d5ff")}
      ${statCard(opts.llmGarbageCount, "LLM Garbage", "&#x1F916;", "#0891b2", "#ecfeff", "#a5f3fc")}
    </tr>
  </table>

  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:12px;">
    <div style="font-size:12px;font-weight:700;color:#0f172a;margin-bottom:8px;">&#x1F4CA; Summary</div>
    <div style="font-size:12px;color:#64748b;">
      Checked <strong style="color:#0f172a;">${opts.totalChecked}</strong> of <strong style="color:#0f172a;">${opts.totalFound}</strong> URLs ·
      ${opts.brokenCount > 0 || opts.changedCount > 0 || opts.sslCount > 0 || opts.mojibakeCount > 0 || opts.llmGarbageCount > 0
        ? `${opts.brokenCount + opts.changedCount + opts.sslCount + opts.mojibakeCount + opts.llmGarbageCount} issues found`
        : "All URLs healthy &#x2705;"}
    </div>
  </div>

  ${issueSection("&#x1F6A8; Broken URLs", opts.brokenCount, "#dc2626", "#fef2f2", opts.brokenUrls)}
  ${issueSection("&#x1F504; Changed URLs", opts.changedCount, "#d97706", "#fffbeb", opts.changedUrls)}
  ${issueSection("&#x1F512; SSL Expiring Soon", opts.sslCount, "#ea580c", "#fff7ed", opts.sslUrls.map(u => ({ url: u })))}

  <p style="text-align:center;font-size:10px;color:#94a3b8;margin-top:14px;">supacrawl &middot; Automated crawl report</p>
</div>`
}

export function buildCrawlSummaryText(opts: {
  totalChecked: number
  totalFound: number
  broken: number
  changed: number
  skipped: number
  healthScore: number
  durationMs: number
}): string {
  const duration = formatReportDuration(opts.durationMs)
  return `Checked ${opts.totalChecked} of ${opts.totalFound} URLs in ${duration}. Health: ${opts.healthScore}%. ${opts.broken} broken, ${opts.changed} changed, ${opts.skipped} skipped.`
}

function formatReportDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  return `${m}m${rs}s`
}
