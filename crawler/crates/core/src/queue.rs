use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;
use url::Url;

use crate::types::HostDelay;

#[derive(Debug, Clone)]
pub struct UrlQueue {
    inner: VecDeque<Url>,
    seen: HashMap<String, String>,
    max_urls: Option<usize>,
    _bounded: bool,
}

impl UrlQueue {
    pub fn new(max_urls: Option<usize>) -> Self {
        Self {
            inner: VecDeque::new(),
            seen: HashMap::new(),
            max_urls,
            _bounded: true,
        }
    }

    pub fn len(&self) -> usize {
        self.inner.len()
    }

    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    pub fn push(&mut self, url: Url, lastmod: Option<String>) {
        if let Some(max) = self.max_urls {
            if self.inner.len() >= max {
                return;
            }
        }
        let key = url.to_string();
        if self.seen.contains_key(&key) {
            return;
        }
        self.inner.push_back(url.clone());
        self.seen
            .insert(key.clone(), lastmod.unwrap_or_else(|| key));
    }

    pub fn pop(&mut self) -> Option<(Url, Option<String>)> {
        self.inner.pop_front().map(|url| {
            let lastmod = self.seen.get(url.as_str()).cloned();
            let has_lastmod = lastmod.as_ref().map_or(false, |l| l != url.as_str());
            (url, if has_lastmod { lastmod } else { None })
        })
    }
}

pub struct RateLimiter {
    host_delays: HashMap<String, HostDelay>,
    host_semaphores: HashMap<String, Arc<Semaphore>>,
    global_semaphore: Arc<Semaphore>,
    delay_ms: u64,
    max_concurrency: usize,
}

impl RateLimiter {
    pub fn new(
        max_concurrency: usize,
        delay_ms: u64,
        max_global_concurrency: usize,
    ) -> Self {
        Self {
            host_delays: HashMap::new(),
            host_semaphores: HashMap::new(),
            global_semaphore: Arc::new(Semaphore::new(max_global_concurrency)),
            delay_ms,
            max_concurrency,
        }
    }

    pub fn host_concurrency(&self) -> usize {
        self.max_concurrency
    }

    pub fn global_semaphore(&self) -> Arc<Semaphore> {
        self.global_semaphore.clone()
    }

    pub async fn acquire_host(&mut self, host: &str) {
        let sem = self
            .host_semaphores
            .entry(host.to_string())
            .or_insert_with(|| Arc::new(Semaphore::new(self.max_concurrency)));
        let permit = sem.clone().acquire_owned().await;
        tokio::spawn(async move {
            let _permit = permit;
        });
        let now = Instant::now();
        if let Some(delay) = self.host_delays.get(host) {
            let elapsed = now.duration_since(delay.last_request);
            let min_delay = Duration::from_millis(delay.delay_ms);
            if elapsed < min_delay {
                tokio::time::sleep(min_delay - elapsed).await;
            }
        }
    }

    pub fn record_request(&mut self, host: &str, robot_delay: Option<u64>) {
        let delay = robot_delay.unwrap_or(self.delay_ms).max(self.delay_ms);
        self.host_delays.insert(
            host.to_string(),
            HostDelay {
                last_request: Instant::now(),
                delay_ms: delay,
            },
        );
    }
}
