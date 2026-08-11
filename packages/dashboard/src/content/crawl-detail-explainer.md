# How Crawl Detail works

This page shows the full results of a single crawl run. It refreshes automatically
while the crawl is running.

## Summary cards

- **Status** — whether the crawl is `pending`, `running`, `completed`, or `failed`,
  plus how long it took.
- **URLs Total** — how many URLs were checked.
- **4xx Errors / 5xx Errors** — broken URLs, split by client-side (4xx) and
  server-side (5xx) errors.
- **Redirects** — URLs that returned a 3xx redirect.
- **Content changes** — pages whose content differed from the previous check.
- **Mojibake** — pages with garbled, encoding-corrupted text.
- **LLM Garbage** — pages containing AI-generated artifacts (placeholder tokens, refusal messages, prompt leaks).

## Results tab

- A pie chart showing the spread of HTTP status buckets (1xx / 2xx / 3xx / 4xx / 5xx /
  error).
- A **URLs table** you can filter to All, 4xx, 5xx, Redirects, Changed, Mojibake, or LLM Garbage.
  Each row shows the URL, its status badge, the check method (GET / HEAD / skipped),
  and the response time in milliseconds.

## Report tab

A human-readable summary you can download as an Excel workbook (.xlsx):

- A big **Health %** score for the crawl.
- Tiles for **Broken, Changed, SSL Expiring, Mojibake, LLM Garbage**.
- **Performance** — average, fastest, and slowest response times.
- Issue lists for broken URLs, changed URLs, expiring SSL certificates, mojibake, and LLM garbage
  — or an **"All clear!"** panel when nothing was found.

## Terminology

- **4xx** — client errors (page not found, forbidden). **5xx** — server errors.
- **Redirect** — a URL that points to another URL (3xx).
- **Changed** — content hash differs from the previous run.
- **Mojibake** — garbled text caused by wrong character encoding.
- **LLM Garbage** — AI-generated placeholder tokens, refusal messages, or leaked prompt fragments in page content.
- **Health %** — the share of checked URLs that had no problems.
