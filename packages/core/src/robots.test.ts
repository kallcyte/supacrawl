import { describe, expect, it } from "vitest"
import { fetchAndParseRobots } from "./robots.js"

function textResponse(body: string, ok = true, status = 200): Response {
  return new Response(body, { status: ok ? 200 : status })
}

describe("fetchAndParseRobots", () => {
  it("fetches /robots.txt from the origin with an Accept header", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: url.toString(), init })
      return textResponse("")
    }

    await fetchAndParseRobots("https://example.com", fetchImpl)

    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.url).toBe("https://example.com/robots.txt")
    expect(call.init?.headers).toEqual({ Accept: "text/plain, */*" })
  })

  it("resolves relative Sitemap lines against the robots.txt origin", async () => {
    const body = [
      "User-agent: *",
      "Disallow: /private",
      "Sitemap: https://example.com/sitemap.xml",
      "Sitemap: /another-sitemap.xml",
    ].join("\n")
    const fetchImpl: typeof fetch = async () => textResponse(body)

    const result = await fetchAndParseRobots("https://example.com", fetchImpl)

    expect(result.sitemaps).toEqual([
      "https://example.com/sitemap.xml",
      "https://example.com/another-sitemap.xml",
    ])
  })

  it("dedupes resolved sitemaps preserving first-occurrence order", async () => {
    const body = [
      "User-agent: *",
      "Sitemap: https://example.com/sitemap.xml",
      "Sitemap: /sitemap.xml",
      "Sitemap: https://example.com/other.xml",
      "Sitemap: https://example.com/sitemap.xml",
    ].join("\n")
    const fetchImpl: typeof fetch = async () => textResponse(body)

    const result = await fetchAndParseRobots("https://example.com", fetchImpl)

    // "/sitemap.xml" resolves to the same absolute URL as the first entry
    expect(result.sitemaps).toEqual([
      "https://example.com/sitemap.xml",
      "https://example.com/other.xml",
    ])
  })

  it("drops sitemap entries that cannot be parsed as URLs", async () => {
    const body = [
      "User-agent: *",
      "Sitemap: https://exa mple.com/bad.xml",
      "Sitemap: https://example.com/good.xml",
    ].join("\n")
    const fetchImpl: typeof fetch = async () => textResponse(body)

    const result = await fetchAndParseRobots("https://example.com", fetchImpl)

    expect(result.sitemaps).toEqual(["https://example.com/good.xml"])
  })

  it("allows everything when robots.txt responds 404", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("Not Found", { status: 404 })

    const result = await fetchAndParseRobots("https://example.com", fetchImpl)

    expect(result.allowed("https://example.com/anything")).toBe(true)
    expect(result.allowed("https://example.com/private/data")).toBe(true)
    expect(result.crawlDelay).toBeNull()
    expect(result.sitemaps).toEqual([])
  })

  it("allows everything on other non-ok statuses", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("Server Error", { status: 500 })

    const result = await fetchAndParseRobots("https://example.com", fetchImpl)

    expect(result.allowed("https://example.com/x")).toBe(true)
    expect(result.crawlDelay).toBeNull()
    expect(result.sitemaps).toEqual([])
  })

  it("allows everything when robots.txt is empty", async () => {
    const fetchImpl: typeof fetch = async () => textResponse("")

    const result = await fetchAndParseRobots("https://example.com", fetchImpl)

    expect(result.allowed("https://example.com/any/path")).toBe(true)
    expect(result.crawlDelay).toBeNull()
    expect(result.sitemaps).toEqual([])
  })

  it("returns the permissive fallback when fetch throws", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("network down")
    }

    const result = await fetchAndParseRobots("https://example.com", fetchImpl)

    expect(result.allowed("https://example.com/x")).toBe(true)
    expect(result.crawlDelay).toBeNull()
    expect(result.sitemaps).toEqual([])
  })

  it("disallows paths matched by a wildcard-user-agent Disallow rule", async () => {
    const body = ["User-agent: *", "Disallow: /admin", "Disallow: /tmp"].join("\n")
    const fetchImpl: typeof fetch = async () => textResponse(body)

    const result = await fetchAndParseRobots("https://example.com", fetchImpl)

    expect(result.allowed("https://example.com/admin/panel")).toBe(false)
    expect(result.allowed("https://example.com/tmp/file")).toBe(false)
    expect(result.allowed("https://example.com/blog/post")).toBe(true)
  })

  it("gives a specific user-agent group precedence over the wildcard group", async () => {
    const body = [
      "User-agent: Googlebot",
      "Disallow: /",
      "",
      "User-agent: *",
      "Disallow:",
    ].join("\n")
    const fetchImpl: typeof fetch = async () => textResponse(body)

    const result = await fetchAndParseRobots("https://example.com", fetchImpl)

    // checks run as "*", so the wildcard group applies, not Googlebot's
    expect(result.allowed("https://example.com/")).toBe(true)
  })

  it("parses crawl-delay as a number and defaults to null when absent", async () => {
    const withDelay = ["User-agent: *", "Crawl-delay: 2.5"].join("\n")
    const result = await fetchAndParseRobots(
      "https://example.com",
      async () => textResponse(withDelay),
    )
    expect(result.crawlDelay).toBe(2.5)

    const withoutDelay = ["User-agent: *", "Disallow: /x"].join("\n")
    const resultNoDelay = await fetchAndParseRobots(
      "https://example.com",
      async () => textResponse(withoutDelay),
    )
    expect(resultNoDelay.crawlDelay).toBeNull()
  })

  it("treats an empty Disallow as allowing all paths", async () => {
    const body = ["User-agent: *", "Disallow:"].join("\n")
    const fetchImpl: typeof fetch = async () => textResponse(body)

    const result = await fetchAndParseRobots("https://example.com", fetchImpl)

    expect(result.allowed("https://example.com/everything/here")).toBe(true)
  })
})
