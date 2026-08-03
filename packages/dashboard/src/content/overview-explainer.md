# How the Overview works

The Overview is your at-a-glance summary of sitemap health and crawl activity. It
refreshes automatically every few seconds.

## Stat cards

- **Tracked URLs** — the number of unique URLs discovered across all your sitemaps.
- **Total Crawls** — how many crawl runs have happened, plus when the last one finished.
- **Broken Right Now** — URLs that currently return a 4xx or 5xx HTTP status (client or
  server error).
- **Last Crawl Issues** — a quick snapshot of the most recent crawl's broken and
  changed URL counts.

## Live progress

When a crawl is running you'll see a progress card with a progress bar, the number of
URLs checked so far, running tallies for **Broken / Changed / Skipped**, and the
current URL being checked. It updates in real time over a WebSocket.

## Charts

- **Healthy vs Broken** (last 30 days) — a stacked area chart showing how many URLs
  were healthy (green) versus broken (red) each day.
- **Crawl Duration** (last 30 runs) — a bar chart of how long each crawl took.

## Terminology

- **Crawl** — one run of a crawl job against your sitemap(s).
- **Broken** — a URL returning a 4xx or 5xx status code, or a connection error.
- **Changed** — a URL whose content differs from the previous check.
- **Sitemap** — the XML file that lists the pages of your site.
