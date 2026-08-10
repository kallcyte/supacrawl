use crawl_core::types::{
    CheckMethod, CheckResult, KnownHash, SeoDiff, SeoInfo, SslInfo,
};
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::Mutex;
use tracing::info;

pub struct Storage {
    conn: Mutex<Connection>,
}

impl Storage {
    pub fn open(path: &Path) -> Result<Self, rusqlite::Error> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;")?;
        let storage = Self {
            conn: Mutex::new(conn),
        };
        storage.migrate()?;
        Ok(storage)
    }

    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().expect("storage lock poisoned")
    }

    fn migrate(&self) -> Result<(), rusqlite::Error> {
        self.conn().execute_batch(
            "
            CREATE TABLE IF NOT EXISTS crawls (
                id TEXT PRIMARY KEY,
                started_at TEXT NOT NULL DEFAULT (datetime('now')),
                finished_at TEXT,
                status TEXT NOT NULL DEFAULT 'running',
                urls_total INTEGER NOT NULL DEFAULT 0,
                urls_checked INTEGER NOT NULL DEFAULT 0,
                urls_changed INTEGER NOT NULL DEFAULT 0,
                urls_broken INTEGER NOT NULL DEFAULT 0,
                urls_skipped INTEGER NOT NULL DEFAULT 0,
                error_message TEXT,
                job_id TEXT
            );

            CREATE TABLE IF NOT EXISTS crawl_results (
                id TEXT PRIMARY KEY,
                crawl_id TEXT NOT NULL REFERENCES crawls(id),
                url TEXT NOT NULL,
                status_code INTEGER,
                response_time_ms REAL,
                content_hash TEXT,
                content_changed INTEGER DEFAULT 0,
                error TEXT,
                redirect_chain TEXT,
                ssl_valid_until TEXT,
                sitemap_lastmod TEXT,
                checked_at TEXT NOT NULL DEFAULT (datetime('now')),
                check_method TEXT,
                mojibake_score REAL,
                mojibake_flagged INTEGER DEFAULT 0,
                llm_garbage_score REAL,
                llm_garbage_flagged INTEGER DEFAULT 0,
                seo TEXT,
                seo_diff TEXT
            );

            CREATE TABLE IF NOT EXISTS url_state (
                url TEXT PRIMARY KEY,
                last_status_code INTEGER,
                last_content_hash TEXT,
                last_response_time_ms REAL,
                sitemap_lastmod TEXT,
                last_checked_at TEXT,
                consecutive_failures INTEGER NOT NULL DEFAULT 0,
                has_seo INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_crawl_results_crawl_id ON crawl_results(crawl_id);
            CREATE INDEX IF NOT EXISTS idx_url_state_url ON url_state(url);
            ",
        )?;

        if !self.has_column("url_state", "prev_seo")? {
            self.conn().execute("ALTER TABLE url_state ADD COLUMN prev_seo TEXT", [])?;
        }

        if !self.has_column("crawl_results", "seo_diff")? {
            self.conn().execute(
                "ALTER TABLE crawl_results ADD COLUMN seo_diff TEXT",
                [],
            )?;
        }

        info!("database migration complete");
        Ok(())
    }

    fn has_column(&self, table: &str, column: &str) -> Result<bool, rusqlite::Error> {
        let conn = self.conn();
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
        let exists = stmt.query_map([], |row| {
            let name: String = row.get(1)?;
            Ok(name)
        })?.any(|r| r == Ok(column.to_string()));
        Ok(exists)
    }

    pub fn create_crawl(&self, id: &str) -> Result<(), rusqlite::Error> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        // The server may already have recorded the crawl (with job_id) before
        // spawning this daemon; keep its row, ours would be a duplicate.
        self.conn().execute(
            "INSERT OR IGNORE INTO crawls (id, started_at, status) VALUES (?1, ?2, 'running')",
            params![id, now],
        )?;
        Ok(())
    }

    pub fn update_crawl_progress(
        &self,
        id: &str,
        checked: usize,
        total: usize,
    ) -> Result<(), rusqlite::Error> {
        self.conn().execute(
            "UPDATE crawls SET urls_checked = ?1, urls_total = ?2 WHERE id = ?3",
            params![checked, total, id],
        )?;
        Ok(())
    }

    pub fn complete_crawl(
        &self,
        id: &str,
        changed: usize,
        broken: usize,
        skipped: usize,
        checked: usize,
        total: usize,
    ) -> Result<(), rusqlite::Error> {
        self.conn().execute(
            "UPDATE crawls SET status = 'completed', urls_changed = ?1, urls_broken = ?2, urls_skipped = ?3, urls_checked = ?4, urls_total = ?5, finished_at = datetime('now') WHERE id = ?6",
            params![changed, broken, skipped, checked, total, id],
        )?;
        Ok(())
    }

    pub fn fail_crawl(&self, id: &str, error: &str) -> Result<(), rusqlite::Error> {
        self.conn().execute(
            "UPDATE crawls SET status = 'failed', error_message = ?1, finished_at = datetime('now') WHERE id = ?2",
            params![error, id],
        )?;
        Ok(())
    }

    pub fn insert_result(
        &self,
        crawl_id: &str,
        result: &CheckResult,
    ) -> Result<(), rusqlite::Error> {
        let seo_json = result
            .seo
            .as_ref()
            .and_then(|s| serde_json::to_string(s).ok());
        let seo_diff_json = result
            .seo_diff
            .as_ref()
            .and_then(|s| serde_json::to_string(s).ok());

        let checked_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let result_id = uuid::Uuid::new_v4().to_string();

        self.conn().execute(
            "INSERT INTO crawl_results (id, crawl_id, url, status_code, response_time_ms, content_hash, content_changed, error, redirect_chain, ssl_valid_until, sitemap_lastmod, checked_at, check_method, mojibake_score, mojibake_flagged, llm_garbage_score, llm_garbage_flagged, seo, seo_diff)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            params![
                result_id,
                crawl_id,
                result.url,
                result.status_code,
                result.response_time_ms.map(|v| v as f64),
                result.content_hash,
                result.content_changed.map(|v| v as i32),
                result.error,
                serde_json::to_string(&result.redirect_chain).ok(),
                result.ssl_info.as_ref().map(|s| &s.valid_until),
                result.sitemap_lastmod,
                checked_at,
                serde_json::to_string(&result.check_method).ok().map(|s| s.trim_matches('"').to_string()),
                result.mojibake_score,
                result.mojibake_flagged.map(|v| v as i32),
                result.llm_garbage_score,
                result.llm_garbage_flagged.map(|v| v as i32),
                seo_json,
                seo_diff_json,
            ],
        )?;
        Ok(())
    }

    pub fn upsert_url_state(&self, result: &CheckResult) -> Result<(), rusqlite::Error> {
        let failures = if result.status_code.map_or(true, |s| s >= 400) {
            1
        } else {
            0
        };

        let prev_seo_json = result
            .seo
            .as_ref()
            .and_then(|s| serde_json::to_string(s).ok());

        self.conn().execute(
            "INSERT INTO url_state (url, last_status_code, last_content_hash, last_response_time_ms, sitemap_lastmod, last_checked_at, consecutive_failures, has_seo, prev_seo)
             VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'), ?6, ?7, ?8)
             ON CONFLICT(url) DO UPDATE SET
                last_status_code = excluded.last_status_code,
                last_content_hash = excluded.last_content_hash,
                last_response_time_ms = excluded.last_response_time_ms,
                sitemap_lastmod = excluded.sitemap_lastmod,
                last_checked_at = excluded.last_checked_at,
                consecutive_failures = CASE WHEN excluded.last_status_code >= 400 THEN url_state.consecutive_failures + 1 ELSE 0 END,
                has_seo = CASE WHEN excluded.has_seo = 1 THEN 1 ELSE url_state.has_seo END,
                prev_seo = COALESCE(excluded.prev_seo, url_state.prev_seo)",
            params![
                result.url,
                result.status_code,
                result.content_hash,
                result.response_time_ms.map(|v| v as f64),
                result.sitemap_lastmod,
                failures,
                if result.seo.is_some() { 1 } else { 0 },
                prev_seo_json,
            ],
        )?;
        Ok(())
    }

    pub fn load_known_hashes(&self) -> Result<Vec<KnownHash>, rusqlite::Error> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT url, last_content_hash, has_seo, last_checked_at, sitemap_lastmod, prev_seo FROM url_state",
        )?;

        let rows = stmt.query_map([], |row| {
            let url: String = row.get(0)?;
            let hash: Option<String> = row.get(1)?;
            let hash = hash.unwrap_or_default();
            let has_seo: i32 = row.get(2)?;
            let last_checked: Option<String> = row.get(3)?;
            let sitemap_lastmod: Option<String> = row.get(4)?;
            let prev_seo_json: Option<String> = row.get(5)?;

            let prev_seo = prev_seo_json
                .and_then(|s| serde_json::from_str::<SeoInfo>(&s).ok());

            Ok(KnownHash {
                url,
                hash,
                has_seo: has_seo != 0,
                last_checked_at: last_checked
                    .and_then(|s| {
                        chrono::NaiveDateTime::parse_from_str(&s, "%Y-%m-%d %H:%M:%S").ok()
                    })
                    .map(|naive| {
                        chrono::DateTime::from_naive_utc_and_offset(naive, chrono::Utc)
                    }),
                sitemap_lastmod,
                prev_seo,
            })
        })?;

        let mut hashes = Vec::new();
        for row in rows {
            hashes.push(row?);
        }
        Ok(hashes)
    }

    pub fn get_previous_seo_for_url(
        &self,
        url: &str,
        before_crawl_id: &str,
    ) -> Result<Option<SeoInfo>, rusqlite::Error> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT cr.seo FROM crawl_results cr
             JOIN crawls c ON cr.crawl_id = c.id
             WHERE cr.url = ?1 AND cr.crawl_id != ?2 AND cr.seo IS NOT NULL
             ORDER BY c.finished_at DESC LIMIT 1",
        )?;

        let result = stmt.query_row(params![url, before_crawl_id], |row| {
            let seo_json: Option<String> = row.get(0)?;
            Ok(seo_json)
        });

        match result {
            Ok(Some(json)) => Ok(serde_json::from_str(&json).ok()),
            Ok(None) => Ok(None),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn load_latest_results_for_crawl(
        &self,
        crawl_id: &str,
    ) -> Result<Vec<CheckResult>, rusqlite::Error> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT url, status_code, response_time_ms, content_hash, content_changed, error, redirect_chain, ssl_valid_until, sitemap_lastmod, check_method, mojibake_score, mojibake_flagged, llm_garbage_score, llm_garbage_flagged, seo, seo_diff
             FROM crawl_results WHERE crawl_id = ?1",
        )?;

        let rows = stmt.query_map(params![crawl_id], |row| {
            let url: String = row.get(0)?;
            let status_code: Option<u16> = row.get(1)?;
            let response_time_ms: Option<f64> = row.get(2)?;
            let content_hash: Option<String> = row.get(3)?;
            let content_changed_int: Option<i32> = row.get(4)?;
            let error: Option<String> = row.get(5)?;
            let redirect_chain_json: Option<String> = row.get(6)?;
            let ssl_valid_until: Option<String> = row.get(7)?;
            let sitemap_lastmod: Option<String> = row.get(8)?;
            let check_method_str: Option<String> = row.get(9)?;
            let mojibake_score: Option<f64> = row.get(10)?;
            let mojibake_flagged_int: Option<i32> = row.get(11)?;
            let llm_garbage_score: Option<f64> = row.get(12)?;
            let llm_garbage_flagged_int: Option<i32> = row.get(13)?;
            let seo_json: Option<String> = row.get(14)?;
            let seo_diff_json: Option<String> = row.get(15)?;

            let redirect_chain: Vec<String> = redirect_chain_json
                .and_then(|j| serde_json::from_str(&j).ok())
                .unwrap_or_default();

            let check_method = check_method_str
                .and_then(|s| {
                    if s == "get" {
                        Some(CheckMethod::Get)
                    } else {
                        Some(CheckMethod::Head)
                    }
                })
                .unwrap_or(CheckMethod::Get);

            let ssl_info = ssl_valid_until.map(|until| SslInfo {
                valid_until: until,
                valid_from: String::new(),
                issuer: String::new(),
                subject: String::new(),
                days_remaining: 0,
                cipher_suite: None,
                chain_depth: None,
                tls_version: None,
            });

            let seo: Option<SeoInfo> = seo_json.and_then(|j| serde_json::from_str(&j).ok());
            let seo_diff: Option<SeoDiff> =
                seo_diff_json.and_then(|j| serde_json::from_str(&j).ok());

            Ok(CheckResult {
                url,
                status_code,
                response_time_ms: response_time_ms.map(|v| v as u64),
                content_hash,
                content_changed: content_changed_int.map(|v| v != 0),
                error,
                redirect_chain,
                ssl_info,
                sitemap_lastmod,
                check_method,
                mojibake_score,
                mojibake_flagged: mojibake_flagged_int.map(|v| v != 0),
                llm_garbage_score,
                llm_garbage_flagged: llm_garbage_flagged_int.map(|v| v != 0),
                seo,
                seo_diff,
            })
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }
}
