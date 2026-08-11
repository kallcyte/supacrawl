-- Migration 0001: Initial schema for SupaCrawl D1

CREATE TABLE IF NOT EXISTS crawls (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  urls_total INTEGER DEFAULT 0,
  urls_checked INTEGER DEFAULT 0,
  urls_changed INTEGER DEFAULT 0,
  urls_broken INTEGER DEFAULT 0,
  urls_skipped INTEGER DEFAULT 0,
  error_message TEXT,
  job_id TEXT REFERENCES crawl_jobs(id)
);

CREATE TABLE IF NOT EXISTS crawl_results (
  id TEXT PRIMARY KEY,
  crawl_id TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  status_code INTEGER,
  response_time_ms INTEGER,
  content_hash TEXT,
  content_changed INTEGER DEFAULT 0,
  error TEXT,
  redirect_chain TEXT,
  ssl_valid_until TEXT,
  sitemap_lastmod TEXT,
  checked_at TEXT NOT NULL,
  check_method TEXT NOT NULL,
  mojibake_score REAL,
  mojibake_flagged INTEGER DEFAULT 0,
  llm_garbage_score REAL,
  llm_garbage_flagged INTEGER DEFAULT 0
  -- seo column intentionally removed; see crawl_results_seo
);

CREATE INDEX IF NOT EXISTS idx_results_crawl ON crawl_results(crawl_id);
CREATE INDEX IF NOT EXISTS idx_results_url ON crawl_results(url);
CREATE INDEX IF NOT EXISTS idx_results_status ON crawl_results(status_code);

-- SEO data split out to avoid hitting D1's 100KB row limit
CREATE TABLE IF NOT EXISTS crawl_results_seo (
  result_id TEXT PRIMARY KEY REFERENCES crawl_results(id) ON DELETE CASCADE,
  title TEXT,
  title_length INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  description_length INTEGER NOT NULL DEFAULT 0,
  canonical TEXT,
  canonical_self_reference INTEGER,
  noindex INTEGER NOT NULL DEFAULT 0,
  nofollow INTEGER NOT NULL DEFAULT 0,
  h1_count INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER NOT NULL DEFAULT 0,
  page_weight_bytes INTEGER NOT NULL DEFAULT 0,
  json_ld_types TEXT,
  og_title TEXT,
  og_description TEXT,
  og_image TEXT,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS crawl_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sitemap_url TEXT NOT NULL,
  sitemap_urls TEXT,
  enabled INTEGER DEFAULT 1,
  interval_value INTEGER NOT NULL,
  interval_unit TEXT NOT NULL DEFAULT 'minutes',
  run_at TEXT,
  notify_on_complete INTEGER DEFAULT 0,
  notify_on_failure INTEGER DEFAULT 1,
  notify_on_change INTEGER DEFAULT 1,
  notify_on_mojibake INTEGER DEFAULT 0,
  notify_on_llm_garbage INTEGER DEFAULT 0,
  notify_ssl_expiring INTEGER DEFAULT 1,
  notify_on_progress INTEGER DEFAULT 0,
  detect_mojibake INTEGER DEFAULT 1,
  detect_llm_garbage INTEGER DEFAULT 1,
  delay_ms INTEGER NOT NULL,
  max_concurrency INTEGER NOT NULL,
  timeout_ms INTEGER NOT NULL,
  user_agent TEXT NOT NULL,
  respect_robots_txt INTEGER DEFAULT 1,
  max_urls INTEGER NOT NULL,
  max_body_bytes INTEGER DEFAULT 5242880,
  notification_providers TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_run_at TEXT,
  last_run_status TEXT
);

CREATE TABLE IF NOT EXISTS url_state (
  url TEXT PRIMARY KEY,
  last_status_code INTEGER,
  last_content_hash TEXT,
  last_response_time_ms INTEGER,
  sitemap_lastmod TEXT,
  last_checked_at TEXT NOT NULL,
  consecutive_failures INTEGER DEFAULT 0,
  has_seo INTEGER DEFAULT 0,
  prev_seo TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS monitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'http',
  url TEXT NOT NULL,
  method TEXT DEFAULT 'GET',
  expected_status INTEGER DEFAULT 200,
  expected_body TEXT,
  interval_seconds INTEGER NOT NULL DEFAULT 60,
  retry_count INTEGER NOT NULL DEFAULT 3,
  timeout_ms INTEGER NOT NULL DEFAULT 10000,
  accepted_response_time_ms INTEGER DEFAULT 5000,
  enabled INTEGER DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'manual',
  job_id TEXT REFERENCES crawl_jobs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS heartbeats (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  response_time_ms INTEGER,
  message TEXT,
  checked_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_heartbeats_monitor ON heartbeats(monitor_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS status_pages (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  show_response_times INTEGER DEFAULT 1,
  public INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS status_page_monitors (
  status_page_id TEXT NOT NULL REFERENCES status_pages(id) ON DELETE CASCADE,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  PRIMARY KEY (status_page_id, monitor_id)
);

CREATE TABLE IF NOT EXISTS maintenance_windows (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- resource_snapshots are dropped in CF (Node-specific, irrelevant in Workers);
-- kept as an empty table placeholder if the dashboard queries the name.
-- User notification settings (Phase 4: email dropped, teams added later)

CREATE TABLE IF NOT EXISTS user_notification_settings (
  user_id TEXT PRIMARY KEY,
  slack TEXT NOT NULL DEFAULT '{}',
  telegram TEXT NOT NULL DEFAULT '{}',
  email TEXT NOT NULL DEFAULT '{}',
  webhook TEXT NOT NULL DEFAULT '{}',
  teams TEXT NOT NULL DEFAULT '{}',
  enabled_events TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

-- Custom password-reset tokens (Workers — no node:crypto scrypt)
CREATE TABLE IF NOT EXISTS password_reset_token (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- better-auth core tables (Workers/D1 adapter)
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  expiresAt TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt TEXT,
  refreshTokenExpiresAt TEXT,
  scope TEXT,
  password TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT,
  updatedAt TEXT
);
