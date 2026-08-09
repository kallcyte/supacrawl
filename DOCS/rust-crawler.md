# Rust Crawler — Migration Plan (Option C)

## Motivation

Node.js memory profile for crawling: V8 heap grows to high-water mark, GC is lazy, per-request object overhead is significant. Rust gives:

- **Flat, predictable RSS** (~100-200MB for 10k+ concurrent fetches)
- **Zero-cost HTTP** (no GC pauses, no heap-buffer per request)
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
│         │  or via HTTP/gRPC         │                │
│         └─────────────┬─────────────┘                │
│                       │                              │
│         ┌─────────────┴─────────────┐                │
│         │     Shared SQLite DB      │                │
│         │   (WAL mode, busy_timeout)│                │
│         └───────────────────────────┘                │
└─────────────────────────────────────────────────────┘
```

## Crate structure

```
crawler/                    # Rust workspace
├── Cargo.toml
├── crates/
│   ├── core/               # Types, config, robots, sitemap parser
│   ├── fetcher/            # HTTP client, redirects, SSL check
│   ├── checker/            # URL check, content hash, SEO, mojibake, LLM garbage
│   ├── storage/            # SQLite (rusqlite + migrations)
│   ├── notifier/           # Slack, Telegram, Email, Webhook
│   └── daemon/             # Main binary: receives crawl jobs, executes, reports back
└── Cargo.lock
```

## Component mapping

| Node.js file                 | Rust crate   | Notes                                    |
|------------------------------|--------------|------------------------------------------|
| `crawler.ts`                 | `core`       | URL queue, rate limiting, concurrency    |
| `checker.ts`                 | `checker`    | HTTP fetch, hash, body analysis          |
| `sitemap.ts`                 | `core`       | XML parser (quick-xml/fast-xml)          |
| `robots.ts`                  | `core`       | robots.txt parser                        |
| `ssl.ts`                     | `fetcher`    | TLS check via rustls + tokio-rustls      |
| `seo.ts`                     | `checker`    | HTML parser (scraper/lol-html)           |
| `mojibake.ts`                | `checker`    | Chardet alternative (encoding_rs)        |
| `llm-garbage.ts`             | `checker`    | Regex-based detection                    |
| `storage.ts`                 | `storage`    | rusqlite + migrations                    |
| `notifier/`                  | `notifier`   | reqwest-based HTTP notification providers|
| `orchestrator.ts`            | `daemon`     | Coordination, progress reporting         |
| `diff.ts` (sha256)           | `checker`    | sha2 crate                                |

## Communication protocol

The Rust daemon runs as a child process spawned by the Node.js server.
Communication via stdin/stdout JSON lines (or Unix socket):

```json
# Request (from Node → Rust)
{"type":"start_crawl","id":"uuid","config":{...},"sitemaps":[...]}

# Response (from Rust → Node)
{"type":"progress","crawlId":"uuid","checked":42,"total":100,...}
{"type":"result","crawlId":"uuid","url":"https://...","statusCode":200,...}
{"type":"complete","crawlId":"uuid","record":{...}}
{"type":"error","crawlId":"uuid","error":"message"}
```

## Key dependencies

| Crate               | Purpose                               |
|---------------------|---------------------------------------|
| `tokio`             | Async runtime, tasks, I/O              |
| `reqwest`           | HTTP client (rustls, HTTP/2, redirects)|
| `rusqlite`          | SQLite bindings                        |
| `quick-xml`         | XML/sitemap parsing                    |
| `scraper`           | HTML parsing (SEO)                     |
| `encoding_rs`       | Charset detection (mojibake)           |
| `sha2`              | Content hashing                        |
| `serde` / `serde_json` | JSON serialization for IPC          |
| `tracing`           | Structured logging                     |
| `clap`              | CLI argument parsing                   |

## Phase plan

### Phase 1 — Core engine (2-3 weeks)
- `core` crate: types, config, URL queue, host-delay rate limiter
- `fetcher` crate: HTTP fetch with redirects, timeouts, undici-like pool
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
- IPC protocol between Node and Rust
- Notifier port (Slack, Telegram, Email, Webhook)
- Replace `runCrawlWithPersistence` in Node with child process spawn
- Graceful shutdown, abort, progress streaming

### Phase 4 — Production hardening (1 week)
- Resource limits via cgroups or OS-level
- Graceful restart on OOM
- Metrics export (prometheus)
- Docker image (multi-stage: Rust build + Node final)

## Migration strategy

1. **Side-by-side**: Rust binary lives in `crawler/` directory at repo root. Node server spawns it as-needed.
2. **Feature flag**: `CRAWLER_BACKEND=rust` env var switches between in-process Node and child-process Rust.
3. **Gradual rollback**: Each crate is independently testable. If a bug appears, fall back to Node backend.

## Risk assessment

| Risk | Mitigation |
|------|------------|
| SQLite locking from concurrent Rust + Node | WAL mode + busy_timeout; Node only reads during crawl, Rust writes |
| Rust binary size | ~15-20MB static binary; multi-stage Docker build |
| IPC overhead | Batch results (progress every N URLs, results streamed) |
| Learning curve | Language familiar to team? If not, Phase 1-2 take longer |

## When to choose Rust vs Go

- **Rust**: You need absolute minimum memory footprint, want to eliminate GC entirely, or team already knows Rust.
- **Go**: Faster to ship (2-3x faster dev time), predictable 100-300MB RSS, simpler concurrency model, better ecosystem for HTTP services.