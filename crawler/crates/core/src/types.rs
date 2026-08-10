use serde::{Deserialize, Deserializer, Serialize};
use url::Url;

fn deserialize_flexible_datetime<'de, D>(
    deserializer: D,
) -> Result<Option<chrono::DateTime<chrono::Utc>>, D::Error>
where
    D: Deserializer<'de>,
{
    let s: Option<String> = Option::deserialize(deserializer)?;
    match s {
        None => Ok(None),
        Some(raw) => {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&raw) {
                return Ok(Some(dt.with_timezone(&chrono::Utc)));
            }
            if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(&raw, "%Y-%m-%d %H:%M:%S") {
                return Ok(Some(chrono::DateTime::from_naive_utc_and_offset(
                    naive,
                    chrono::Utc,
                )));
            }
            Err(serde::de::Error::custom(format!(
                "invalid datetime: {raw}"
            )))
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrawlConfig {
    #[serde(default = "default_delay_ms")]
    pub delay_ms: u64,
    #[serde(default = "default_max_concurrency")]
    pub max_concurrency: usize,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default = "default_user_agent")]
    pub user_agent: String,
    #[serde(default = "default_true")]
    pub respect_robots_txt: bool,
    #[serde(default)]
    pub max_urls: Option<usize>,
    #[serde(default = "default_true")]
    pub retry_on_transient_error: bool,
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
    #[serde(default)]
    pub detect_mojibake: bool,
    #[serde(default)]
    pub detect_llm_garbage: bool,
    #[serde(default = "default_max_body_bytes")]
    pub max_body_bytes: usize,
    #[serde(default = "default_max_global_concurrency")]
    pub max_global_concurrency: usize,
}

fn default_delay_ms() -> u64 {
    2000
}
fn default_max_concurrency() -> usize {
    2
}
fn default_timeout_ms() -> u64 {
    30000
}
fn default_user_agent() -> String {
    "supacrawl/1.0".to_string()
}
fn default_true() -> bool {
    true
}
fn default_max_retries() -> u32 {
    3
}
fn default_max_body_bytes() -> usize {
    5 * 1024 * 1024
}
fn default_max_global_concurrency() -> usize {
    100
}

impl Default for CrawlConfig {
    fn default() -> Self {
        Self {
            delay_ms: default_delay_ms(),
            max_concurrency: default_max_concurrency(),
            timeout_ms: default_timeout_ms(),
            user_agent: default_user_agent(),
            respect_robots_txt: default_true(),
            max_urls: None,
            retry_on_transient_error: default_true(),
            max_retries: default_max_retries(),
            detect_mojibake: false,
            detect_llm_garbage: false,
            max_body_bytes: default_max_body_bytes(),
            max_global_concurrency: default_max_global_concurrency(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecksConfig {
    #[serde(default)]
    pub ssl: SslCheckConfig,
    #[serde(default)]
    pub content_diff: bool,
    #[serde(default)]
    pub response_time: ResponseTimeConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SslCheckConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_warn_days")]
    pub warn_days: u32,
}

fn default_warn_days() -> u32 {
    30
}

impl Default for SslCheckConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            warn_days: default_warn_days(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseTimeConfig {
    #[serde(default)]
    pub warn_ms: u64,
}

impl Default for ResponseTimeConfig {
    fn default() -> Self {
        Self { warn_ms: 3000 }
    }
}

impl Default for ChecksConfig {
    fn default() -> Self {
        Self {
            ssl: SslCheckConfig::default(),
            content_diff: false,
            response_time: ResponseTimeConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CrawlSource {
    #[serde(rename_all = "camelCase")]
    Url {
        url: String,
        name: Option<String>,
    },
    Full(CrawlSourceFull),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrawlSourceFull {
    pub url: String,
    pub name: Option<String>,
    pub interval: Option<CrawlInterval>,
    #[serde(rename = "runAt")]
    pub run_at: Option<String>,
    pub crawl: Option<CrawlConfig>,
    pub checks: Option<ChecksConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrawlInterval {
    pub value: u32,
    pub unit: IntervalUnit,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum IntervalUnit {
    Minutes,
    Hours,
    Days,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SitemapEntry {
    pub loc: String,
    pub lastmod: Option<String>,
    pub changefreq: Option<String>,
    pub priority: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckResult {
    pub url: String,
    pub status_code: Option<u16>,
    pub response_time_ms: Option<u64>,
    pub content_hash: Option<String>,
    pub content_changed: Option<bool>,
    pub error: Option<String>,
    pub redirect_chain: Vec<String>,
    pub ssl_info: Option<SslInfo>,
    pub sitemap_lastmod: Option<String>,
    pub check_method: CheckMethod,
    pub mojibake_score: Option<f64>,
    pub mojibake_flagged: Option<bool>,
    pub llm_garbage_score: Option<f64>,
    pub llm_garbage_flagged: Option<bool>,
    pub seo: Option<SeoInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seo_diff: Option<SeoDiff>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CheckMethod {
    Get,
    Head,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SslInfo {
    pub valid_until: String,
    pub valid_from: String,
    pub issuer: String,
    pub subject: String,
    pub days_remaining: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cipher_suite: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chain_depth: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tls_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeoInfo {
    pub title: Option<String>,
    pub title_length: Option<usize>,
    pub description: Option<String>,
    pub description_length: Option<usize>,
    pub og_title: Option<String>,
    pub og_description: Option<String>,
    pub og_image: Option<String>,
    pub canonical: Option<String>,
    pub canonical_self_reference: Option<bool>,
    pub noindex: bool,
    pub nofollow: bool,
    pub h1_count: usize,
    pub word_count: usize,
    pub jsonld_types: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeoDiff {
    pub changed: bool,
    pub title_changed: bool,
    pub description_changed: bool,
    pub og_title_changed: bool,
    pub og_description_changed: bool,
    pub og_image_changed: bool,
    pub canonical_changed: bool,
    pub noindex_changed: bool,
    pub nofollow_changed: bool,
    pub h1_count_before: usize,
    pub h1_count_after: usize,
    pub word_count_before: usize,
    pub word_count_after: usize,
    pub jsonld_types_added: Vec<String>,
    pub jsonld_types_removed: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrawlProgress {
    pub checked: usize,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnownHash {
    pub url: String,
    pub hash: String,
    #[serde(default)]
    pub has_seo: bool,
    #[serde(default, deserialize_with = "deserialize_flexible_datetime")]
    pub last_checked_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default)]
    pub sitemap_lastmod: Option<String>,
    #[serde(default)]
    pub prev_seo: Option<SeoInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartCrawlRequest {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub id: String,
    pub config: CrawlConfig,
    pub checks: ChecksConfig,
    pub sitemaps: Vec<String>,
    pub known_hashes: Vec<KnownHash>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
#[serde(rename_all = "lowercase")]
pub enum IpcMessage {
    Progress {
        #[serde(rename = "crawlId")]
        crawl_id: String,
        checked: usize,
        total: usize,
    },
    Result {
        #[serde(rename = "crawlId")]
        crawl_id: String,
        result: CheckResult,
    },
    Complete {
        #[serde(rename = "crawlId")]
        crawl_id: String,
        record: CrawlSummary,
    },
    Error {
        #[serde(rename = "crawlId")]
        crawl_id: String,
        error: String,
    },
    Backpressure {
        #[serde(rename = "crawlId")]
        crawl_id: String,
        #[serde(rename = "queueDepth")]
        queue_depth: usize,
        paused: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrawlSummary {
    pub crawl_id: String,
    pub total: usize,
    pub checked: usize,
    pub changed: usize,
    pub broken: usize,
    pub skipped: usize,
    pub ssl_expiring: Vec<String>,
    pub mojibake_flagged: Vec<String>,
    pub llm_garbage_flagged: Vec<String>,
    #[serde(default)]
    pub broken_urls: Vec<String>,
    #[serde(default)]
    pub changed_urls: Vec<String>,
    pub health_score: f64,
}

#[derive(Debug, Clone)]
pub struct RobotsData {
    pub sitemaps: Vec<Url>,
    pub crawl_delay: Option<u64>,
    pub allowed_rules: Vec<(String, String)>,
    pub disallowed_rules: Vec<(String, String)>,
}

impl RobotsData {
    pub fn is_allowed(&self, url: &Url) -> bool {
        let path = url.path();
        for (_, pattern) in &self.disallowed_rules {
            if matches_pattern(path, pattern) {
                return false;
            }
        }
        true
    }
}

fn matches_pattern(path: &str, pattern: &str) -> bool {
    if pattern.is_empty() || pattern == "/" {
        return path.starts_with('/');
    }
    let pattern = pattern.trim_end_matches('*');
    path.starts_with(&pattern) || (path == "/" && pattern == "/")
}

#[derive(Debug)]
pub struct HostDelay {
    pub last_request: std::time::Instant,
    pub delay_ms: u64,
}
