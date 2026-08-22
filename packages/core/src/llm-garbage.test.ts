import { describe, expect, it } from "vitest"
import { detectLlmGarbage } from "./llm-garbage.js"

/** Deterministic filler prose; slice(n) gives exactly n characters. */
const filler = (n: number): string =>
  "This is ordinary sentence filler text that pads the length sufficiently. ".repeat(5).slice(0, n)

describe("detectLlmGarbage", () => {
  it("returns a clean verdict for normal long prose", () => {
    expect(detectLlmGarbage(filler(300))).toEqual({ score: 0, flagged: false, sample: null })
  })

  it("ignores input below the minimum length threshold, including empty strings", () => {
    expect(detectLlmGarbage("")).toEqual({ score: 0, flagged: false, sample: null })
    const justUnder = filler(79)
    expect(detectLlmGarbage(justUnder)).toEqual({ score: 0, flagged: false, sample: null })
  })

  it("flags placeholder tokens like [YOUR_NAME] with score 0.6 and a context sample", () => {
    const text = filler(60) + " [YOUR_NAME] " + filler(40)
    const result = detectLlmGarbage(text)
    expect(result.flagged).toBe(true)
    expect(result.score).toBe(0.6)
    expect(result.sample).toContain("[YOUR_NAME]")
  })

  it("scores an LLM refusal phrase at 0.5 but does not flag it alone", () => {
    const text = filler(60) + " I'm sorry but I cannot help with that request today. " + filler(10)
    const result = detectLlmGarbage(text)
    expect(result.score).toBe(0.5)
    expect(result.flagged).toBe(false)
    expect(result.sample).toBeNull()
  })

  it("scores a JSON response artifact at 0.4 but does not flag it alone", () => {
    const text = filler(60) + ' {"response": "hello there friend"} ' + filler(20)
    const result = detectLlmGarbage(text)
    expect(result.score).toBe(0.4)
    expect(result.flagged).toBe(false)
    expect(result.sample).toBeNull()
  })

  it("escalates to score 0.8 when two signals co-occur and flags with a sample", () => {
    const text = filler(30) + " [YOUR_NAME] " + filler(20) + ' {"response": "x"} ' + filler(30)
    const result = detectLlmGarbage(text)
    expect(result.flagged).toBe(true)
    expect(result.score).toBe(0.8)
    expect(result.sample).not.toBeNull()
  })
})
