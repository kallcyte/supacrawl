# SupaCrawl → Cloudflare Workers Port Plan

## Overview

Port the SupaCrawl monorepo from a single-process Node.js server (Hono + SQLite + in-process schedulers) to Cloudflare's serverless platform (Workers, D1, Durable Objects, Queues, Pages). Single deployment, dashboard-only management (CLI dropped), Telegram + Slack + Webhook + Microsoft Teams notifications (email dropped).

**Note:** this plan covers the code port. Because SupaCrawl is a running service with live data (crawls, monitors, auth users), a **data migration and cutover plan** (Phase 8) is required alongside the code work — see below. Treat "port the code" and "migrate the service" as two separate tracks that converge at cutover.

---

## Decisions (from review)

| # | Decision | Rationale |
|---|---|---|
| 1 | **Split `seo` into separate table** | `crawl_results.seo` JSON may exceed D1's 100KB row limit for large crawls. |
| 2 | **Cron-only monitors (no Queues)** | ~50 monitors × ~3s probe = fine within Workers 30s CPU. Queue fan-out is overkill at this scale. |
| 3 | **Single deployment (no multi-tenant)** | One D1 database, one Worker, one Pages project. No tenant-isolation concerns. |
| 4 | **Drop CLI entirely** | Dashboard is sufficient for all management. Remove `packages/cli`. |
| 5 | **Drop email, add Microsoft Teams** | Only Telegram is actively used. Teams uses incoming webhooks (HTTP POST, similar to Slack). |
| 6 | **Requires Workers Paid plan** | Cron Triggers work on Free, but Queues and Durable Objects (used for crawl fan-out and WS progress) require the Paid plan. Confirm this is acceptable before committing to the architecture. |

---

## Phase 0 — Dependency Audit & Replacements

**Goal:** Swap every Node/OS dependency for a CF-compatible equivalent.

| Current | CF Replacement | Notes |
|---|---|---|
| `better-sqlite3` (sync native addon) | **D1** (Cloudflare SQLite) | Full rewrite of `Storage` class. All queries become async. |
| `better-auth` + `better-sqlite3` adapter | `better-auth` + `@better-auth/adapter-d1` | Community adapter exists. Drop manual `CREATE TABLE` in `auth.ts`. |
| `nodemailer` (raw SMTP sockets) | **Removed** | Email provider dropped. Remove `packages/core/src/notifier/email.ts` and auth.ts reset-password SMTP code. |
| `ws` (WebSocket server) | **Durable Objects** + `WebSocketPair` | Progress streaming during crawls. DOs provide stateful WebSocket connections. |
| `node-cron` | **Workers Cron Triggers** | `JobScheduler` and `MonitorScheduler` currently use `setInterval`. Minimum granularity is 1 minute — see Phase 3.1 note on resolution change. |
| `p-limit` | **Workers Queues** for crawl fan-out + manual concurrency in cron handlers | Crawler uses `p-limit` for per-host and global concurrency. Queue consumers handle batching; cron handler for monitors uses `Promise.all` with concurrency cap. |
| `node:crypto` (`randomUUID`, `createHash`) | **Web Crypto API** (`crypto.randomUUID()`, `crypto.subtle.digest`) | Drop-in replacement. |
| `node:fs` / `node:path` / `__dirname` | **Remove** | Dashboard moves to Pages; API becomes pure HTTP. |
| `@hono/node-server` | **Hono's Workers adapter** | Server already uses Hono — swap the adapter. |
| `chardet` | **`jschardet`** | Pure JS replacement for native binding. |
| `undici` | **Workers native `fetch`** | Already abstracted behind `fetchImpl`. Drop `undici` dep. |
| `exceljs` | **Keep** (verify compatibility) | Pure JS, but may use Node streams. Test early in `wrangler dev`. |
| `robots-parser` | **Keep** | Pure JS, no native deps. |
| `fast-xml-parser` | **Keep** | Pure JS, no native deps. |
| `packages/cli` | **Removed** | Drop the entire package. |

---

## Phase 1 — Storage Layer (D1 Migration)

**Goal:** Rewrite `packages/core/src/storage.ts` to use D1 instead of `better-sqlite3`.

### 1.1 Schema Migration

The current schema is ~15 tables. D1 supports standard SQLite DDL. The schema moves to a `migrations/` folder managed by `wrangler d1 migrations`.

**Tables to migrate:**
- `crawls`, `crawl_jobs`, `url_state`, `settings`
- `monitors`, `heartbeats`, `maintenance_windows`
- `user`, `account`, `session`, `verification` (better-auth — handled by D1 adapter)
- `status_pages`, `status_page_monitors`, `resource_snapshots`

**New table — `crawl_results_seo`** (split from `crawl_results`):

```sql
CREATE TABLE crawl_results (
  id TEXT PRIMARY KEY,
  crawl_id TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  status_code INTEGER,
  response_time_ms INTEGER,
  content_hash TEXT,
  content_changed INTEGER DEFAULT 0,
  error TEXT,
  redirect_chain TEXT,
  ssl_valid_until TEXT,
  sitemap_lastmod TEXT,
  checked_at TEXT NOT NULL,
  check_method TEXT NOT NULL,
  mojibake_score REAL,
  mojibake_flagged INTEGER DEFAULT 0,
  llm_garbage_score REAL,
  llm_garbage_flagged INTEGER DEFAULT 0
  -- seo column REMOVED, moved to crawl_results_seo
);

CREATE TABLE crawl_results_seo (
  result_id TEXT PRIMARY KEY REFERENCES crawl_results(id) ON DELETE CASCADE,
  title TEXT,
  description TEXT,
  h1 TEXT,
  canonical TEXT,
  robots_meta TEXT,
  og_title TEXT,
  og_description TEXT,
  og_image TEXT,
  word_count INTEGER,
  internal_links INTEGER,
  external_links INTEGER,
  schema_types TEXT  -- JSON array of schema.org types found
);
```

This keeps each row well under 100KB. SEO data is queried only on demand (per-result detail views), not during crawl listing queries.

`redirect_chain` remains on `crawl_results` — for a typical crawl this is small (a handful of URLs), but if redirect loops or unusually long chains are possible in practice, cap the stored chain length defensively rather than assuming it never contributes to a row-size problem.

### 1.2 Storage Class Rewrite

The `Storage` class (~800+ lines) has ~50 methods, all synchronous. Every method becomes `async`:

```
Storage.getCrawl(id)         → async D1 prepare + first()
Storage.createCrawl(record)  → async D1 prepare + run()
Storage.listResults(...)     → async D1 prepare + all()
Storage.getSeo(resultId)     → async D1 prepare + first()
Storage.upsertSeo(...)       → async D1 prepare + run()
...
```

**Key differences from better-sqlite3:**
- No `db.transaction()` — D1 runs each statement atomically. Multi-statement transactions use `db.batch()`.
- `db.batch()` is **not** a general-purpose interactive transaction — all statements must be known up front (no branching on an intermediate result within the batch). Code that currently does read-then-conditionally-write inside one `better-sqlite3` transaction (e.g. monitor status-transition + heartbeat + notification dedup) needs to be redesigned around this constraint, typically by making the write idempotent (`INSERT ... ON CONFLICT DO UPDATE`) rather than relying on transactional isolation.
- No `db.pragma()` — WAL is default on D1.
- `busy_timeout` — irrelevant; D1 handles concurrency server-side, but D1 has a documented concurrent-connection ceiling per database (see Risk Matrix) worth load-testing against, not just assuming away.
- Prepared statements are ephemeral per-request; no persistent `db.prepare()` caching.
- Writes under load benefit from batching (`db.batch()`) rather than one `run()` per row — relevant for `crawl_results` inserts at scale (Phase 3.3).

### 1.3 Auth D1 Adapter

Replace `packages/server/src/auth.ts`:
- Remove `new Database(dbPath)` and manual `CREATE TABLE IF NOT EXISTS` statements.
- Use `betterAuth` with `@better-auth/adapter-d1`.
- Remove `nodemailer` reset-password handler. Password reset is disabled or handled via the dashboard (admin-managed).
- If GitHub OAuth is configured, the callback URL will change once the API moves to its Workers domain — update the GitHub OAuth app settings as part of cutover, not as an afterthought (Phase 8).

---

## Phase 2 — Server & API (Workers)

**Goal:** `packages/server` becomes a Cloudflare Worker.

### 2.1 Hono Worker Adapter

Replace `@hono/node-server` with Hono's built-in Workers adapter:

```ts
// Before (Node)
import { serve } from "@hono/node-server"
serve({ fetch: app.fetch, port: 3456 })

// After (Workers)
export default app
```

### 2.2 Dashboard Serving

- **Dashboard** → deploy to **Cloudflare Pages** (separate project).
- **API** → deploy to **Workers**.
- API CORS already exists (`hono/cors`). Update to allow the Pages domain.
- Remove `serveStatic` middleware from server.

### 2.3 WebSocket → Durable Objects

The `CrawlManager` emits `CrawlProgress` events via `ws` to dashboard clients. Replace with:

1. **Durable Object** per crawl session (`CrawlSessionDO`).
2. Clients connect via `WebSocketPair` to the DO.
3. DO receives progress updates from Queue consumers via DO fetch/RPC.
4. DO fans out progress to all connected WS clients.

Use the **WebSocket hibernation API** (`acceptWebSocket` + `getWebSockets`) to avoid billing active connections during idle periods.

### 2.4 Routes

All existing Hono routes (`packages/server/src/routes/*.ts`) are already Hono handlers — they port directly. The `RouteDeps` interface changes: `storage` becomes async, `crawlManager` and `monitorScheduler` change shape (see Phase 3).

---

## Phase 3 — Schedulers & Background Work

**Goal:** Replace in-process `setInterval` schedulers with Cloudflare primitives.

### 3.1 JobScheduler → Cron Trigger

The `JobScheduler` currently polls every 30s and checks if any crawl job is due. Cloudflare Cron Triggers have a **1-minute minimum granularity**, so this is a real behavior change, not just a mechanism swap: scheduling resolution goes from 30s to 60s, and a job whose `next_run_at` falls just after a cron tick will wait up to ~1 minute longer than before. Confirm this is acceptable for all existing jobs before cutover; if any job genuinely needs sub-minute resolution, that job's design needs to change (e.g., a DO alarm instead of cron).

```toml
# wrangler.toml
[triggers]
crons = ["*/1 * * * *"]  # every minute
```

The cron handler:
1. Queries D1 for enabled jobs whose `next_run_at` ≤ now.
2. For each due job, enqueues a crawl task (see 3.3).
3. Staggers by enqueuing with `delaySeconds` (replaces `staggerMs`).

### 3.2 MonitorScheduler → Cron Trigger (inline probes)

**Decision:** ~50 monitors, each probe takes ~3s. All probes run concurrently via `Promise.all` with a concurrency cap (e.g., 20). Total wall time ≤ ~8s, well under the Workers 30s CPU limit.

```toml
[triggers]
crons = ["*/1 * * * *"]  # every minute — this is also the practical floor for Cron Triggers
```

Same 30s → 60s resolution caveat as 3.1 applies here: any monitor currently configured with an `interval_seconds` below 60 will effectively be checked no more often than once a minute post-migration. Surface this in the dashboard if such monitors exist.

The cron handler:
1. Queries D1 for enabled monitors due for check (based on `interval_seconds` + `last_checked_at`).
2. Runs `checkMonitor()` for each due monitor with `Promise.all` + a semaphore (max 20 concurrent).
3. Persists heartbeats to D1.
4. Fires down/recovery notifications on status transitions — use an idempotent write (state transition guarded by the stored `last_status`) so a re-run of the same cron tick (e.g. after a Worker restart mid-batch) can't double-fire a notification.

**No Queues needed** at this scale. If monitor count grows beyond ~200, or per-monitor intervals need to go below 60s, revisit this design (Queue fan-out or DO alarms).

### 3.3 Crawl Execution → Queues

Crawls are long-running (potentially thousands of URLs). Workers CPU limit is 30s per request, and each Worker invocation is also capped on **subrequests** (fetch calls) — 50 on the Free plan, 1000 on Paid. Batch sizing must respect both limits, not just CPU time:

1. **Cron trigger** or **API call** enqueues a "start crawl" message.
2. **Queue consumer** fetches the sitemap, parses URLs, and splits into batches of N URLs (e.g., 50, sized to stay well under the subrequest ceiling for that consumer's own fetches).
3. Each batch is enqueued as a separate message with metadata (crawlId, batch index, total batches).
4. Each batch consumer runs `checkUrl` for its assigned URLs, persists results + seo to D1 (via `db.batch()` rather than per-row `run()`), and emits progress to the Durable Object.
5. When all batches complete (tracked via D1 counter or final batch flag), the final consumer runs notifications and marks the crawl as finished.

**Idempotency / retries:** Cloudflare Queues delivers messages at-least-once — a batch consumer can be retried after a partial failure (e.g., it wrote 30 of 50 results then errored). Persist results with `INSERT ... ON CONFLICT (id) DO UPDATE` (or delete-then-insert per batch) so a retried batch doesn't double-count in the "all batches complete" counter or duplicate rows. Configure a dead-letter queue for batches that exhaust retries, and surface failed crawls in the dashboard rather than letting them silently never complete.

**Concurrency control:** The per-host `p-limit` (delay + max concurrency) is replaced by:
- **Queue `max_concurrency`** for global limits.
- **`delaySeconds`** on enqueue for coarse per-host throttling. Note this delays message *visibility*, not a guaranteed inter-request gap — it's an approximation of the old per-host delay, not an exact replacement.
- A **host limiter Durable Object** that tracks the last request timestamp per host and enforces delays before enqueuing the next batch for that host — use a DO alarm to re-check and re-enqueue rather than busy-waiting inside a consumer.

### 3.4 ResourceMonitor → Dropped

Tracks Node.js memory/CPU. Irrelevant in Workers. **Removed entirely.**

---

## Phase 4 — Notifier Port

**Goal:** Drop email, add Microsoft Teams.

### 4.1 Changes

| Provider | Action |
|---|---|
| **Slack** | Keep — pure `fetch` to webhook URL. No changes. |
| **Telegram** | Keep — pure `fetch` to Bot API. No changes. |
| **Webhook** | Keep — pure `fetch` to custom URL. No changes. |
| **Email** | **Remove** — delete `packages/core/src/notifier/email.ts`. Remove from `Notifier` class. Remove SMTP reset-password code from `auth.ts`. |
| **Microsoft Teams** | **Add** — new `packages/core/src/notifier/teams.ts`. Uses incoming webhook connector: `POST` with `MessageCard` JSON payload. |

### 4.2 Teams Provider Implementation

Teams incoming webhooks accept a simple JSON payload:

```ts
// packages/core/src/notifier/teams.ts
export class TeamsProvider implements NotificationProvider {
  name = "teams"

  constructor(private config: { enabled: boolean; webhookUrl: string }) {}

  async send(payload: NotificationPayload): Promise<void> {
    const card = {
      "@type": "MessageCard",
      "@context": "https://schema.org/extensions",
      summary: payload.title,
      title: payload.title,
      text: payload.body,
      themeColor: payload.type === "alert" ? "FF0000" : "0076D7"
    }
    await fetch(this.config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card)
    })
  }
}
```

Note: Microsoft has been deprecating Office 365 Connector-based incoming webhooks in favor of Power Automate workflows for Teams — confirm the target Teams tenant still supports the classic `MessageCard` webhook before building against it, and fall back to a Power Automate HTTP trigger payload shape if not.

### 4.3 Types Update

Add `teams` to `NotificationsConfig.providers` in `packages/core/src/types.ts`:

```ts
teams: { enabled: boolean; webhookUrl: string }
```

Register in `Notifier` constructor alongside the other providers.

---

## Phase 5 — Dashboard (Pages)

**Goal:** Deploy `packages/dashboard` to Cloudflare Pages.

### 5.1 Vite Config

Add `@cloudflare/vite-plugin` for the SPA. The dashboard is a client-side React app — no SSR needed.

### 5.2 API URL

Currently the dashboard proxies to the server (Vite dev proxy → `:3456`). For production:
- Set `VITE_API_URL` to the Workers API domain.
- `better-auth` client: configure `baseURL` to the Workers API URL.

### 5.3 Build

Add a `pages:build` script. Cloudflare Pages auto-detects Vite. The `dist/` output is served by Pages.

---

## Phase 6 — Configuration

**Goal:** Replace file-based config with D1 + env vars.

### 6.1 `supacrawl.config.json`

The config file is read at startup via `loadConfigFromFile`. Migrate:
- **Crawler defaults** (delay, concurrency, timeout) → `settings` table in D1 (already exists).
- **Notification config** → `settings` table in D1.
- **Secrets** (API keys, webhook URLs) → **Workers Secrets** (`wrangler secret put`).

### 6.2 Environment Variables

Port existing env vars to `wrangler.toml` `[vars]` and `[env.production.vars]`:
- `BETTER_AUTH_SECRET` → Worker Secret
- `BETTER_AUTH_URL` → Worker var (must match the new Workers API domain — see Phase 1.3 OAuth note)
- `BETTER_AUTH_TRUSTED_ORIGINS` → Worker var (must include the new Pages domain)
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` → Worker Secrets
- `TEAMS_WEBHOOK_URL`, `SLACK_WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`, etc. → Worker Secrets

---

## Phase 7 — Testing & Validation

### 7.1 Local Development

Use `wrangler dev` for the Worker and `wrangler pages dev` for the dashboard. D1 has local SQLite via `wrangler d1 execute --local`. Durable Object and Queue local simulation both work under `wrangler dev` (backed by Miniflare) — confirm the installed `wrangler` version supports local Queues simulation, since this has historically lagged other primitives.

### 7.2 Integration Tests

Rewrite `vitest` suites:
- Storage tests: mock D1 with Miniflare's D1 simulator or use `wrangler d1 execute --local`.
- API tests: use Miniflare's `getMiniflareDurableObject` and `dispatchFetch`.
- Crawler tests: mock `fetch` as before; ensure concurrency control works in the Queue consumer model, and add explicit tests for the retry/idempotency paths in 3.3 (partial-batch failure, redelivery).

### 7.3 Load Testing

Verify D1 row limits, Queue throughput, D1 concurrent-connection behavior, and cron accuracy with production-scale crawls (10k+ URLs) **before** cutover, not after.

---

## Phase 8 — Data Migration & Cutover

**Goal:** Move the live SQLite database into D1 and switch traffic over with a defined rollback path. This is separate from — and gates — go-live.

### 8.1 Export / Import

1. Export the existing SQLite file's tables to SQL insert statements (or use `wrangler d1 execute --file` against a dump).
2. Import into a staging D1 database first; run the full integration + load test suite (Phase 7) against the imported data, not synthetic data.
3. Pay particular attention to `better-auth` tables (`user`, `account`, `session`, `verification`) — session tokens and OAuth account links must survive the migration intact, or all users will need to re-authenticate.

### 8.2 Cutover Strategy

- Freeze writes to the old server (pause `JobScheduler`/`MonitorScheduler`, put the dashboard in read-only or maintenance mode).
- Take a final export, import into production D1.
- Deploy the Worker + Pages project, point DNS/API URL at the new stack.
- Smoke-test: auth login, one manual crawl end-to-end, one monitor check, one notification of each type (Slack/Telegram/Webhook/Teams).
- Unfreeze: enable cron triggers.

Expect a maintenance window measured in tens of minutes to a few hours depending on database size, not zero-downtime — call this out to stakeholders early.

### 8.3 Rollback

Keep the old Node/SQLite deployment runnable (not decommissioned) for a defined bake period post-cutover (suggest ≥1 week). If critical issues surface, the rollback path is: re-point DNS/API URL back to the old server, restore the frozen SQLite file (no data was written to it during the bake period only if the old server stayed fully stopped — decide explicitly whether the old server is fully off or in cold standby, since that determines whether a rollback loses any data written post-cutover).

---

## Phase 9 — Observability

Currently absent from the original plan and worth having before cutover, not after an incident:

- **Logs:** `wrangler tail` for ad-hoc debugging; consider Logpush to an external sink for anything beyond short-term debugging, since Workers log retention is limited.
- **Errors:** surface Queue consumer failures and DO errors somewhere durable (D1 table or external error tracker) — a silently-retried-to-death queue message is otherwise invisible.
- **Crawl/monitor health:** a simple dashboard panel showing "crons ran on schedule" / "queue backlog depth" catches scheduling regressions like the 30s→60s resolution change early.

---

## Risk Matrix

| Risk | Severity | Mitigation |
|---|---|---|
| D1 row limit (100KB) exceeded by `crawl_results` JSON | High | Split `seo` into `crawl_results_seo` table (Phase 1.1) |
| Crawl execution > 30s CPU timeout | High | Queue-based batch fan-out (Phase 3.3) |
| Queue redelivery causes duplicate/partial writes | High | Idempotent upserts + batch-completion tracking (Phase 3.3) |
| Data migration corrupts or loses auth sessions | High | Staging import + full test pass before production cutover (Phase 8.1) |
| D1 concurrent connection limits under load | Medium | Load-test against realistic concurrency, not assumed; use `db.batch()` for multi-statement operations |
| Scheduling resolution drops from 30s to 60s (crons) | Medium | Confirm acceptable for all jobs/monitors before cutover; flag any sub-minute monitor configs (Phase 3.1, 3.2) |
| `better-auth` D1 adapter instability | Medium | Test early; fallback to manual D1 session management |
| Workers subrequest limit hit during batch crawling | Medium | Size batches to plan tier's subrequest ceiling, not just CPU time (Phase 3.3) |
| Teams classic incoming webhooks deprecated for target tenant | Medium | Verify webhook type supported before building; fall back to Power Automate payload shape |
| WebSocket migration complexity | Medium | Durable Objects are well-documented for WS; use hibernation API |
| `exceljs` runtime incompatibility | Low | Test in `wrangler dev`; migrate to `xlsx` if needed |
| `chardet` native binding | Low | Swap to `jschardet` |
| Monorepo build complexity | Low | `pnpm` works in CI; each package builds independently |

---

## Milestone Sequence

1. **M0 — Scaffold** (1-2 days)
   - `wrangler init` for Worker + D1
   - `wrangler pages` for dashboard
   - Monorepo wiring (shared packages)
   - Remove `packages/cli`
   - Confirm Workers Paid plan is provisioned (needed for Queues + Durable Objects)

2. **M1 — Storage** (3-5 days)
   - D1 schema migrations (including `crawl_results_seo`)
   - `Storage` class async rewrite, with `db.batch()` used for anything that was an atomic multi-statement transaction under `better-sqlite3`
   - Auth D1 adapter
   - Remove email notifier code

3. **M2 — Core portability** (2-3 days)
   - Replace `node:crypto` → Web Crypto
   - Replace `chardet` → `jschardet`
   - Replace `undici` → native `fetch`
   - Verify `robots-parser`, `fast-xml-parser`, `exceljs` compatibility

4. **M3 — Server + API** (3-4 days)
   - Hono Workers adapter
   - Route porting
   - Dashboard → Pages

5. **M4 — Schedulers + Queues + Durable Objects** (5-7 days)
   - Cron triggers for jobs + monitors (confirm 60s resolution is acceptable)
   - Queue-based crawl execution with idempotent writes and a dead-letter queue
   - WebSocket → Durable Objects for progress streaming
   - Host limiter DO

6. **M5 — Notifiers** (1-2 days)
   - Drop email provider
   - Add Microsoft Teams provider (confirm webhook type first)
   - Verify Slack/Telegram/Webhook work in Workers

7. **M6 — Testing** (2-3 days)
   - Integration tests, including Queue retry/idempotency paths
   - Load tests against production-scale data
   - End-to-end crawl verification

8. **M7 — Data migration & cutover** (2-4 days, previously unaccounted for)
   - Staging import + full test pass against real data
   - Maintenance-window cutover, rollback plan confirmed and rehearsed
   - Bake period on old stack before decommission

9. **M8 — Observability** (1 day, can run in parallel with M4-M6)
   - Logpush / log sink
   - Queue and DO error surfacing
   - Cron/queue health visibility

**Total estimate:** ~21-31 days for a solo developer familiar with both codebases (up from the original 17-26, reflecting the added data-migration/cutover and observability work, which are not optional for a live service).
