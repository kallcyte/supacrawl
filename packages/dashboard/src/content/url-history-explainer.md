# How URL History works

Inspect how a single URL has changed across all of its checks. Type a URL (or pick one
from the recent list) to see its full history.

## Summary cards

- **Status** — the HTTP status code from the most recent check. 2xx = healthy,
  3xx = redirect, 4xx/5xx = broken.
- **Response Time** — the latest response time plus the average across all checks.
- **Failure Rate** — the percentage of checks that returned a 4xx/5xx or a connection
  error. Lower is better.
- **Content Changes** — the percentage of checks where the page content hash differed
  from the previous check, meaning the page was updated.
- **Check Frequency** — how often this URL is checked per day.
- **SSL** — days until the TLS/SSL certificate expires, or N/A when there is none or
  the URL uses plain HTTP.

## SEO snapshot

A capture of the page's SEO metadata for the latest check: title, meta description,
canonical URL, indexing directives (`noindex` / `nofollow`), headings, published date,
Open Graph tags, word count, page weight, and schema types. A **Potential issues** list
flags problems such as a missing `<title>` or a canonical that points elsewhere.

## Charts and history

- **Response time** line chart — how fast the URL responded over time.
- **Crawl history** table — every check with status, method, time, error details,
  redirect hops, mojibake percentage, SSL days, and SEO change badges.

## Terminology

- **Content hash** — a fingerprint of the page content; a different hash means the
  page changed.
- **Redirect hops** — how many redirects a URL went through before responding.
- **Mojibake** — garbled, encoding-corrupted text.
