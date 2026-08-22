import { describe, expect, it } from "vitest"
import { sha256 } from "./diff.js"

describe("sha256", () => {
  it("hashes the empty string to the known digest", () => {
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
  })

  it("hashes 'abc' to the known digest", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  })

  it("produces the same digest for a string and its UTF-8 encoded bytes", () => {
    const text = "café résumé über"
    const bytes = new TextEncoder().encode(text)
    expect(sha256(text)).toBe(sha256(bytes))
  })

  it("distinguishes different inputs and yields fixed-length hex output", () => {
    const a = sha256("hello")
    const b = sha256("hellp")
    expect(a).not.toBe(b)
    for (const digest of [a, b, sha256(new Uint8Array([0, 255, 128]))]) {
      expect(digest).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})
