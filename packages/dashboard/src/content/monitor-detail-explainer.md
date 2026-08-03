# How Monitor Detail works

This page shows everything about one uptime monitor: its current status, uptime over
time, and the history of every check it made. It refreshes automatically.

## Status

The header shows the monitor's name, a status badge (**UP / DOWN / PENDING**, or
**Paused** when disabled), and the target URL. Admins can pause/resume, edit, or delete
the monitor here.

## Uptime cards

**24h / 7d / 30d / 365d** — the percentage of checks in each trailing window that were
"up". For example, 99.9% means 99.9% of the checks in the last 7 days succeeded.

## Heartbeat bar

One colored cell per check over the last 90 checks: **green** = up, **red** = down,
**gray** = no data. Hover a cell to see that check's status, time, and response time.
A range toggle (24h / 7d / 30d) changes which period is shown below.

## Response time chart

A line chart of each check's response time. The dashed red line is your monitor's
**accepted response time** threshold — points above it are slow and drawn in the red
zone. Note that being slow does *not* mark the monitor down; only a failed check does.

## Heartbeat log

A table of every check in the selected period, newest first: status, response time,
the failure message (if any), and when the check ran.

## Terminology

- **Heartbeat** — one single monitoring check of the URL at a point in time.
- **Up** — the check returned the expected status (and body, if set).
- **Down** — the check failed after the configured retries.
- **Uptime** — the share of checks in a window that were up.
