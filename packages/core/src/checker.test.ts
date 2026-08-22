import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
import { buildLastmodMap, checkUrl, extractPageText } from "./checker.js"
import type { CheckerContext } from "./checker.js"
import { CrawlConfigSchema } from "./types.js"
import type { CrawlConfig, SitemapEntry } from "./types.js"
import { checkSsl } from "./ssl.js"

// checkSsl opens real TLS connections; stub it entirely. Only checker.ts
// imports this module within this test graph.
vi.mock("./ssl.js", () => ({
  checkSsl: vi.fn(async () => null)
}))
const mockedCheckSsl = vi.mocked(checkSsl)

const VALID_UNTIL = "2030-01-01T00:00:00Z"

const encoder = new TextEncoder()

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

// sha256 of zero bytes, for the empty-body test
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"


function makeCtx(
  opts: {
    config?: Partial<CrawlConfig>
    knownHashes?: Map<string, string>
    lastmodByUrl?: Map<string, string | undefined>
  } = {}
): CheckerContext {
  return {
    config: {
      ...CrawlConfigSchema.parse({}),
      // Transient-error retries sleep between attempts; off by default here so
      // failure-path tests stay instant. Individual tests opt back in.
      retryOnTransientError: false,
      ...(opts.config ?? {})
    },
    knownHashes: opts.knownHashes ?? new Map(),
    lastmodByUrl: opts.lastmodByUrl ?? new Map()
  }
}

/** Crawler state that makes effectiveMethod pick HEAD for `url`. */
function headCtx(url: string): CheckerContext {
  return makeCtx({
    knownHashes: new Map([
      [url, "storedhash"],
      [`${url}#seo`, "seohash"],
      [`${url}#checked`, "2026-02-01T00:00:00Z"]
    ]),
    lastmodByUrl: new Map([[url, "2026-01-01T00:00:00Z"]])
  })
}

function htmlResponse(html: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...headers }
  })
}

function redirectResponse(location: string, status = 301): Response {
  return new Response(null, { status, headers: { location } })
}

function statusResponse(status: number): Response {
  return new Response(null, { status })
}

interface FetchCall {
  url: string
  init: RequestInit
}

/** Fake fetch driven by a per-URL responder; records every call. */
function scriptedFetch(
  respond: (url: string) => Response
): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const fake = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, init: init ?? {} })
    return respond(url)
  }) as unknown as typeof fetch
  return { fetch: fake, calls }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  mockedCheckSsl.mockReset()
  mockedCheckSsl.mockResolvedValue({ validUntil: VALID_UNTIL } as never)
})

describe("checkUrl", () => {
  it("returns populated CheckResult fields for a plain 200 HTML GET", async () => {
    const html = "<!DOCTYPE html><html><head><title>Ok</title></head><body><p>Fine page.</p></body></html>"
    const { fetch, calls } = scriptedFetch(() => htmlResponse(html))
    const ctx = makeCtx()

    const r = await checkUrl("https://example.com/page", ctx, fetch)

    expect(r.url).toBe("https://example.com/page")
    expect(r.statusCode).toBe(200)
    expect(r.error).toBeNull()
    expect(r.finalUrl).toBe("https://example.com/page")
    expect(r.redirectChain).toEqual([])
    expect(r.checkMethod).toBe("GET")
    expect(typeof r.responseTimeMs).toBe("number")
    expect(r.responseTimeMs).toBeGreaterThanOrEqual(0)
    expect(r.contentHash).toBe(sha256Hex(encoder.encode(html)))
    expect(r.contentChanged).toBe(false)
    expect(r.seo).not.toBeNull()
    expect(r.textExtract).toContain("Fine page.")
    // request shape: manual redirects, configured UA
    expect(calls).toHaveLength(1)
    expect(calls[0]!.init.redirect).toBe("manual")
    expect((calls[0]!.init.headers as Record<string, string>)["User-Agent"]).toBe(ctx.config.userAgent)
  })

  it("flags contentChanged when the hash differs from knownHashes", async () => {
    const html = "<p>New content</p>"
    const { fetch } = scriptedFetch(() => htmlResponse(html))
    const ctx = makeCtx({ knownHashes: new Map([["https://example.com/x", "deadbeef"]]) })

    const r = await checkUrl("https://example.com/x", ctx, fetch)

    expect(r.contentChanged).toBe(true)
    expect(r.contentHash).toBe(sha256Hex(encoder.encode(html)))
  })

  it("reports contentChanged=false when the hash matches knownHashes", async () => {
    const html = "<p>Same old content</p>"
    const hash = sha256Hex(encoder.encode(html))
    const { fetch } = scriptedFetch(() => htmlResponse(html))
    const ctx = makeCtx({ knownHashes: new Map([["https://example.com/same", hash]]) })

    const r = await checkUrl("https://example.com/same", ctx, fetch)

    expect(r.contentChanged).toBe(false)
  })

  it("follows a single redirect and resolves a relative Location header", async () => {
    const { fetch, calls } = scriptedFetch((url) =>
      url === "https://example.com/start"
        ? redirectResponse("/landing", 301)
        : htmlResponse("<p>Landed</p>")
    )

    const r = await checkUrl("https://example.com/start", makeCtx(), fetch)

    expect(r.statusCode).toBe(200)
    expect(r.redirectChain).toEqual(["https://example.com/start"])
    expect(r.finalUrl).toBe("https://example.com/landing")
    expect(r.error).toBeNull()
    expect(calls.map((c) => c.url)).toEqual([
      "https://example.com/start",
      "https://example.com/landing"
    ])
  })

  it("follows multi-hop redirect chains in order", async () => {
    const { fetch, calls } = scriptedFetch((url) => {
      if (url === "https://example.com/a") return redirectResponse("https://example.com/b", 302)
      if (url === "https://example.com/b") return redirectResponse("https://example.com/c", 302)
      if (url === "https://example.com/c") return redirectResponse("https://example.com/d", 301)
      return htmlResponse(`<p>Destination of ${url}</p>`)
    })

    const r = await checkUrl("https://example.com/a", makeCtx(), fetch)

    expect(r.statusCode).toBe(200)
    expect(r.redirectChain).toEqual([
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/c"
    ])
    expect(r.finalUrl).toBe("https://example.com/d")
    expect(calls).toHaveLength(4)
  })

  it("detects a redirect loop and reports an error instead of hanging", async () => {
    const { fetch, calls } = scriptedFetch((url) =>
      url === "https://example.com/loop"
        ? redirectResponse("https://example.com/other", 302)
        : redirectResponse("https://example.com/loop", 302)
    )

    const r = await checkUrl("https://example.com/loop", makeCtx(), fetch)

    expect(r.error).toBe("Redirect loop")
    expect(r.statusCode).toBe(302)
    expect(r.finalUrl).toBe("https://example.com/loop")
    expect(calls).toHaveLength(2)
  })

  it("stops following redirects at the built-in maximum of 5 hops", async () => {
    const hops = ["a", "b", "c", "d", "e", "f"]
    const { fetch, calls } = scriptedFetch((url) => {
      const i = hops.indexOf(url.slice(-1))
      if (i >= 0 && i < hops.length - 1) {
        return redirectResponse(`https://example.com/${hops[i + 1]}`, 301)
      }
      return htmlResponse("<p>unreachable</p>")
    })

    const r = await checkUrl("https://example.com/a", makeCtx(), fetch)

    // 5 fetch-driven hops consumed; the last 301 (for /e -> /f) becomes the
    // final response and /f is recorded as finalUrl without being fetched.
    expect(r.statusCode).toBe(301)
    expect(r.redirectChain).toEqual([
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/c",
      "https://example.com/d",
      "https://example.com/e"
    ])
    expect(r.finalUrl).toBe("https://example.com/f")
    expect(calls).toHaveLength(5)
  })

  it("records a 404 without hashing a body", async () => {
    const { fetch } = scriptedFetch(() => statusResponse(404))

    const r = await checkUrl("https://example.com/missing", makeCtx(), fetch)

    expect(r.statusCode).toBe(404)
    expect(r.error).toBeNull()
    expect(r.contentHash).toBeNull()
    expect(r.seo).toBeNull()
    expect(r.textExtract).toBeNull()
  })

  it("records a 500 without treating it as a transport error", async () => {
    const { fetch } = scriptedFetch(() => statusResponse(500))

    const r = await checkUrl("https://example.com/broken", makeCtx(), fetch)

    expect(r.statusCode).toBe(500)
    expect(r.error).toBeNull()
    expect(r.contentHash).toBeNull()
  })

  it("surfaces fetch rejections as an error result when retries are disabled", async () => {
    const { fetch, calls } = scriptedFetch(() => {
      throw new Error("getaddrinfo ENOTFOUND example.invalid")
    })

    const r = await checkUrl("https://example.invalid/", makeCtx(), fetch)

    expect(r.error).toBe("getaddrinfo ENOTFOUND example.invalid")
    expect(r.statusCode).toBeNull()
    expect(r.responseTimeMs).toBeNull()
    expect(r.contentHash).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it("retries transient failures up to maxRetries and recovers", async () => {
    let n = 0
    const fetchImpl = (async () => {
      n++
      if (n < 3) throw new Error("socket hang up")
      return htmlResponse("<p>Recovered on third attempt</p>")
    }) as unknown as typeof fetch

    vi.useFakeTimers()
    try {
      const p = checkUrl(
        "https://example.com/flaky",
        makeCtx({ config: { retryOnTransientError: true, maxRetries: 2 } }),
        fetchImpl
      )
      // backoff sleeps are 500ms * failedAttempt: 500 + 1000 = 1500ms total
      await vi.advanceTimersByTimeAsync(1600)
      const r = await p
      expect(n).toBe(3)
      expect(r.statusCode).toBe(200)
      expect(r.error).toBeNull()
      expect(r.contentHash).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("uses HEAD when the lastmod is unchanged and known data is complete", async () => {
    const url = "https://example.com/heady"
    const ctx = makeCtx({
      knownHashes: new Map([
        [url, "storedhash"],
        [`${url}#seo`, "seohash"],
        [`${url}#checked`, "2026-02-01T00:00:00Z"]
      ]),
      lastmodByUrl: new Map([[url, "2026-01-01T00:00:00Z"]])
    })
    const { fetch, calls } = scriptedFetch(() => htmlResponse("<p>must not be read</p>"))

    const r = await checkUrl(url, ctx, fetch)

    expect(r.checkMethod).toBe("HEAD")
    expect(calls[0]!.init.method).toBe("HEAD")
    // HEAD responses are never body-analyzed
    expect(r.statusCode).toBe(200)
    expect(r.contentHash).toBeNull()
    expect(r.seo).toBeNull()
    expect(r.textExtract).toBeNull()
    expect(r.mojibakeScore).toBeNull()
    expect(r.llmGarbageScore).toBeNull()
  })

  it("falls back to GET when the sitemap lastmod is newer than the last check", async () => {
    const url = "https://example.com/fresh"
    const ctx = makeCtx({
      knownHashes: new Map([
        [url, "storedhash"],
        [`${url}#seo`, "seohash"],
        [`${url}#checked`, "2026-01-01T00:00:00Z"]
      ]),
      lastmodByUrl: new Map([[url, "2026-06-01T00:00:00Z"]])
    })
    const { fetch, calls } = scriptedFetch(() => htmlResponse("<p>Changed!</p>"))

    const r = await checkUrl(url, ctx, fetch)

    expect(r.checkMethod).toBe("GET")
    expect(calls[0]!.init.method).toBe("GET")
  })
  it("falls back to GET when the HEAD probe answers 405 and runs the full GET path", async () => {
    const url = "https://example.com/nohead"
    const html = "<p>Headless but readable</p>"
    const { fetch, calls } = scriptedFetch((reqUrl) =>
      reqUrl === url && calls[calls.length - 1]!.init.method === "HEAD"
        ? statusResponse(405)
        : htmlResponse(html)
    )

    const r = await checkUrl(url, headCtx(url), fetch)

    expect(calls.map((c) => [c.url, c.init.method])).toEqual([
      [url, "HEAD"],
      [url, "GET"]
    ])
    expect(r.statusCode).toBe(200)
    expect(r.error).toBeNull()
    // full GET processing: hash, seo, text extraction all populated
    expect(r.checkMethod).toBe("GET")
    expect(r.contentHash).toBe(sha256Hex(encoder.encode(html)))
    expect(r.seo).not.toBeNull()
    expect(r.textExtract).toContain("Headless but readable")
  })

  it("also falls back to GET on a 501 answer to the HEAD probe", async () => {
    const url = "https://example.com/nohead501"
    const { fetch, calls } = scriptedFetch(() =>
      calls.some((c) => c.init.method === "GET") ? htmlResponse("<p>Fifty-oh-one</p>") : statusResponse(501)
    )

    const r = await checkUrl(url, headCtx(url), fetch)

    expect(calls.map((c) => c.init.method)).toEqual(["HEAD", "GET"])
    expect(r.statusCode).toBe(200)
    expect(r.contentHash).not.toBeNull()
  })

  it("uses the GET fallback at most once: a 405 to the fallback GET ends the check", async () => {
    const url = "https://example.com/all405"
    const { fetch, calls } = scriptedFetch(() => statusResponse(405))

    const r = await checkUrl(url, headCtx(url), fetch)

    expect(calls.map((c) => c.init.method)).toEqual(["HEAD", "GET"])
    expect(r.statusCode).toBe(405)
    expect(r.error).toBeNull()
    expect(r.contentHash).toBeNull()
    expect(r.seo).toBeNull()
  })

  it("does not fall back for other HEAD statuses like 404", async () => {
    const url = "https://example.com/head404"
    const { fetch, calls } = scriptedFetch(() => statusResponse(404))

    const r = await checkUrl(url, headCtx(url), fetch)

    expect(calls.map((c) => c.init.method)).toEqual(["HEAD"])
    expect(r.statusCode).toBe(404)
    expect(r.checkMethod).toBe("HEAD")
    expect(r.contentHash).toBeNull()
  })

  it("applies the one-shot HEAD fallback mid-redirect-chain", async () => {
    const start = "https://example.com/redirecting"
    const dest = "https://example.com/destination"
    const { fetch, calls } = scriptedFetch((reqUrl) => {
      if (reqUrl === start) return redirectResponse(dest, 302)
      return calls[calls.length - 1]!.init.method === "HEAD"
        ? statusResponse(405)
        : htmlResponse("<p>After redirect</p>")
    })

    const r = await checkUrl(start, headCtx(start), fetch)

    expect(calls.map((c) => [c.url, c.init.method])).toEqual([
      [start, "HEAD"],
      [dest, "HEAD"],
      [dest, "GET"]
    ])
    expect(r.statusCode).toBe(200)
    expect(r.redirectChain).toEqual([start])
    expect(r.finalUrl).toBe(dest)
    expect(r.contentHash).not.toBeNull()
  })

  it("hashes an empty body to the empty-input sha256 and yields an empty text extract", async () => {
    const { fetch } = scriptedFetch(() => htmlResponse(""))

    const r = await checkUrl("https://example.com/empty", makeCtx(), fetch)

    expect(r.statusCode).toBe(200)
    expect(r.contentHash).toBe(EMPTY_SHA256)
    expect(r.textExtract).toBe("")
    expect(r.mojibakeFlagged).toBe(false)
    expect(r.llmGarbageFlagged).toBe(false)
  })

  it("caps the hashed/read body at maxBodyBytes", async () => {
    const html = `<html><body>${"A".repeat(300)}</body></html>`
    const bytes = encoder.encode(html)
    const { fetch } = scriptedFetch(() => htmlResponse(html))
    const ctx = makeCtx({ config: { maxBodyBytes: 64 } })

    const r = await checkUrl("https://example.com/big", ctx, fetch)

    expect(r.statusCode).toBe(200)
    // documents current behavior: the hash covers the ENTIRE stream (chunks are
    // hashed before the cap applies); only the retained/decoded body is capped
    expect(r.contentHash).toBe(sha256Hex(bytes))
    // observable truncation: analysis sees exactly the first 64 bytes
    // ("<html><body>" = 12 chars + 52 x "A"), never the closing tags
    expect(r.textExtract).toBe("A".repeat(52))
  })

  it("processes non-HTML content types the same as HTML", async () => {
    const json = '{"hello":"world","note":"checker ignores content-type"}'
    const { fetch } = scriptedFetch(
      () => new Response(json, { status: 200, headers: { "content-type": "application/json" } })
    )

    const r = await checkUrl("https://example.com/api/data", makeCtx(), fetch)

    expect(r.statusCode).toBe(200)
    expect(r.contentHash).toBe(sha256Hex(encoder.encode(json)))
    expect(r.textExtract).toBe(json)
  })

  it("flags mojibake-laden pages with a score and sample", async () => {
    const mojibakeHtml =
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Mojibake</title></head>' +
      "<body><h1>Encoding Disaster</h1><p>" +
      "\uFFFD".repeat(80) +
      " The rest of this paragraph is ordinary filler text so the document has a realistic visible length.</p></body></html>"
    const { fetch } = scriptedFetch(() => htmlResponse(mojibakeHtml))

    const r = await checkUrl("https://example.com/mojibake", makeCtx(), fetch)

    expect(r.mojibakeFlagged).toBe(true)
    expect(r.mojibakeScore).not.toBeNull()
    expect(r.mojibakeScore!).toBeGreaterThan(0.5)
    expect(r.mojibakeSample).not.toBeNull()
    expect(r.mojibakeSample).toContain("\uFFFD")
  })

  it("flags LLM-generated artifacts with a score and sample", async () => {
    const garbageHtml =
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Untitled</title></head>' +
      '<body><p>[INSERT PRODUCT DESCRIPTION HERE] I\'m sorry, but I cannot comply with that request ' +
      'because it violates the usage policy. {"response": "generated filler text goes right here"}</p></body></html>'
    const { fetch } = scriptedFetch(() => htmlResponse(garbageHtml))

    const r = await checkUrl("https://example.com/garbage", makeCtx(), fetch)

    expect(r.llmGarbageFlagged).toBe(true)
    expect(r.llmGarbageScore).toBeGreaterThan(0.5)
    expect(r.llmGarbageSample).not.toBeNull()
  })

  it("keeps clean pages unflagged by both detectors", async () => {
    const html =
      "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Clean</title></head>" +
      "<body><p>This page is written in plain ASCII prose and contains nothing unusual whatsoever.</p></body></html>"
    const { fetch } = scriptedFetch(() => htmlResponse(html))

    const r = await checkUrl("https://example.com/clean", makeCtx(), fetch)

    expect(r.mojibakeFlagged).toBe(false)
    expect(r.mojibakeScore).toBe(0)
    expect(r.mojibakeSample).toBeNull()
    expect(r.llmGarbageFlagged).toBe(false)
    expect(r.llmGarbageScore).toBe(0)
    expect(r.llmGarbageSample).toBeNull()
  })

  it("skips detectors and text extraction when both are disabled in config", async () => {
    const garbageHtml =
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Untitled</title></head>' +
      "<body><p>[INSERT PRODUCT DESCRIPTION HERE]</p></body></html>"
    const { fetch } = scriptedFetch(() => htmlResponse(garbageHtml))
    const ctx = makeCtx({ config: { detectMojibake: false, detectLlmGarbage: false } })

    const r = await checkUrl("https://example.com/skipped", ctx, fetch)

    expect(r.mojibakeScore).toBeNull()
    expect(r.mojibakeFlagged).toBe(false)
    expect(r.llmGarbageScore).toBeNull()
    expect(r.llmGarbageFlagged).toBe(false)
    // text extraction lives behind the same combined gate as the detectors
    expect(r.textExtract).toBeNull()
    expect(r.seo).not.toBeNull()
  })

  it("attaches SSL validity for https URLs and skips the TLS check for http", async () => {
    const httpsResult = await checkUrl(
      "https://example.com/secure",
      makeCtx(),
      scriptedFetch(() => htmlResponse("<p>s</p>")).fetch
    )
    expect(httpsResult.sslValidUntil).toBe(VALID_UNTIL)
    expect(mockedCheckSsl).toHaveBeenCalledWith("example.com", expect.any(Number))

    mockedCheckSsl.mockClear()
    const httpResult = await checkUrl(
      "http://example.com/plain",
      makeCtx(),
      scriptedFetch(() => htmlResponse("<p>p</p>")).fetch
    )
    expect(httpResult.sslValidUntil).toBeNull()
    expect(mockedCheckSsl).not.toHaveBeenCalled()
  })
})

describe("extractPageText", () => {
  it("strips scripts, styles, tags and entities, collapsing whitespace", () => {
    const html =
      "<div><script>evil()</script><style>.x { color: red }</style>Hello &amp; <b>World</b>  again</div>"
    expect(extractPageText(html)).toBe("Hello World again")
  })

  it("caps output at 16 KiB", () => {
    const long = "word ".repeat(6000)
    const out = extractPageText(long)
    expect(out.length).toBe(16 * 1024)
  })
})

describe("buildLastmodMap", () => {
  it("maps loc to lastmod verbatim, keeping explicit undefined and last-write-wins duplicates", () => {
    const entries: SitemapEntry[] = [
      { loc: "https://Example.com/A", lastmod: "2026-01-15T10:00:00Z" },
      { loc: "https://example.com/b/" }, // no lastmod
      { loc: "https://Example.com/A", lastmod: "2026-02-01T00:00:00Z" }
    ]

    const m = buildLastmodMap(entries)

    expect(m.size).toBe(2)
    // documents current behavior: no trailing-slash or case normalization is applied
    expect(m.get("https://Example.com/A")).toBe("2026-02-01T00:00:00Z")
    expect(m.has("https://example.com/b/")).toBe(true)
    expect(m.get("https://example.com/b/")).toBeUndefined()
    expect(m.has("https://example.com/a")).toBe(false)
  })
})
