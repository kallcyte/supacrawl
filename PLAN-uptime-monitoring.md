# Plan: Add UptimeKuma-style Uptime Monitoring to SupaCrawl

## Goal

Extend SupaCrawl beyond periodic sitemap-based crawling to include real-time
uptime monitoring with heartbeat tracking, live status dashboards, and a public
status page -- effectively an UptimeKuma clone integrated into the existing
platform.

### User preferences

1. **Heartbeat bars**: 90-tick bars on monitor list and detail pages. Each tick
   represents one check interval (e.g. 90 ticks of 16min = 24h). Green = up,
   red = down, gray = no data. Hover shows timestamp and status.
2. **Auto-import monitors from crawl jobs**: When a crawl job runs, its checked
   URLs are automatically imported as monitors (one per URL). Users can also
   manually add monitors for any endpoint. Both types coexist in the Monitors
   list, distinguished by a "source" field (`crawl_job` vs `manual`).
3. **Public status page**: Status pages are served at `/status/:slug` with **no
   authentication**. Anyone with the link can view them. No custom domain support
   needed.

### Confirmed decisions

- **Heartbeat bars**: 90-tick UptimeKuma-style bars on monitor list and detail
  pages. Each tick represents one check interval. Green = up, red = down,
  gray = no data. Hover shows timestamp + status.
- **Auto-import + manual**: Monitors can be auto-created from crawl job URLs (a
  toggle in crawl job settings: "Monitor these URLs"). Also supports manually
  created monitors for ad-hoc endpoints. Both types appear in the same Monitors
  list.
- **Public status page**: Served at `/status/:slug` with no authentication.
  Anyone with the URL can view it. No custom domain support needed.

---

## Current State

SupaCrawl already has:
- Periodic sitemap crawling with broken/changed detection (`packages/core/crawler.ts`)
- Content hash diffing, SSL cert expiry checks, mojibake detection
- Per-URL status tracking in `url_state` table
- Notification system (Slack, Telegram, email, webhook) via `packages/core/notifier/`
- Dashboard with crawl history, status distribution, and charts (`packages/dashboard/`)

What it lacks:
- Continuous, interval-based heartbeat monitoring independent of sitemaps
- Real-time WebSocket push to the dashboard
- Uptime percentage calculation and response time graphs
- Public status page
- Maintenance windows

---

## Architecture

### Monorepo packages (existing)

| Package | Role |
|---------|------|
| `packages/core` | Shared types, storage, crawler, notifier |
| `packages/server` | Fastify HTTP server, auth, API routes |
| `packages/dashboard` | React (Vite) SPA |
| `packages/cli` | CLI entry point |

### New modules added to existing packages

```
packages/core/src/
  monitor.ts          -- monitor runner (checks a single URL on interval)
  monitor-scheduler.ts -- manages all active monitors
  types.ts            -- extended with Monitor, Heartbeat, StatusPage schemas

packages/server/src/routes/
  monitors.ts         -- CRUD + start/stop API routes
  status-pages.ts     -- public status page API

packages/dashboard/src/pages/
  Monitors.tsx        -- monitor list page
  MonitorDetail.tsx   -- heartbeat chart + response time graph
  StatusPage.tsx      -- public status page (unauthenticated)

packages/dashboard/src/components/
  HeartbeatBar.tsx    -- UptimeKuma-style bar chart (90 green/red ticks)
  ResponseTimeChart.tsx -- line chart of response times over time
```

---

## Database Schema Changes

All new tables are added via migration in `packages/core/src/storage.ts`.

### `monitors` table

```sql
CREATE TABLE IF NOT EXISTS monitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'http',   -- http | tcp | ping | dns
  url TEXT NOT NULL,                    -- target URL or host:port
  method TEXT DEFAULT 'GET',            -- HTTP method (http type only)
  expected_status INTEGER DEFAULT 200,
  expected_body TEXT,                   -- optional keyword check
  interval_seconds INTEGER NOT NULL DEFAULT 60,
  retry_count INTEGER NOT NULL DEFAULT 3,
  timeout_ms INTEGER NOT NULL DEFAULT 10000,
  accepted_response_time_ms INTEGER DEFAULT 5000,
  enabled INTEGER DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'manual', -- manual | crawl_job
  job_id TEXT REFERENCES crawl_jobs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### `heartbeats` table

```sql
CREATE TABLE IF NOT EXISTS heartbeats (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  status TEXT NOT NULL,         -- 'up' | 'down' | 'pending'
  response_time_ms INTEGER,
  message TEXT,                 -- error message if down
  checked_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_heartbeats_monitor ON heartbeats(monitor_id, checked_at DESC);
```

### `status_pages` table

```sql
CREATE TABLE IF NOT EXISTS status_pages (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,    -- URL slug: /status/:slug
  title TEXT NOT NULL,
  description TEXT,
  show_response_times INTEGER DEFAULT 1,
  public INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS status_page_monitors (
  status_page_id TEXT NOT NULL REFERENCES status_pages(id) ON DELETE CASCADE,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  PRIMARY KEY (status_page_id, monitor_id)
);
```

### `maintenance_windows` table

```sql
CREATE TABLE IF NOT EXISTS maintenance_windows (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

---

## Core Modules

### `packages/core/src/monitor.ts`

Single-monitor check function. Returns a `HeartbeatResult`:

```ts
interface HeartbeatResult {
  monitorId: string
  status: "up" | "down" | "pending"
  responseTimeMs: number | null
  message: string | null
  checkedAt: string
}
```

- **HTTP type**: fetch with `AbortController` timeout, check status code + optional
  body keyword match. Record response time.
- **TCP type**: `net.createConnection` with timeout. Record connect time.
- **Ping type**: shell out to `ping -c 1 -W <timeout>` (cross-platform via
  `child_process`). Parse RTT.
- **DNS type**: `dns.resolve` or `dns.resolve4`. Check that resolution succeeds.

### `packages/core/src/monitor-scheduler.ts`

Long-running service that:
1. On startup, loads all enabled monitors from DB
2. For each monitor, starts a `setInterval` at the monitor's configured interval
3. On each tick, calls `monitor.ts` and inserts the heartbeat into DB
4. On heartbeat DOWN: fires notifier (`onMonitorDown` event)
5. On recovery (DOWN -> UP): fires notifier (`onMonitorRecovery` event)
6. Checks `maintenance_windows` -- if current time is within a window, skip
   alerting
7. Exposes `startMonitor(id)` / `stopMonitor(id)` for runtime control
8. Exposes `getStats()` returning uptime % for all monitors

### Notifier extension

Add new events to existing `packages/core/notifier/index.ts`:

```
onMonitorDown      -- "Monitor 'X' is DOWN (reason)"
onMonitorRecovery  -- "Monitor 'X' is UP again"
onSslExpiring      -- (already exists)
```

These reuse the existing Slack / Telegram / email / webhook providers.

---

## Server Routes

### `packages/server/src/routes/monitors.ts`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/monitors` | List all monitors (with latest heartbeat status) |
| POST | `/api/monitors` | Create monitor |
| GET | `/api/monitors/:id` | Get monitor detail + stats |
| PUT | `/api/monitors/:id` | Update monitor |
| DELETE | `/api/monitors/:id` | Delete monitor |
| POST | `/api/monitors/:id/start` | Enable + start monitoring |
| POST | `/api/monitors/:id/stop` | Disable + stop monitoring |
| GET | `/api/monitors/:id/heartbeats` | Paginated heartbeats (last 24h / 7d / 30d) |
| GET | `/api/monitors/:id/uptime` | Uptime percentage (day/week/month/year) |

### `packages/server/src/routes/status-pages.ts`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status-pages` | List status pages (admin) |
| POST | `/api/status-pages` | Create status page (admin) |
| PUT | `/api/status-pages/:id` | Update (admin) |
| DELETE | `/api/status-pages/:id` | Delete (admin) |
| GET | `/status/:slug` | Public status page (no auth) |

---

## Dashboard Pages

### `/monitors` -- Monitor List

- Grid of monitor cards, each showing:
  - Name, URL, type badge
  - Current status (green dot / red dot)
  - Last response time
  - Uptime % for last 24h
  - 90-tick heartbeat bar (UptimeKuma style)
- "Add Monitor" button opens dialog

### `/monitors/:id` -- Monitor Detail

- Status badge (UP / DOWN / PENDING)
- 90-tick heartbeat bar (clickable, shows timestamp on hover)
- Response time line chart (recharts)
- Uptime % for: 24h, 7d, 30d, 365d
- Heartbeat log table (recent checks with status, time, message)
- Edit / Delete / Pause buttons

### `/status/:slug` -- Public Status Page (no auth required)

- Title + description
- Overall status badge (All Up / Degraded / Down)
- Per-monitor row: name, status dot, uptime %, response time
- Heartbeat bar per monitor (90 ticks)
- Uptime % summary at bottom
- Auto-refreshes via polling (every 30s)
- No authentication required -- anyone with the URL can view

---

## UI Components

### `HeartbeatBar.tsx`

90 tick marks (one per heartbeat interval, e.g., 24h = 90 ticks at ~16min each).
Each tick is green (up), red (down), or gray (no data). Hover shows timestamp
and status. No external charting library needed -- pure SVG/HTML.

### `ResponseTimeChart.tsx`

Line chart showing response times over the selected period. Uses `recharts`
(already in the project). Tooltip shows timestamp and ms value. Gray zone for
acceptable threshold, red zone for exceeding it.

---

## Integration with Existing Crawl System

The monitoring system is **independent** of the crawl system but shares the same
DB and notification infrastructure. Connections:

1. **Auto-import monitors from crawl jobs** -- Each `CrawlJob` gains a
   `monitorEnabled: boolean` field (default: false). When enabled, after each
   crawl completes, the orchestrator:
   - For each checked URL that returned 2xx, upserts a monitor with
     `source = 'crawl_job'` and `job_id = <crawl_job_id>`
   - Sets `interval_seconds` to match the crawl job's interval
   - Sets `enabled = 1` so the monitor scheduler picks it up
   - URLs that fail during crawl get monitors created with `enabled = 0`
     (user can enable manually)
   - Existing monitors (matched by URL) are updated, not duplicated
2. **Shared `url_state` table** -- monitors can optionally update `url_state` so
   the overview dashboard reflects real-time health alongside crawl data.
3. **Shared notifier** -- same Slack / Telegram / email / webhook config, new
   event types (`onMonitorDown`, `onMonitorRecovery`).
4. **Dashboard sidebar** -- new "Monitors" nav item alongside existing Crawl Jobs.
5. **Overview page** -- add a "Monitors" row showing active / down count.

---

## Implementation Phases

### Phase 1 -- Core + HTTP monitoring (MVP)

**Files to create/modify:**

| File | Action |
|------|--------|
| `packages/core/src/types.ts` | Add `Monitor`, `Heartbeat`, `StatusPage` Zod schemas; add `monitorEnabled` to `CrawlJobSchema` |
| `packages/core/src/storage.ts` | Add migration for 4 new tables + CRUD methods |
| `packages/core/src/monitor.ts` | New -- HTTP monitor check |
| `packages/core/src/monitor-scheduler.ts` | New -- scheduler loop |
| `packages/core/src/orchestrator.ts` | Add auto-import: after crawl, upsert monitors from checked URLs |
| `packages/core/src/notifier/index.ts` | Add `onMonitorDown`, `onMonitorRecovery` events |
| `packages/server/src/routes/monitors.ts` | New -- REST API for monitors |
| `packages/server/src/index.ts` | Mount monitor routes, start scheduler on boot |
| `packages/dashboard/src/components/HeartbeatBar.tsx` | New -- 90-tick heartbeat bar component |
| `packages/dashboard/src/components/ResponseTimeChart.tsx` | New -- response time chart |
| `packages/dashboard/src/pages/Monitors.tsx` | New -- monitor list page |
| `packages/dashboard/src/pages/MonitorDetail.tsx` | New -- monitor detail page |
| `packages/dashboard/src/components/AddMonitorDialog.tsx` | New -- create/edit dialog |
| `packages/dashboard/src/App.tsx` | Add `/monitors` and `/monitors/:id` routes |
| `packages/dashboard/src/lib/api.ts` | Add monitor API methods |
| `packages/dashboard/src/components/Sidebar.tsx` | Add "Monitors" nav item |
| `packages/dashboard/src/components/AddCrawlJobDialog.tsx` | Add "Monitor these URLs" toggle |

### Phase 2 -- Status page + TCP/Ping/DNS monitors

| File | Action |
|------|--------|
| `packages/core/src/monitor.ts` | Add TCP, Ping, DNS check types |
| `packages/server/src/routes/status-pages.ts` | New -- public status page API |
| `packages/dashboard/src/pages/StatusPage.tsx` | New -- public status page |
| `packages/dashboard/src/pages/StatusPages.tsx` | New -- admin list |
| `packages/dashboard/src/components/AddStatusPageDialog.tsx` | New |
| `packages/dashboard/src/App.tsx` | Add `/status/:slug` route (public) |

### Phase 3 -- Maintenance windows + polish

| File | Action |
|------|--------|
| `packages/core/src/types.ts` | Add `MaintenanceWindow` schema |
| `packages/core/src/storage.ts` | Add `maintenance_windows` table + CRUD |
| `packages/core/src/monitor-scheduler.ts` | Skip alerting during maintenance |
| `packages/dashboard/src/pages/MonitorDetail.tsx` | Add maintenance window management |
| `packages/dashboard/src/pages/Overview.tsx` | Add monitor health summary row |

---

## Key Dependencies

| Package | Used For | Already in project? |
|---------|----------|---------------------|
| `recharts` | Response time line chart | Yes (`packages/dashboard`) |
| `better-sqlite3` | DB (new tables) | Yes (`packages/core`) |
| `p-limit` | Concurrency control | Yes (`packages/core`) |
| `node:dns` | DNS monitor type | Node built-in |
| `node:net` | TCP monitor type | Node built-in |
| `node:child_process` | Ping monitor type | Node built-in |

No new external dependencies needed.

---

## Estimated Effort

| Phase | Scope | Est. Files Changed | Est. Effort |
|-------|-------|--------------------|-------------|
| Phase 1 | HTTP monitors + scheduler + auto-import + dashboard | ~17 | 3-4 days |
| Phase 2 | Status page + TCP/Ping/DNS monitors | ~8 | 1-2 days |
| Phase 3 | Maintenance windows + polish | ~5 | 1 day |
| **Total** | | **~20 unique files** | **5-7 days** |
