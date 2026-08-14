# SEO Checker

Paste a URL (or pick one from your crawl history) to see how search engines and
social networks would display it, plus an actionable SEO score.

## Search preview

A Google-style organic result built from your `<title>`, meta description and
canonical URL. Titles over ~60 characters and descriptions over ~160 characters
get truncated — the checker flags them so you can tighten them up.

## Social previews

Mock previews for Facebook, X (Twitter), LinkedIn, WhatsApp, Slack, Discord
and Telegram. They rely on **Open Graph** (`og:title`,
`og:description`, `og:image`) and **Twitter Card** tags. Where those are
missing, platforms fall back to the `<title>` and meta description — the
previews show what that looks like.

## SEO score

A weighted, Lighthouse-style score from 0 to 100 across five categories:

| Category | Weight | What it checks |
|---|---|---|
| Content & meta | 30% | Title, meta description, H1, word count |
| Technical | 25% | Canonical, robots, viewport, charset, language, HTTPS, alt text |
| Social | 20% | Open Graph and Twitter Card tags |
| Structured data | 10% | JSON-LD presence and types |
| Performance | 15% | Response time, gzipped payload, HTML weight |

Each check produces a pass/warn/fail audit with a concrete recommendation.

## Page weight

Reports the raw HTML size, the gzipped transfer size, word count, image/link
counts and images missing alt text — useful for lightweight-page audits before
going further with a full Lighthouse run.

## Notes

- The URL is fetched server-side with a 2 MB body cap. Very large or
  non-HTML responses show a warning instead of a full analysis.
- Scores are advisory, not a guarantee of ranking.
