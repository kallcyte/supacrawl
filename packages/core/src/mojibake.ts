import chardet from "chardet"

interface MojibakeResult {
  score: number
  flagged: boolean
}

const REPLACEMENT_CHAR = "\uFFFD"

const MOJIBAKE_PATTERNS = [
  /\xC3[\x80-\xBF]/g,
  /\xC2[\xA0-\xBF]/g,
  /\xE2[\x80-\xBF][\x80-\xBF]/g,
]

const KJ_CYRILLIC_MIX = /[\uAC00-\uD7AF\u1100-\u11FF]/u
const CYRILLIC = /[\u0400-\u04FF]/u
const LATIN = /[a-zA-Z]/u
const CJK = /[\u4E00-\u9FFF]/u
const ARABIC = /[\u0600-\u06FF]/u
const DEVANAGARI = /[\u0900-\u097F]/u
const THAI = /[\u0E00-\u0E7F]/u

function countReplacementChars(text: string): number {
  let count = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === REPLACEMENT_CHAR) count++
  }
  return count
}

function hasScript(text: string, regex: RegExp): boolean {
  return regex.test(text)
}

function visibleLength(text: string): number {
  let len = 0
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i)!
    if (cp <= 0x20 || (cp >= 0x7F && cp <= 0x9F)) continue
    if (cp > 0xFFFF) i++
    len++
  }
  return len
}

function mojibakePatternDensity(text: string): number {
  let matches = 0
  for (const pat of MOJIBAKE_PATTERNS) {
    const m = text.match(pat)
    if (m) matches += m.length
  }
  const vl = visibleLength(text)
  if (vl === 0) return 0
  return matches / vl
}

function scriptMixingScore(text: string): number {
  const scripts = [
    { name: "latin", re: LATIN },
    { name: "cyrillic", re: CYRILLIC },
    { name: "cjk", re: CJK },
    { name: "korean", re: KJ_CYRILLIC_MIX },
    { name: "arabic", re: ARABIC },
    { name: "devanagari", re: DEVANAGARI },
    { name: "thai", re: THAI }
  ]
  const present = scripts.filter((s) => hasScript(text, s.re))
  if (present.length <= 2) return 0
  if (present.length >= 4) return 0.9
  if (present.length === 3) return 0.5
  return 0
}

function replacementDensity(text: string): number {
  const vl = visibleLength(text)
  if (vl === 0) return 0
  return countReplacementChars(text) / vl
}

function utf8HeuristicScore(text: string): number {
  const vl = visibleLength(text)
  if (vl < 50) return 0

  const repDensity = replacementDensity(text)
  const patternDensity = mojibakePatternDensity(text)
  const mixScore = scriptMixingScore(text)

  return Math.min(1, repDensity * 20 + patternDensity * 8 + mixScore * 0.8)
}

const NON_UTF8_CONFIDENCE_THRESHOLD = 70

export function detectMojibake(body: Uint8Array): MojibakeResult {
  const results = chardet.analyse(body)
  const top = results[0]

  if (!top) {
    let text: string
    try {
      text = new TextDecoder("utf-8", { fatal: false }).decode(body)
    } catch {
      return { score: 1, flagged: true }
    }
    const score = Math.round(utf8HeuristicScore(text) * 1000) / 1000
    return { score, flagged: score > 0.5 }
  }

  const isUtf8 = top.name === "UTF-8" || top.name === "ASCII"

  if (!isUtf8 && top.confidence >= NON_UTF8_CONFIDENCE_THRESHOLD) {
    const score = Math.round((top.confidence / 100) * 1000) / 1000
    return { score, flagged: score > 0.5 }
  }

  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: false }).decode(body)
  } catch {
    return { score: 1, flagged: true }
  }

  const score = Math.round(utf8HeuristicScore(text) * 1000) / 1000
  return { score, flagged: score > 0.5 }
}
