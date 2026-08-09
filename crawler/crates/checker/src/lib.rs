pub mod llm_garbage;
pub mod mojibake;
pub mod seo;
pub mod seo_diff;

use crawl_core::types::{CheckMethod, CheckResult, KnownHash, SeoInfo, SeoDiff};
use crawl_fetcher::fetch_url;
use crawl_fetcher::FetchContext;
use sha2::{Digest, Sha256};
use url::Url;

use crate::llm_garbage::detect_llm_garbage;
use crate::mojibake::detect_mojibake;
use crate::seo::extract_seo_info;
use crate::seo_diff::diff_seo;

pub struct CheckContext {
    pub fetcher: FetchContext,
}

impl CheckContext {
    pub fn new(fetcher: FetchContext) -> Self {
        Self { fetcher }
    }

    pub async fn check_url(
        &self,
        url: &Url,
        known: Option<&KnownHash>,
    ) -> CheckResult {
        let force_get = should_force_get(known);
        let fetch_result = match fetch_url(url, &self.fetcher, force_get).await {
            Ok(r) => Some(r),
            Err(err) => {
                return CheckResult {
                    url: url.to_string(),
                    status_code: None,
                    response_time_ms: None,
                    content_hash: None,
                    content_changed: None,
                    error: Some(err),
                    redirect_chain: vec![],
                    ssl_info: None,
                    sitemap_lastmod: known.and_then(|k| k.sitemap_lastmod.clone()),
                    check_method: CheckMethod::Get,
                    mojibake_score: None,
                    mojibake_flagged: None,
                    llm_garbage_score: None,
                    llm_garbage_flagged: None,
                    seo: None,
                    seo_diff: None,
                };
            }
        };

        let fetch_result = fetch_result.unwrap();
        let status_code = Some(fetch_result.status_code);

        let content_hash = fetch_result.body.as_ref().map(|b| {
            let mut hasher = Sha256::new();
            hasher.update(b);
            format!("{:x}", hasher.finalize())
        });

        let content_changed = match (&content_hash, known) {
            (Some(hash), Some(known_hash)) if !known_hash.hash.is_empty() => {
                Some(hash != &known_hash.hash)
            }
            _ => None,
        };

        let mut seo: Option<SeoInfo> = None;
        let mut mojibake_score: Option<f64> = None;
        let mut mojibake_flagged: Option<bool> = None;
        let mut llm_garbage_score: Option<f64> = None;
        let mut llm_garbage_flagged: Option<bool> = None;
        let mut seo_diff: Option<SeoDiff> = None;

        if let Some(body) = &fetch_result.body {
            if let Ok(text) = String::from_utf8(body.clone()) {
                seo = extract_seo_info(&text, &fetch_result.final_url, body.len());

                if let (Some(prev), Some(ref curr)) = (
                    known.and_then(|k| k.prev_seo.as_ref()),
                    &seo,
                ) {
                    seo_diff = Some(diff_seo(prev, curr));
                }

                let (m_score, m_flagged) = detect_mojibake(body);
                mojibake_score = Some(m_score);
                mojibake_flagged = Some(m_flagged);

                let (l_score, l_flagged) = detect_llm_garbage(&text);
                llm_garbage_score = Some(l_score);
                llm_garbage_flagged = Some(l_flagged);
            }
        }

        let ssl_info = if url.scheme() == "https" {
            let host = url.host_str().unwrap_or("");
            let port = url.port().unwrap_or(443);
            crawl_fetcher::ssl::check_ssl(host, port, self.fetcher.timeout_ms).await
        } else {
            None
        };

        CheckResult {
            url: url.to_string(),
            status_code,
            response_time_ms: Some(fetch_result.response_time_ms),
            content_hash,
            content_changed,
            error: None,
            redirect_chain: fetch_result.redirect_chain,
            ssl_info,
            sitemap_lastmod: known.and_then(|k| k.sitemap_lastmod.clone()),
            check_method: fetch_result.method,
            mojibake_score,
            mojibake_flagged,
            llm_garbage_score,
            llm_garbage_flagged,
            seo,
            seo_diff,
        }
    }
}

fn should_force_get(known: Option<&KnownHash>) -> bool {
    match known {
        None => true,
        Some(k) if k.hash.is_empty() => true,
        Some(k) => !k.has_seo,
    }
}
