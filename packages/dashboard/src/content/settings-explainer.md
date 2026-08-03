# How Settings works

Your personal notification preferences and, for admins, the global server settings.

## My notification preferences

Choose which events notify you (crawl failure, content change, SSL expiring, crawl
completed, mojibake, crawl progress, monitor down, monitor recovered). Alerts are sent
through the channels an admin has configured (Slack, Telegram, Email, Webhook) — you'll
see which ones are available here. If none are enabled, ask an admin to set them up.

## Browser push

Turn on browser push notifications to get notified when a crawl completes, even when
you're on another tab. Your browser will ask for permission the first time.

## Admin settings

Only visible to admins:

- **User registration** — whether new users can sign up. When on, a "Create account"
  link appears on the sign-in page.
- **Crawler** — request delay (DDoS-safe), concurrency, timeout, user agent, robots.txt
  respect, and transient-error retries. The editable field is **Max URLs per crawl**.
- **Checks** — content diff on/off, response-time warning threshold, and SSL
  monitoring with its warning window.
- **Schedule** — the internal cron/interval string the server uses.

## Terminology

- **robots.txt** — the site's file that tells crawlers which paths are allowed.
- **Mojibake** — garbled, encoding-corrupted text.
- **SSL expiry** — the date a site's TLS certificate stops being valid.
