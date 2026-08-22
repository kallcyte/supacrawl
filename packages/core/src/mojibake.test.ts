import { describe, expect, it } from "vitest"
import { detectMojibake } from "./mojibake.js"

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

describe("detectMojibake", () => {
  it("returns a clean verdict for pure-ASCII bodies without decoding", () => {
    const body = enc("The quick brown fox jumps over the lazy dog. ".repeat(4))
    expect(detectMojibake(body)).toEqual({ score: 0, flagged: false, sample: null })
  })

  it("returns a clean verdict for an empty body", () => {
    expect(detectMojibake(enc(""))).toEqual({ score: 0, flagged: false, sample: null })
  })

  it("does not flag valid UTF-8 with real accented characters", () => {
    const text =
      "Café naïve résumé über straße déjà vu. The quick brown fox jumps over " +
      "the lazy dog near the river bank every morning at dawn promptly today."
    expect(detectMojibake(enc(text))).toEqual({ score: 0, flagged: false, sample: null })
  })

  it("flags classic UTF-8-as-Latin1 mojibake (Ã©, Ã¼ sequences) and extracts a sample", () => {
    const mojibakeText =
      "caf\u00C3\u00A9 na\u00C3\u00AFve r\u00C3\u00A9sum\u00C3\u00A9 \u00C3\u00BCber stra\u00C3\u009Fe d\u00C3\u00A9j\u00C3\u00A0 vu. ".repeat(
        6
      )
    const result = detectMojibake(enc(mojibakeText))
    expect(result.flagged).toBe(true)
    expect(result.score).toBeGreaterThan(0.5)
    expect(result.sample).toContain("\u00C3\u00A9")
  })

  it("flags replacement characters from invalid UTF-8 bytes above the density threshold", () => {
    const body = Buffer.concat([
      enc("The quick brown fox jumps over the lazy dog near the river. "),
      new Uint8Array(20).fill(0xfe)
    ])
    const result = detectMojibake(body)
    expect(result.flagged).toBe(true)
    expect(result.score).toBeGreaterThan(0.5)
    expect(result.sample).not.toBeNull()
  })

  it("ignores short strings below the visible-length heuristic floor even when they contain mojibake pairs", () => {
    const short = enc("caf\u00C3\u00A9 na\u00C3\u00AFve r\u00C3\u00A9sum\u00C3\u00A9 only.")
    expect(detectMojibake(short)).toEqual({ score: 0, flagged: false, sample: null })
  })

  it("flags heavy multi-script mixing (4+ scripts) but not moderate mixing (3 scripts)", () => {
    const latin = "Hello world this is english text. "
    const cyrillic = "Привет мир это тест на смешивание алфавитов. "
    const cjk = "中文汉字测试样本用于检测混合文字密度判断是否异常标记。"
    const korean = "안녕하세요 이것은 한국어 텍스트 샘플입니다 오늘 날씨가 좋습니다. "
    const thai = "สวัสดีชาวโลกนี่คือการทดสอบภาษาไทย"

    const fourScripts = enc(latin + cyrillic + cjk + korean + thai)
    const flaggedResult = detectMojibake(fourScripts)
    expect(flaggedResult.flagged).toBe(true)

    const threeScripts = enc(latin + cyrillic + cjk)
    const cleanResult = detectMojibake(threeScripts)
    expect(cleanResult.flagged).toBe(false)
  })

  it("documents current behavior: a pure-ASCII body is never mojibake even if decodedText contains it", () => {
    const asciiBody = enc("plain ascii only")
    const result = detectMojibake(asciiBody, "caf\u00C3\u00A9 ".repeat(30))
    expect(result).toEqual({ score: 0, flagged: false, sample: null })
  })
})
