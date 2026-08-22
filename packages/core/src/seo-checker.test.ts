import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { checkSeo, analyzeContent } from "./seo-checker.js"
import { getTagAttrs } from "./seo.js"

// node:tls is mocked so checkSsl (called by checkSeo for https URLs) never
// opens a real socket. The hoisted state switches the fake socket between
// "cert" (secure connect with a peer certificate) and "error" modes.
const tlsState = vi.hoisted(() => ({
  mode: "cert" as "cert" | "error",
  cert: {} as Record<string, unknown>
}))

vi.mock("node:tls", () => ({
  connect: vi.fn(
    (_opts: unknown, cb?: (socket: unknown) => void) => {
      const socket = {
        getPeerCertificate: () => tlsState.cert,
        setTimeout: (_ms: number, _fn: () => void) => {},
        on: (ev: string, fn: (err?: Error) => void) => {
          if (tlsState.mode === "error" && ev === "error") {
            queueMicrotask(() => fn(new Error("connect ECONNREFUSED")))
          }
        },
        end: () => {},
        destroy: () => {}
      }
      if (tlsState.mode === "cert") queueMicrotask(() => cb!(socket))
      return socket
    }
  )
}))

type Route = { status: number; body?: string; headers?: Record<string, string> }

function stubFetch(routes: Record<string, Route>) {
  const calls: { url: string; init: RequestInit }[] = []
  const fake = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = input.toString()
    calls.push({ url, init: init ?? {} })
    const route = routes[url]
    if (!route) return new Response(null, { status: 404 })
    return new Response(route.body ?? null, {
      status: route.status,
      headers: route.headers ?? {}
    })
  })
  vi.stubGlobal("fetch", fake)
  return calls
}

const HTML = `<!doctype html>
<html lang="en">
<head>
  <title>Test Page</title>
  <meta name="description" content="A page for tests">
</head>
<body>
  <h1>Hello</h1>
  <h2>Section one</h2>
  <h2>Section two</h2>
  <p>Hello world of testing here</p>
  <img src="/a.png">
  <img src="/b.png" alt="b">
  <a href="/internal">Internal</a>
  <a href="https://other.example.org/x">External</a>
</body>
</html>`

beforeEach(() => {
  tlsState.mode = "cert"
  tlsState.cert = {}
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("checkSeo", () => {
  it("returns a full result for a 200 HTML page", async () => {
    const url = "http://example.com/"
    const body = new TextEncoder().encode(HTML)
    stubFetch({ [url]: { status: 200, body: HTML } })

    const res = await checkSeo(url)

    expect(res.url).toBe(url)
    expect(res.finalUrl).toBe(url)
    expect(res.statusCode).toBe(200)
    expect(res.error).toBeNull()
    expect(res.responseTimeMs).toBeTypeOf("number")
    expect(res.responseTimeMs).toBeGreaterThanOrEqual(0)
    expect(res.redirectChain).toEqual([])
    expect(res.pageWeightBytes).toBe(body.length)
    expect(res.gzippedBytes).toBeGreaterThan(0)
    expect(res.sslValidUntil).toBeNull() // http URL: no SSL check
    expect(res.seo).not.toBeNull()
    expect(res.seo!.title).toBe("Test Page")
    expect(res.seo!.description).toBe("A page for tests")
    expect(res.seo!.lang).toBe("en")
    expect(res.seo!.h1Count).toBe(1)
    expect(res.content).toEqual({
      wordCount: expect.any(Number),
      imageCount: 2,
      imagesMissingAlt: 1,
      linkCount: 2,
      internalLinkCount: 1,
      h2Count: 2
    })
    expect(res.content!.wordCount).toBeGreaterThan(0)
  })

  it("fetches with redirect:manual and the requested user agent", async () => {
    const calls = stubFetch({
      "http://example.com/": { status: 200, body: "<html><body>x</body></html>" }
    })

    await checkSeo("http://example.com/", { userAgent: "my-agent/1.0" })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.init.redirect).toBe("manual")
    expect((calls[0]!.init.headers as Record<string, string>)["User-Agent"]).toBe("my-agent/1.0")
  })

  it("follows a redirect chain and reports it", async () => {
    stubFetch({
      "http://example.com/a": { status: 301, headers: { location: "/b" } },
      "http://example.com/b": { status: 302, headers: { location: "http://example.org/c" } },
      "http://example.org/c": { status: 200, body: HTML }
    })

    const res = await checkSeo("http://example.com/a")

    expect(res.statusCode).toBe(200)
    expect(res.finalUrl).toBe("http://example.org/c")
    expect(res.redirectChain).toEqual(["http://example.com/a", "http://example.com/b"])
    expect(res.error).toBeNull()
    expect(res.seo!.title).toBe("Test Page")
  })

  it("detects a redirect loop and reports an error result", async () => {
    stubFetch({
      "http://example.com/a": { status: 301, headers: { location: "/b" } },
      "http://example.com/b": { status: 301, headers: { location: "/a" } }
    })

    const res = await checkSeo("http://example.com/a")

    expect(res.error).toBe("Redirect loop")
    expect(res.statusCode).toBe(301)
    expect(res.finalUrl).toBe("http://example.com/a")
    expect(res.redirectChain).toEqual(["http://example.com/a"])
    expect(res.seo).toBeNull()
    expect(res.pageWeightBytes).toBe(0)
  })

  it("returns an error-shaped result for HTTP error statuses", async () => {
    stubFetch({ "http://example.com/missing": { status: 404, body: "not found" } })

    const res = await checkSeo("http://example.com/missing")

    expect(res.statusCode).toBe(404)
    expect(res.error).toBeNull()
    expect(res.finalUrl).toBe("http://example.com/missing")
    expect(res.seo).toBeNull()
    expect(res.content).toBeNull()
    expect(res.pageWeightBytes).toBe(0)
    expect(res.gzippedBytes).toBe(0)
  })

  it("captures the fetch rejection message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND")
    }))

    const res = await checkSeo("http://unreachable.invalid/")

    expect(res.error).toBe("getaddrinfo ENOTFOUND")
    expect(res.statusCode).toBeNull()
    expect(res.finalUrl).toBeNull()
    expect(res.responseTimeMs).toBeTypeOf("number")
    expect(res.seo).toBeNull()
    expect(res.content).toBeNull()
  })

  it("still measures weight and content stats for non-HTML content", async () => {
    const body = JSON.stringify({ key: "value" })
    stubFetch({
      "http://example.com/api": {
        status: 200,
        body,
        headers: { "content-type": "application/json" }
      }
    })

    const res = await checkSeo("http://example.com/api")

    expect(res.statusCode).toBe(200)
    expect(res.pageWeightBytes).toBe(new TextEncoder().encode(body).length)
    expect(res.content).toEqual({
      wordCount: 2,
      imageCount: 0,
      imagesMissingAlt: 0,
      linkCount: 0,
      internalLinkCount: 0,
      h2Count: 0
    })
    expect(res.seo!.title).toBeNull()
  })

  it("caps the body at maxBytes", async () => {
    const big = "x".repeat(1000)
    stubFetch({ "http://example.com/big": { status: 200, body: big } })

    const res = await checkSeo("http://example.com/big", { maxBytes: 100 })

    expect(res.pageWeightBytes).toBe(100)
    expect(res.gzippedBytes).toBeGreaterThan(0)
  })

  it("records sslValidUntil for a successful https TLS handshake", async () => {
    const validTo = new Date("2030-01-02T03:04:05.000Z")
    tlsState.cert = {
      valid_to: validTo.toUTCString(),
      valid_from: new Date("2029-01-01T00:00:00.000Z").toUTCString(),
      issuer: { O: "Test CA" },
      subject: { CN: "secure.example.com" }
    }
    stubFetch({ "https://secure.example.com/": { status: 200, body: "<html></html>" } })

    const res = await checkSeo("https://secure.example.com/")

    expect(res.sslValidUntil).toBe(validTo.toISOString())
    expect(res.statusCode).toBe(200)
    expect(res.error).toBeNull()
  })

  it("leaves sslValidUntil null when the TLS connection fails", async () => {
    tlsState.mode = "error"
    stubFetch({ "https://broken.example.com/": { status: 200, body: "<html></html>" } })

    const res = await checkSeo("https://broken.example.com/")

    expect(res.sslValidUntil).toBeNull()
    expect(res.error).toBeNull()
    expect(res.statusCode).toBe(200)
  })
})

describe("getTagAttrs", () => {
  it("parses double-quoted, single-quoted and unquoted attributes", () => {
    expect(getTagAttrs('<meta name="viewport" content=\'width=device-width\'>')).toEqual(
      new Map([
        ["name", "viewport"],
        ["content", "width=device-width"]
      ])
    )
    expect(getTagAttrs("<img src=/a.png alt=hello>")).toEqual(
      new Map([
        ["src", "/a.png"],
        ["alt", "hello"]
      ])
    )
  })

  it("returns an empty map for a tag without attributes", () => {
    expect(getTagAttrs("<br>")).toEqual(new Map())
  })

  it("yields undefined for attributes that are not present", () => {
    expect(getTagAttrs('<img src="/a.png">').get("alt")).toBeUndefined()
  })
})

describe("analyzeContent edge cases", () => {
  it("ignores script and style contents when counting words", () => {
    const html = "<style>.a{color:red}</style><script>var x = 1;</script><p>real words here</p>"
    const body = new TextEncoder().encode(html)
    expect(analyzeContent(body, "http://example.com/").wordCount).toBe(3)
  })

  it("counts zero for an empty body", () => {
    const stats = analyzeContent(new Uint8Array(0), "http://example.com/")
    expect(stats).toEqual({
      wordCount: 0,
      imageCount: 0,
      imagesMissingAlt: 0,
      linkCount: 0,
      internalLinkCount: 0,
      h2Count: 0
    })
  })
})
