import { describe, expect, it } from "vitest"
import { gzipSync } from "node:zlib"
import {
  discoverSitemapTree,
  fetchAndParseSitemap,
  fetchSitemapBytes,
  isLikelySitemapUrl,
  resolveSitemapUrls,
} from "./sitemap.js"
import type { SitemapFetchOptions } from "./sitemap.js"

// ---------------------------------------------------------------------------
// Helpers: a route-table based fake fetch. No network is ever touched.
// ---------------------------------------------------------------------------

function xmlResponse(
  body: string | Uint8Array,
  opts: { status?: number; contentType?: string } = {}
): Response {
  const headers = new Headers()
  headers.set("content-type", opts.contentType ?? "application/xml")
  return new Response(body as ConstructorParameters<typeof Response>[0], {
    status: opts.status ?? 200,
    headers,
  })
}

interface FetchLog {
  calls: string[]
}

function makeFetch(
  routes: Record<string, Response>,
  log: FetchLog = { calls: [] }
): typeof fetch {
  const fn = async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    log.calls.push(url)
    const hit = routes[url]
    if (hit) return hit
    return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } })
  }
  return fn as unknown as typeof fetch
}

function urlset(urls: Array<Partial<{ loc: string; lastmod: string; changefreq: string; priority: string | number }>>): string {
  const rows = urls
    .map((u) => {
      const inner =
        (u.loc !== undefined ? `<loc>${u.loc}</loc>` : "") +
        (u.lastmod !== undefined ? `<lastmod>${u.lastmod}</lastmod>` : "") +
        (u.changefreq !== undefined ? `<changefreq>${u.changefreq}</changefreq>` : "") +
        (u.priority !== undefined ? `<priority>${u.priority}</priority>` : "")
      return `<url>${inner}</url>`
    })
    .join("")
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows}</urlset>`
}

function sitemapIndex(locs: string[]): string {
  const rows = locs.map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join("")
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows}</sitemapindex>`
}

const ORIGIN = "https://example.com"

// ---------------------------------------------------------------------------
// fetchSitemapBytes
// ---------------------------------------------------------------------------

describe("fetchSitemapBytes", () => {
  it("returns decoded body and isGzipped=false for a plain XML sitemap", async () => {
    const xml = urlset([{ loc: `${ORIGIN}/a` }])
    const log: FetchLog = { calls: [] }
    const fetchImpl = makeFetch({ [`${ORIGIN}/sitemap.xml`]: xmlResponse(xml) }, log)

    const res = await fetchSitemapBytes(`${ORIGIN}/sitemap.xml`, fetchImpl)

    expect(new TextDecoder().decode(res.body)).toBe(xml)
    expect(res.isGzipped).toBe(false)
    expect(log.calls).toEqual([`${ORIGIN}/sitemap.xml`])
  })

  it("detects gzip by magic number even without a .gz extension", async () => {
    const xml = urlset([{ loc: `${ORIGIN}/a` }])
    const gz = gzipSync(Buffer.from(xml))
    // Served under a plain .xml name but bytes are gzip.
    const fetchImpl = makeFetch({ [`${ORIGIN}/weird.xml`]: xmlResponse(gz) })

    const res = await fetchSitemapBytes(`${ORIGIN}/weird.xml`, fetchImpl)

    expect(res.isGzipped).toBe(true)
    expect(new TextDecoder().decode(res.body)).toBe(xml)
  })

  it("decompresses a sitemap served as .gz bytes", async () => {
    const xml = sitemapIndex([`${ORIGIN}/child.xml`])
    const gz = gzipSync(Buffer.from(xml))
    const fetchImpl = makeFetch({ [`${ORIGIN}/sitemap.xml.gz`]: xmlResponse(gz) })

    const res = await fetchSitemapBytes(`${ORIGIN}/sitemap.xml.gz`, fetchImpl)

    expect(res.isGzipped).toBe(true)
    expect(new TextDecoder().decode(res.body)).toBe(xml)
  })

  it("throws an HTTP-status error for a failed response", async () => {
    const fetchImpl = makeFetch({
      [`${ORIGIN}/missing.xml`]: new Response("nope", { status: 404 }),
    })

    await expect(fetchSitemapBytes(`${ORIGIN}/missing.xml`, fetchImpl)).rejects.toThrow(
      `Failed to fetch sitemap ${ORIGIN}/missing.xml: HTTP 404`
    )
  })
})

// ---------------------------------------------------------------------------
// isLikelySitemapUrl
// ---------------------------------------------------------------------------

describe("isLikelySitemapUrl", () => {
  it("accepts .xml and .xml.gz paths case-insensitively", () => {
    expect(isLikelySitemapUrl(`${ORIGIN}/sitemap.xml`)).toBe(true)
    expect(isLikelySitemapUrl(`${ORIGIN}/SITEMAP.XML.GZ`)).toBe(true)
    expect(isLikelySitemapUrl(`${ORIGIN}/wp-sitemap.xml`)).toBe(true)
  })

  it("accepts paths merely mentioning sitemap even without an xml extension", () => {
    expect(isLikelySitemapUrl(`${ORIGIN}/sitemap`)).toBe(true)
    expect(isLikelySitemapUrl(`${ORIGIN}/blog/my-sitemaps-index`)).toBe(true)
  })

  it("rejects ordinary pages, query-only matches outside the path, and invalid URLs", () => {
    expect(isLikelySitemapUrl(`${ORIGIN}/about/team.html`)).toBe(false)
    expect(isLikelySitemapUrl(`${ORIGIN}/products?id=sitemap`)).toBe(false)
    expect(isLikelySitemapUrl("not a url")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// resolveSitemapUrls
// ---------------------------------------------------------------------------

describe("resolveSitemapUrls", () => {
  it("short-circuits when the given URL is itself a sitemap and never fetches", async () => {
    const log: FetchLog = { calls: [] }
    const fetchImpl = makeFetch({}, log)

    const res = await resolveSitemapUrls(`${ORIGIN}/sitemap.xml`, fetchImpl)

    expect(res).toEqual({ urls: [`${ORIGIN}/sitemap.xml`], errors: [] })
    expect(log.calls).toEqual([])
  })

  it("collects robots.txt sitemaps and probed common paths, deduplicated", async () => {
    const log: FetchLog = { calls: [] }
    const fetchImpl = makeFetch(
      {
        [`${ORIGIN}/robots.txt`]: new Response(
          `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/feeds/main.xml\n`,
          { status: 200, headers: { "content-type": "text/plain" } }
        ),
        // Probed common path that actually exists.
        [`${ORIGIN}/sitemap.xml`]: xmlResponse(urlset([{ loc: `${ORIGIN}/a` }])),
      },
      log
    )

    const res = await resolveSitemapUrls(ORIGIN, fetchImpl)

    expect(res.errors).toEqual([])
    expect(res.urls).toContain(`${ORIGIN}/feeds/main.xml`)
    expect(res.urls).toContain(`${ORIGIN}/sitemap.xml`)
    expect(new Set(res.urls).size).toBe(res.urls.length)
    // The robots URL must have been consulted.
    expect(log.calls).toContain(`${ORIGIN}/robots.txt`)
  })

  it("still probes common paths when robots.txt is absent", async () => {
    const log: FetchLog = { calls: [] }
    const fetchImpl = makeFetch(
      {
        [`${ORIGIN}/robots.txt`]: new Response("missing", { status: 404 }),
        [`${ORIGIN}/sitemap_index.xml`]: xmlResponse(sitemapIndex([`${ORIGIN}/child.xml`])),
      },
      log
    )

    const res = await resolveSitemapUrls(ORIGIN, fetchImpl)

    expect(res.urls).toEqual([`${ORIGIN}/sitemap_index.xml`])
    expect(log.calls.some((c) => c.endsWith("/sitemap_index.xml"))).toBe(true)
  })

  it("ignores probes whose content-type is not XML", async () => {
    const fetchImpl = makeFetch({
      [`${ORIGIN}/robots.txt`]: new Response("", { status: 404 }),
      [`${ORIGIN}/sitemap.xml`]: xmlResponse("<html>not really</html>", {
        contentType: "text/html",
      }),
    })

    const res = await resolveSitemapUrls(ORIGIN, fetchImpl)

    expect(res.urls).toEqual([])
    expect(res.errors).toEqual([])
  })

  it("rejects on an unparseable URL", async () => {
    const fetchImpl = makeFetch({})
    await expect(resolveSitemapUrls("::not-a-url::", fetchImpl)).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// discoverSitemapTree
// ---------------------------------------------------------------------------

describe("discoverSitemapTree", () => {
  it("sums leaf counts across an index with mixed children", async () => {
    const fetchImpl = makeFetch({
      [`${ORIGIN}/index.xml`]: sitemapIndexAsResponse([`${ORIGIN}/a.xml`, `${ORIGIN}/b.xml`]),
      [`${ORIGIN}/a.xml`]: xmlResponse(urlset([{ loc: `${ORIGIN}/p1` }, { loc: `${ORIGIN}/p2` }])),
      [`${ORIGIN}/b.xml`]: xmlResponse(urlset([{ loc: `${ORIGIN}/q1` }])),
    })

    const tree = await discoverSitemapTree(`${ORIGIN}/index.xml`, fetchImpl)

    expect(tree.leafCount).toBe(3)
    expect(tree.children.map((c) => c.url).sort()).toEqual([
      `${ORIGIN}/a.xml`,
      `${ORIGIN}/b.xml`,
    ])
    expect(tree.children.every((c) => c.children.length === 0)).toBe(true)
  })

  it("recurses through nested indexes up to maxDepth", async () => {
    const fetchImpl = makeFetch({
      [`${ORIGIN}/top.xml`]: sitemapIndexAsResponse([`${ORIGIN}/mid.xml`]),
      [`${ORIGIN}/mid.xml`]: sitemapIndexAsResponse([`${ORIGIN}/leaf.xml`]),
      [`${ORIGIN}/leaf.xml`]: xmlResponse(urlset([{ loc: `${ORIGIN}/x1` }, { loc: `${ORIGIN}/x2` }])),
    })

    const tree = await discoverSitemapTree(`${ORIGIN}/top.xml`, fetchImpl, 3)

    expect(tree.leafCount).toBe(2)
    expect(tree.children[0]?.url).toBe(`${ORIGIN}/mid.xml`)
    expect(tree.children[0]?.children[0]?.url).toBe(`${ORIGIN}/leaf.xml`)
    expect(tree.children[0]?.children[0]?.leafCount).toBe(2)
  })

  it("truncates branches beyond maxDepth instead of throwing", async () => {
    const log: FetchLog = { calls: [] }
    const fetchImpl = makeFetch(
      {
        [`${ORIGIN}/top.xml`]: sitemapIndexAsResponse([`${ORIGIN}/mid.xml`]),
        [`${ORIGIN}/mid.xml`]: sitemapIndexAsResponse([`${ORIGIN}/leaf.xml`]),
        [`${ORIGIN}/leaf.xml`]: xmlResponse(urlset([{ loc: `${ORIGIN}/x1` }])),
      },
      log
    )

    const tree = await discoverSitemapTree(`${ORIGIN}/top.xml`, fetchImpl, 1)

    // top -> mid is depth 1 (still visited); leaf would be depth 2 > maxDepth 1.
    expect(tree.leafCount).toBe(0)
    expect(tree.children[0]?.url).toBe(`${ORIGIN}/mid.xml`)
    expect(tree.children[0]?.children).toEqual([
      { url: `${ORIGIN}/leaf.xml`, leafCount: 0, children: [] },
    ])
    // Depth-exceeded nodes are stubbed before any fetch happens.
    expect(log.calls).not.toContain(`${ORIGIN}/leaf.xml`)
  })

  it("counts an unreachable child as zero leaves without failing the whole tree", async () => {
    const fetchImpl = makeFetch({
      [`${ORIGIN}/index.xml`]: sitemapIndexAsResponse([
        `${ORIGIN}/gone.xml`,
        `${ORIGIN}/ok.xml`,
      ]),
      [`${ORIGIN}/ok.xml`]: xmlResponse(urlset([{ loc: `${ORIGIN}/p1` }])),
      // gone.xml intentionally unrouted -> 404
    })

    const tree = await discoverSitemapTree(`${ORIGIN}/index.xml`, fetchImpl)

    expect(tree.leafCount).toBe(1)
    const gone = tree.children.find((c) => c.url === `${ORIGIN}/gone.xml`)
    expect(gone).toMatchObject({ leafCount: 0, children: [] })
  })

  it("discovers sitemaps via resolveSitemapUrls when given a site root rather than a sitemap URL", async () => {
    const fetchImpl = makeFetch({
      [`${ORIGIN}/robots.txt`]: new Response(`Sitemap: ${ORIGIN}/sitemap.xml\n`, {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
      [`${ORIGIN}/sitemap.xml`]: xmlResponse(urlset([{ loc: `${ORIGIN}/p1` }, { loc: `${ORIGIN}/p2` }])),
    })

    const tree = await discoverSitemapTree(ORIGIN, fetchImpl)

    expect(tree.url).toBe(ORIGIN)
    expect(tree.leafCount).toBe(2)
    expect(tree.children.map((c) => c.url)).toEqual([`${ORIGIN}/sitemap.xml`])
  })
})

/** Response helper for index docs routed through makeFetch. */
function sitemapIndexAsResponse(locs: string[]): Response {
  return xmlResponse(sitemapIndex(locs))
}

// ---------------------------------------------------------------------------
// fetchAndParseSitemap
// ---------------------------------------------------------------------------

function opts(extra: Partial<SitemapFetchOptions> = {}): SitemapFetchOptions {
  return extra
}

describe("fetchAndParseSitemap", () => {
  it("parses urlset entries with loc, lastmod, changefreq and numeric priority", async () => {
    const fetchImpl = makeFetch({
      [`${ORIGIN}/sitemap.xml`]: xmlResponse(
        urlset([
          { loc: `${ORIGIN}/a`, lastmod: "2026-01-02", changefreq: "daily", priority: "0.8" },
          { loc: `${ORIGIN}/b` },
          // Non-URL loc values are dropped silently.
          { loc: "" },
          { loc: "::bad::", lastmod: "2026-05-05" },
        ])
      ),
    })

    const res = await fetchAndParseSitemap(`${ORIGIN}/sitemap.xml`, opts({ fetchImpl }))

    expect(res.errors).toEqual([])
    expect(res.urls).toEqual([
      { loc: `${ORIGIN}/a`, lastmod: "2026-01-02", changefreq: "daily", priority: 0.8 },
      { loc: `${ORIGIN}/b` },
    ])
  })

  it("deduplicates entries by loc keeping the newest lastmod", async () => {
    const fetchImpl = makeFetch({
      [`${ORIGIN}/index.xml`]: sitemapIndexAsResponse([`${ORIGIN}/one.xml`, `${ORIGIN}/two.xml`]),
      [`${ORIGIN}/one.xml`]: xmlResponse(
        urlset([{ loc: `${ORIGIN}/dup`, lastmod: "2026-01-01" }, { loc: `${ORIGIN}/only-one` }])
      ),
      [`${ORIGIN}/two.xml`]: xmlResponse(
        urlset([{ loc: `${ORIGIN}/dup`, lastmod: "2026-03-03" }, { loc: `${ORIGIN}/only-two` }])
      ),
    })

    const res = await fetchAndParseSitemap(`${ORIGIN}/index.xml`, opts({ fetchImpl }))

    const dups = res.urls.filter((e) => e.loc === `${ORIGIN}/dup`)
    expect(dups).toHaveLength(1)
    expect(dups[0]?.lastmod).toBe("2026-03-03")
    expect(res.urls.map((e) => e.loc).sort()).toEqual([
      `${ORIGIN}/dup`,
      `${ORIGIN}/only-one`,
      `${ORIGIN}/only-two`,
    ])
  })

  it("accumulates per-child errors for HTTP 404 and 500 responses", async () => {
    const fetchImpl = makeFetch({
      [`${ORIGIN}/index.xml`]: sitemapIndexAsResponse([`${ORIGIN}/gone.xml`, `${ORIGIN}/boom.xml`]),
      [`${ORIGIN}/gone.xml`]: new Response("nope", { status: 404 }),
      [`${ORIGIN}/boom.xml`]: new Response("kaput", { status: 500 }),
    })

    const res = await fetchAndParseSitemap(`${ORIGIN}/index.xml`, opts({ fetchImpl }))

    expect(res.urls).toEqual([])
    expect(res.errors).toHaveLength(2)
    expect(res.errors.some((e) => e.includes(`${ORIGIN}/gone.xml`) && e.includes("HTTP 404"))).toBe(
      true
    )
    expect(res.errors.some((e) => e.includes(`${ORIGIN}/boom.xml`) && e.includes("HTTP 500"))).toBe(
      true
    )
  })

  it("reports a helpful error when no sitemaps can be discovered for a bare origin", async () => {
    const fetchImpl = makeFetch({})

    const res = await fetchAndParseSitemap(ORIGIN, opts({ fetchImpl }))

    expect(res.urls).toEqual([])
    expect(res.errors).toEqual([
      `No sitemaps found for ${ORIGIN}. Try the sitemap URL directly or add one to robots.txt.`,
    ])
  })

  it("stops collecting entries immediately when the signal aborts mid-crawl", async () => {
    const controller = new AbortController()
    controller.abort()
    let fetched = 0
    const base = makeFetch({
      [`${ORIGIN}/sitemap.xml`]: xmlResponse(
        urlset([{ loc: `${ORIGIN}/p1` }, { loc: `${ORIGIN}/p2` }])
      ),
    })
    const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      fetched++
      return base(input as string, init)
    }) as typeof fetch

    const res = await fetchAndParseSitemap(
      `${ORIGIN}/sitemap.xml`,
      opts({ fetchImpl, signal: controller.signal })
    )

    expect(fetched).toBeGreaterThan(0)
    expect(res.urls).toEqual([])
  })

  it("queues depth-exceeded children as errors instead of fetching them", async () => {
    const log: FetchLog = { calls: [] }
    const fetchImpl = makeFetch(
      {
        [`${ORIGIN}/top.xml`]: sitemapIndexAsResponse([`${ORIGIN}/mid.xml`]),
        [`${ORIGIN}/mid.xml`]: sitemapIndexAsResponse([`${ORIGIN}/leaf.xml`]),
      },
      log
    )

    const res = await fetchAndParseSitemap(`${ORIGIN}/top.xml`, opts({ fetchImpl, maxDepth: 1 }))

    expect(log.calls).not.toContain(`${ORIGIN}/leaf.xml`)
    expect(res.errors).toEqual([`Max depth exceeded for ${ORIGIN}/leaf.xml`])
    expect(res.urls).toEqual([])
  })

  it("reports progress per visited document via onProgress", async () => {
    const fetchImpl = makeFetch({
      [`${ORIGIN}/index.xml`]: sitemapIndexAsResponse([`${ORIGIN}/one.xml`, `${ORIGIN}/two.xml`]),
      [`${ORIGIN}/one.xml`]: xmlResponse(urlset([{ loc: `${ORIGIN}/a` }])),
      [`${ORIGIN}/two.xml`]: xmlResponse(urlset([{ loc: `${ORIGIN}/b` }])),
    })
    const seen: number[] = []

    const res = await fetchAndParseSitemap(
      `${ORIGIN}/index.xml`,
      opts({ fetchImpl, onProgress: (n) => seen.push(n) })
    )

    expect(seen).toEqual([1, 2, 3])
    expect(res.errors).toEqual([])
  })

  it("documents current behavior: empty urlset is clean, malformed XML records one error", async () => {
    const fetchImpl = makeFetch({
      [`${ORIGIN}/empty.xml`]: xmlResponse(
        '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>'
      ),
      [`${ORIGIN}/broken.xml`]: xmlResponse("<this is << not xml at all"),
    })

    const empty = await fetchAndParseSitemap(`${ORIGIN}/empty.xml`, opts({ fetchImpl }))
    const broken = await fetchAndParseSitemap(`${ORIGIN}/broken.xml`, opts({ fetchImpl }))

    expect(empty).toEqual({ urls: [], errors: [] })
    // Malformed XML makes fast-xml-parser throw; the module catches it and
    // records a per-document error instead of crashing the whole crawl.
    expect(broken.urls).toEqual([])
    expect(broken.errors).toHaveLength(1)
    expect(broken.errors[0]).toContain(`Failed to parse ${ORIGIN}/broken.xml`)
  })
})
