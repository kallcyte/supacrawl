use std::time::Duration;

use reqwest::{Client, StatusCode};
use url::Url;

use crate::ssrf::is_ssrf_safe;
use crawl_core::types::CheckMethod;

#[derive(Debug, Clone)]
pub struct FetchResult {
    pub status_code: u16,
    pub body: Option<Vec<u8>>,
    pub response_time_ms: u64,
    pub redirect_chain: Vec<String>,
    pub final_url: String,
    pub content_type: Option<String>,
    pub method: CheckMethod,
}

#[derive(Debug, Clone)]
pub struct FetchContext {
    pub client: Client,
    pub user_agent: String,
    pub timeout_ms: u64,
    pub max_body_bytes: usize,
}

impl FetchContext {
    pub fn new(
        user_agent: &str,
        timeout_ms: u64,
        max_body_bytes: usize,
    ) -> Result<Self, reqwest::Error> {
        let client = Client::builder()
            .user_agent(user_agent)
            .timeout(Duration::from_millis(timeout_ms))
            .redirect(reqwest::redirect::Policy::none())
            .gzip(true)
            .brotli(true)
            .build()?;

        Ok(Self {
            client,
            user_agent: user_agent.to_string(),
            timeout_ms,
            max_body_bytes,
        })
    }
}

pub async fn fetch_url(
    url: &Url,
    ctx: &FetchContext,
    force_get: bool,
) -> Result<FetchResult, String> {
    if !is_ssrf_safe(url) {
        return Err(format!("SSRF blocked: {}", url));
    }

    let start = tokio::time::Instant::now();

    let result = fetch_with_redirects(url, ctx, force_get, 5).await;
    let elapsed = start.elapsed().as_millis() as u64;

    match result {
        Ok((status, body, redirects, final_url, content_type, used_method)) => Ok(FetchResult {
            status_code: status.as_u16(),
            body,
            response_time_ms: elapsed,
            redirect_chain: redirects,
            final_url,
            content_type,
            method: used_method,
        }),
        Err(e) => Err(e),
    }
}

#[allow(clippy::too_many_arguments)]
async fn fetch_with_redirects(
    url: &Url,
    ctx: &FetchContext,
    force_get: bool,
    max_redirects: u8,
) -> Result<
    (
        StatusCode,
        Option<Vec<u8>>,
        Vec<String>,
        String,
        Option<String>,
        CheckMethod,
    ),
    String,
> {
    let mut current_url = url.clone();
    let mut redirects: Vec<String> = Vec::new();
    let mut remaining = max_redirects;

    loop {
        if remaining == 0 {
            return Err(format!("Too many redirects for {}", current_url));
        }

        let req = ctx.client.get(current_url.clone());

        let resp = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                if e.is_timeout() {
                    return Err(format!("Timeout: {}", current_url));
                }
                if e.is_connect() {
                    return Err(format!("Connection failed: {}", current_url));
                }
                return Err(format!("Request failed: {}: {}", current_url, e));
            }
        };

        let status = resp.status();
        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        if status.is_redirection() {
            if let Some(location) = resp.headers().get(reqwest::header::LOCATION) {
                if let Ok(location_str) = location.to_str() {
                    let new_url = match current_url.join(location_str) {
                        Ok(u) => u,
                        Err(_) => match Url::parse(location_str) {
                            Ok(u) => u,
                            Err(_) => {
                                return Err(format!(
                                    "Invalid redirect location: {}",
                                    location_str
                                ));
                            }
                        },
                    };

                    if redirects.contains(&new_url.to_string()) {
                        return Err(format!("Redirect loop detected: {}", new_url));
                    }

                    redirects.push(new_url.to_string());
                    current_url = new_url;
                    remaining -= 1;
                    continue;
                }
            }
        }

        let used_method = if force_get || !status.is_success() {
            CheckMethod::Get
        } else {
            CheckMethod::Head
        };

        let body = if force_get && status.is_success() {
            match read_body_capped(resp, ctx.max_body_bytes).await {
                Ok(b) => Some(b),
                Err(e) => return Err(e),
            }
        } else {
            None
        };

        return Ok((
            status,
            body,
            redirects,
            current_url.to_string(),
            content_type,
            used_method,
        ));
    }
}

async fn read_body_capped(
    resp: reqwest::Response,
    max_bytes: usize,
) -> Result<Vec<u8>, String> {
    let full = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => return Err(format!("Body read error: {}", e)),
    };

    if full.len() <= max_bytes {
        Ok(full.to_vec())
    } else {
        Ok(full[..max_bytes].to_vec())
    }
}
