interface LlmGarbageResult {
  score: number
  flagged: boolean
  sample: string | null
}

const PLACEHOLDER_RE = /\[[A-Z_]{2,}\]/
const REFUSAL_RE = /I(?:'m|\s+am)\s+sorry.*I\s+(?:cannot|can't)/i
const JSON_ARTIFACT_RE = /\{"response"\s*:/

const DETECTORS: RegExp[] = [PLACEHOLDER_RE, REFUSAL_RE, JSON_ARTIFACT_RE]

function extractLlmSample(text: string): string | null {
  for (const re of DETECTORS) {
    re.lastIndex = 0
    const m = re.exec(text)
    if (m) {
      const vt = text.replace(/\s+/g, " ")
      const start = Math.max(0, m.index - 40)
      const end = Math.min(vt.length, m.index + m[0].length + 40)
      let s = vt.slice(start, end)
      if (start > 0) s = "…" + s
      if (end < vt.length) s = s + "…"
      return s
    }
  }
  return null
}

/**
 * Detect LLM-generated artifacts in a decoded page.
 *
 * Takes the already-decoded string (the caller decodes the body once) so we
 * don't re-decode per detector. Detection is stateless and cheap, so it can
 * run on every GET.
 */
export function detectLlmGarbage(text: string): LlmGarbageResult {
  if (text.length < 80) return { score: 0, flagged: false, sample: null }

  let score = 0
  let signals = 0

  if (PLACEHOLDER_RE.test(text)) { score += 0.6; signals++ }
  if (REFUSAL_RE.test(text)) { score += 0.5; signals++ }
  if (JSON_ARTIFACT_RE.test(text)) { score += 0.4; signals++ }

  if (signals >= 2) score = 0.8

  return {
    score: Math.round(Math.min(1, score) * 1000) / 1000,
    flagged: score > 0.5,
    sample: score > 0.5 ? extractLlmSample(text) : null
  }
}
