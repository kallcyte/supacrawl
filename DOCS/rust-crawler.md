# Rust Crawler — Migration Plan (Option C)

## Motivation

Node.js memory profile for crawling: V8 heap grows to high-water mark, GC is lazy, per-request object overhead is significant. Rust gives:

- **Flat, predictable RSS** (~100-200MB for 10k+ concurrent fetches)
- **Lower-overhead HTTP** (no GC pauses, far less per-request allocation than V8 — reqwest still allocates, but nowhere near Node's overhead)
- **goroutine-equivalent memory** (~2KB per task via tokio)
- **Better SQLite bindings** (rusqlite, no native addon issues)

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Node.js Server                    │
│  (Fastify, Dashboard, Auth, Notifications, Scheduler)│
│                       │                              │
│         ┌─────────────┴─────────────┐                │
│         │  Crawl Manager (Rust)     │                │
│         │  spawned as child process │                │
│         │  (stdio JSON-lines IPC)   │                │
│         └─────────────┬─────────────┘                │
│                       │                              │
│         ┌─────────────┴─────────────┐                │
│         │     Shared SQLite DB      │                │
│         │   (WAL mode, busy_timeout)│                │
│         └───────────────────────────┘                │
└─────────────────────────────────────────────────────┘
```

**Decision: child process + stdio, not HTTP/gRPC.** Simpler to ship, matches the Phase 3 IPC design below, and is enough for a single-box deployment. Revisit if/when the crawler needs to run on a separate host or scale independently of the Node server — at that point moving to gRPC is a clean, isolated change (the `daemon` crate's core logic doesn't need to know which transport it's using).

**Logging vs IPC:** stdout is reserved exclusively for the JSON-lines protocol. All `tracing` output goes to stderr (or a log file), never stdout — mixing the two will corrupt the protocol stream.

## Crate structure

```
crawler/                    # Rust workspace
├── Cargo.toml
├── crates/
│   ├── core/               # Types, config, robots, sitemap parser
│   ├── fetcher/            # HTTP client, redirects, SSL check, SSRF guard
│   ├── checker/            # URL check, content hash, SEO, mojibake, LLM garbage
│   ├── storage/            # SQLite (rusqlite + migrations)
│   ├── notifier/           # Slack, Telegram, Email, Webhook
│   └── daemon/             # Main binary: receives crawl jobs, executes, reports back
└── Cargo.lock
```

## Component mapping

| Node.js file                 | Rust crate   | Notes                                    |
|------------------------------|--------------|-------------------------------------------|
| `crawler.ts`                 | `core`       | URL queue, rate limiting, concurrency     |
| `checker.ts`                 | `checker`    | HTTP fetch, hash, body analysis           |
| `sitemap.ts`                 | `core`       | XML parser (quick-xml)                    |
| `robots.ts`                  | `core`       | robots.txt parser                         |
| `ssl.ts`                     | `fetcher`    | TLS check via rustls + tokio-rustls       |
| `seo.ts`                     | `checker`    | HTML parser (scraper/lol-html)            |
| `mojibake.ts`                | `checker`    | Chardet alternative (encoding_rs)         |
| `llm-garbage.ts`             | `checker`    | Regex-based detection                     |
| `storage.ts`                 | `storage`    | rusqlite + migrations                     |
| `notifier/`                  | `notifier`   | reqwest-based HTTP notification providers |
| `orchestrator.ts`            | `daemon`     | Coordination, progress reporting          |
| `diff.ts` (sha256)           | `checker`    | sha2 crate                                |

## Communication protocol

The Rust daemon runs as a child process spawned by the Node.js server.
Communication via stdin/stdout JSON lines:

```json
# Request (from Node → Rust)
{"type":"start_crawl","id":"uuid","config":{...},"sitemaps":[...]}

# Response (from Rust → Node)
{"type":"progress","crawlId":"uuid","checked":42,"total":100,...}
{"type":"result","crawlId":"uuid","url":"https://...","statusCode":200,...}
{"type":"complete","crawlId":"uuid","record":{...}}
{"type":"error","crawlId":"uuid","error":"message"}
{"type":"backpressure","crawlId":"uuid","queueDepth":5000,"paused":true}
```

**Backpressure:** the URL discovery queue and the in-flight result buffer are both bounded. If Node/SQLite can't drain results fast enough, the daemon pauses new fetches and emits a `backpressure` message rather than growing unbounded — otherwise the whole point of the migration (flat memory) is defeated, just in a different process. Queue depth cap and drain rate should be configurable per crawl.

**Correlation IDs:** every `tracing` span in the Rust daemon is tagged with the same `crawlId` used in the IPC protocol and in Node's own request/job IDs, so a single crawl can be traced end-to-end across both processes. Set this up in Phase 3, not bolted on during Phase 4.

## Key dependencies

| Crate               | Purpose                               |
|---------------------|----------------------------------------|
| `tokio`             | Async runtime, tasks, I/O              |
| `reqwest`           | HTTP client (rustls, HTTP/2, redirects)|
| `rusqlite`          | SQLite bindings                        |
| `quick-xml`         | XML/sitemap parsing                    |
| `scraper`           | HTML parsing (SEO)                     |
| `encoding_rs`       | Charset detection (mojibake)           |
| `sha2`              | Content hashing                        |
| `serde` / `serde_json` | JSON serialization for IPC          |
| `tracing`           | Structured logging (stderr only)       |
| `clap`              | CLI argument parsing                   |

## Phase plan

### Phase 1 — Core engine (2-3 weeks, +50% if team is new to Rust)
- `core` crate: types, config, URL queue (bounded), host-delay rate limiter
- `fetcher` crate: HTTP fetch with redirects, timeouts, connection pool, baseline SSRF guard (block private/link-local IP ranges and cloud metadata endpoints by default)
- `checker` crate: basic check (status, hash, response time)
- `storage` crate: SQLite schema, result persistence, url_state
- CLI binary that reads a JSON config, runs a crawl, writes results

### Phase 2 — Analysis features (1-2 weeks)
- SEO extraction (title, description, og, canonical, json-ld, h1, word count)
- Mojibake detection (encoding_rs + heuristic)
- LLM garbage detection (regex patterns)
- SSL certificate check (rustls)
- Content diffing (hash comparison)

### Phase 3 — Integration (1 week)
- IPC protocol between Node and Rust, including backpressure signaling
- Correlation IDs threaded through `tracing` spans and IPC messages
- Notifier port (Slack, Telegram, Email, Webhook)
- Replace `runCrawlWithPersistence` in Node with child process spawn
- Graceful shutdown, abort, progress streaming

### Phase 4 — Production hardening (1 week)
- Resource limits via cgroups or OS-level
- Graceful restart on OOM
- Metrics export (prometheus)
- Docker image (multi-stage: Rust build targeting `x86_64-unknown-linux-musl` for a truly static binary + Node final stage)

## Migration strategy

1. **Side-by-side**: Rust binary lives in `crawler/` directory at repo root. Node server spawns it as-needed.
2. **Feature flag**: `CRAWLER_BACKEND=rust` env var switches between in-process Node and child-process Rust.
3. **Gradual rollback**: Each crate is independently testable. If a bug appears, fall back to Node backend.

## Risk assessment

| Risk | Mitigation |
|------|------------|
| SQLite locking from concurrent Rust + Node | WAL mode + busy_timeout. Rust owns all writes to a crawl's rows while that crawl is active; Node is only permitted to write to those rows once the crawl completes. Enforce this at the application layer (e.g. a `locked_by_crawl` flag), not just via SQLite's own locking, since WAL mode alone won't stop Node's dashboard/API layer from writing mid-crawl. |
| Unbounded queue/buffer growth | Bounded URL queue and result buffer with explicit backpressure signaling in the IPC protocol (see above) — otherwise memory growth just moves from V8 to Rust. |
| SSRF via crawler fetching arbitrary URLs | `fetcher` crate blocks private/link-local IP ranges and cloud metadata endpoints by default; allowlist/denylist configurable per deployment. |
| Rust binary size | ~15-20MB static binary via `x86_64-unknown-linux-musl` target; multi-stage Docker build. |
| IPC overhead | Batch results (progress every N URLs, results streamed); stdout reserved for protocol only, logs to stderr. |
| Learning curve | Language familiar to team? If not, Phase 1-2 take longer — budget +50% on Phase 1 if the team is new to Rust, not just a footnote risk. |

## When to choose Rust vs Go

- **Rust**: You need absolute minimum memory footprint, want to eliminate GC entirely, or team already knows Rust.
- **Go**: Faster to ship (2-3x faster dev time), predictable 100-300MB RSS, simpler concurrency model, better ecosystem for HTTP services.
