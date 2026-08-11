# How Notifications work

Configure where alerts are sent when crawls and monitors detect issues. This page is
admin-only.

## Events

Turn on or off which events produce a notification:

- **Crawl failure** — a crawl run failed.
- **Content change detected** — a page's content changed between checks.
- **SSL certificate expiring** — a certificate is close to expiring.
- **Crawl completed** — a crawl run finished.
- **Mojibake (encoding issues)** — garbled, encoding-corrupted text was found.
- **LLM Garbage (AI artifacts)** — placeholder tokens, AI refusal text, or prompt leaks detected.
- **Crawl progress** — legacy toggle that no longer sends notifications; it's kept in the UI for compatibility but nothing is fired for it.
- **Monitor went down** — an uptime monitor failed its check.
- **Monitor recovered** — an uptime monitor is back up.

## Providers

Each provider card (Slack, Telegram, Email, Webhook) can be enabled with its own
credentials. When an event fires, it is sent through every enabled provider.

## Terminology

- **Mojibake** — garbled text caused by wrong character encoding.
- **LLM Garbage** — AI-generated placeholder text, refusal boilerplate, or leaked prompt fragments.
- **Webhook** — an HTTPS URL Supacrawl POSTs alert data to.
