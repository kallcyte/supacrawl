interface LlmGarbageResult {
  score: number
  flagged: boolean
}

const PLACEHOLDER_RE = /\[[A-Z_]{2,}\]/
const REFUSAL_RE = /I(?:'m|\s+am)\s+sorry.*I\s+(?:cannot|can't)/i
const JSON_ARTIFACT_RE = /\{"response"\s*:/

export function detectLlmGarbage(body: Uint8Array): LlmGarbageResult {
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: false }).decode(body)
  } catch {
    return { score: 0, flagged: false }
  }

  if (text.length < 80) return { score: 0, flagged: false }

  let score = 0
  let signals = 0

  if (PLACEHOLDER_RE.test(text)) { score += 0.6; signals++ }
  if (REFUSAL_RE.test(text)) { score += 0.5; signals++ }
  if (JSON_ARTIFACT_RE.test(text)) { score += 0.4; signals++ }

  if (signals >= 2) score = 0.8

  return {
    score: Math.round(Math.min(1, score) * 1000) / 1000,
    flagged: score > 0.5
  }
}
