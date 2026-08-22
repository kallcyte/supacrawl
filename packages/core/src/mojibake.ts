import chardet from "chardet"

interface MojibakeResult {
  score: number
  flagged: boolean
  sample: string | null
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

// Charset models only need a prefix of the document; they don't need the whole
// (capped) body. Sampling keeps chardet's heavy multi-model scan off most of
// the bytes, cutting peak heap on large pages with no accuracy loss for the
// charset verdict (which is a global property of a page).
const CHARDET_SAMPLE_BYTES = 16 * 1024

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

/** Count matches without materializing a match array (text.match(/g) does). */
function countRegExpMatches(s: string, re: RegExp): number {
  re.lastIndex = 0
  let n = 0
  while (re.exec(s) !== null) n++
  return n
}

function mojibakePatternDensity(text: string): number {
  let matches = 0
  for (const pat of MOJIBAKE_PATTERNS) matches += countRegExpMatches(text, pat)
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

function hasNonAscii(body: Uint8Array): boolean {
  for (let i = 0; i < body.length; i++) {
    if (body[i]! >= 0x80) return true
  }
  return false
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

const SAMPLE_SPAN = 60

function findMojibakeOffset(text: string): number {
  const rep = text.indexOf("\uFFFD")
  if (rep >= 0) return rep
  for (const pat of MOJIBAKE_PATTERNS) {
    pat.lastIndex = 0
    const m = pat.exec(text)
    if (m) return m.index
  }
  return -1
}

function extractSample(text: string, center: number, span = SAMPLE_SPAN): string | null {
  const vt = text.replace(/\s+/g, " ")
  const c = Math.min(center, vt.length)
  const start = Math.max(0, c - span)
  const end = Math.min(vt.length, c + span)
  let s = vt.slice(start, end)
  if (start > 0) s = "…" + s
  if (end < vt.length) s = s + "…"
  return s
}

function extractMojibakeSample(text: string): string | null {
  const offset = findMojibakeOffset(text)
  if (offset >= 0) return extractSample(text, offset)
  if (text.length === 0) return null
  return extractSample(text, 0)
}

/**
 * Detect UTF-8 mojibake in a (possibly capped) HTML body.
 *
 * `decodedText`, when provided, is the caller's already-decoded string so the
 * heuristic doesn't re-decode the body a second time.
 */
export function detectMojibake(body: Uint8Array, decodedText?: string): MojibakeResult {
  // Pure-ASCII bytes decode byte-for-byte under any single-byte charset, so
  // they can never be mojibake; skip chardet + heuristic + decode entirely.
  // Safe to ignore `decodedText` here: every caller (checker.ts) passes the
  // UTF-8 decode of this same body, which for pure-ASCII input is identical
  // to the body's own bytes — no mojibake can appear only in that string.
  if (!hasNonAscii(body)) return { score: 0, flagged: false, sample: null }

  const sample =
    body.length > CHARDET_SAMPLE_BYTES ? body.subarray(0, CHARDET_SAMPLE_BYTES) : body
  const results = chardet.analyse(sample)
  const top = results[0]
  const decode = (): string => decodedText ?? new TextDecoder("utf-8", { fatal: false }).decode(body)

  if (!top) {
    const text = decode()
    const score = round3(utf8HeuristicScore(text))
    return { score, flagged: score > 0.5, sample: score > 0.5 ? extractMojibakeSample(text) : null }
  }

  const isUtf8 = top.name === "UTF-8" || top.name === "ASCII"

  if (!isUtf8 && top.confidence >= NON_UTF8_CONFIDENCE_THRESHOLD) {
    const score = Math.round((top.confidence / 100) * 1000) / 1000
    if (score <= 0.5) return { score, flagged: false, sample: null }
    return { score, flagged: true, sample: extractMojibakeSample(decode()) }
  }

  const text = decode()
  const score = round3(utf8HeuristicScore(text))
  return { score, flagged: score > 0.5, sample: score > 0.5 ? extractMojibakeSample(text) : null }
}
