# How monitors work

Supacrawl monitors run periodic uptime checks against a target URL.

## What Supacrawl sends to the page

Each check is a plain HTTP request:

- Method: `GET` by default (configurable)
- Header: `User-Agent: supacrawl-monitor/0.1`
- Redirects are followed automatically
- The request is aborted after the monitor's timeout (default 10s)

## What makes a monitor "up" or "down"

A check is only considered **up** when **all** of these pass:

1. **Status code** — the response status must equal the expected status (default `200`).
   A mismatch reports down with `HTTP <code> (expected 200)`.
2. **Expected body** (optional) — if set, the response text must contain that keyword,
   otherwise the check is down.
3. **No network errors** — timeouts, DNS failures, and connection errors all count as down.

The accepted response time (default 5s) is informational only — it marks the monitor as
*slow* in the UI, but it does **not** flip the status to down.

## Retries

Each check cycle retries up to the configured retry count (default 3) before declaring
the monitor down. It only reports **down** when every attempt fails.

## Heartbeats

Every check cycle writes one row to the heartbeats table containing:

- Status (`up` / `down`)
- Response time in milliseconds
- Message (the failure reason, or `null` when up)
- Timestamp of the check

## Scheduler

- Monitors tick on their configured interval (minimum 10 seconds).
- Overlapping checks are skipped if the previous one is still running.
- The scheduler starts on server boot and is also (re)started when a monitor is
  created, edited, enabled, or disabled.
- Notifications are only sent on **status transitions** (up → down or down → up),
  not on every failed check. Checks are suppressed while a maintenance window is active.

## How the dashboard gets the data

- **REST API** — the page loads monitors, latest status, recent heartbeats, and
  uptime percentages from the API endpoints.
- **WebSocket** — the server also broadcasts every heartbeat to connected clients,
  though the dashboard currently uses regular polling instead.

## Notifications

Status transitions can trigger `onMonitorDown` and `onMonitorRecovery` events,
delivered through the enabled providers (Slack, Telegram, Email, or a webhook).
