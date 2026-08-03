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
- **Crawl progress** — periodic updates during a crawl.
- **Monitor went down** — an uptime monitor failed its check.
- **Monitor recovered** — an uptime monitor is back up.

## Providers

Each provider card (Slack, Telegram, Email, Webhook) can be enabled with its own
credentials. When an event fires, it is sent through every enabled provider.

## Terminology

- **Mojibake** — garbled text caused by wrong character encoding.
- **Webhook** — an HTTPS URL Supacrawl POSTs alert data to.
