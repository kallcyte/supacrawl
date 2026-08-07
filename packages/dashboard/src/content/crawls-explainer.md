# How Crawl Jobs work

Crawl jobs are scheduled runs that download your sitemap(s) and check every URL for
broken links, content changes, SSL expiry, and garbled text. The page lists all your
jobs and refreshes automatically.

## Job card

Each card shows:

- **Name** with a **Run on Schedule** badge (or **Not Scheduled**) indicating whether the
  job runs automatically on its schedule. A job that has never been run shows the hint
  *"Run once to start scheduling"*.
- **Running** badge while a crawl is in progress.
- **Last run status** — `completed` or `failed`.
- A subtitle with the sitemap URL, the schedule (`Every 2 days at 14:00`), the next
  run time, and the last run time.

## Actions

- **Play** — start a crawl right now (opens the crawl detail page).
- **Stop** — stop a running crawl.
- **History** — expand to see past runs with started time, status, checked and broken
  counts.
- **Edit / Delete** (admin) — change the job or remove it permanently along with all
  its crawl history.
- **Export / Import** — download your jobs as JSON or upload them back.

## Creating a job

- **URL (site or sitemap)** — enter your site URL and use **Discover** to auto-detect
  sitemaps from `robots.txt` and common locations, then pick which ones to include.
- **Max URLs per crawl** — the total URL budget; URLs across selected sitemaps are
  deduplicated.
- **Run in schedule** — turns the automatic schedule on or off.
- **Schedule** — a preset (every 15/30 minutes, 1/2/6/12 hours, day, 2 days, week) or a
  custom interval, plus an optional time of day for daily-style schedules.
- **Notifications** — toggles for failure, content change, and completion.
- **Mojibake detection** — whether to look for garbled encoding-corrupted text and
  notify when found.
- **LLM Garbage detection** — whether to look for AI-generated artifacts (placeholder
  tokens, refusal text, prompt leaks) and notify when found.

## Terminology

- **Job** — the saved configuration. **Crawl** — one execution of that job.
- **Sitemap** — the XML file listing your site's pages.
