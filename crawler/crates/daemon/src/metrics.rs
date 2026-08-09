use metrics::{counter, gauge, histogram};

pub fn install_metrics() {
    let _ = gauge!("crawl_daemon_active_crawls");
    let _ = counter!("crawl_daemon_crawls_total", "status" => "started");
    let _ = counter!("crawl_daemon_crawls_total", "status" => "completed");
    let _ = counter!("crawl_daemon_crawls_total", "status" => "failed");
    let _ = counter!("crawl_daemon_urls_checked_total", "status_code" => "2xx");
    let _ = counter!("crawl_daemon_urls_checked_total", "status_code" => "4xx");
    let _ = counter!("crawl_daemon_urls_checked_total", "status_code" => "5xx");
    let _ = histogram!("crawl_daemon_url_check_duration_seconds");
    let _ = histogram!("crawl_daemon_url_body_bytes");
    let _ = counter!("crawl_daemon_mojibake_detected_total");
    let _ = counter!("crawl_daemon_llm_garbage_detected_total");
    let _ = counter!("crawl_daemon_ssl_expiring_total");
    let _ = counter!("crawl_daemon_errors_total", "type" => "sitemap_parse");
    let _ = counter!("crawl_daemon_errors_total", "type" => "http");
    let _ = counter!("crawl_daemon_errors_total", "type" => "no_status");
}

pub fn inc_active_crawls() {
    gauge!("crawl_daemon_active_crawls").increment(1.0);
}

pub fn dec_active_crawls() {
    gauge!("crawl_daemon_active_crawls").decrement(1.0);
}

pub fn crawl_started() {
    counter!("crawl_daemon_crawls_total", "status" => "started").increment(1);
    inc_active_crawls();
}

pub fn crawl_completed() {
    counter!("crawl_daemon_crawls_total", "status" => "completed").increment(1);
    dec_active_crawls();
}

pub fn crawl_failed() {
    counter!("crawl_daemon_crawls_total", "status" => "failed").increment(1);
    dec_active_crawls();
}

pub fn url_checked(status_code: u16) {
    let label = if status_code < 200 {
        "1xx"
    } else if status_code < 300 {
        "2xx"
    } else if status_code < 400 {
        "3xx"
    } else if status_code < 500 {
        "4xx"
    } else {
        "5xx"
    };
    counter!("crawl_daemon_urls_checked_total", "status_code" => label).increment(1);
}

pub fn url_check_duration(ms: u64) {
    histogram!("crawl_daemon_url_check_duration_seconds").record(ms as f64 / 1000.0);
}

pub fn mojibake_detected() {
    counter!("crawl_daemon_mojibake_detected_total").increment(1);
}

pub fn llm_garbage_detected() {
    counter!("crawl_daemon_llm_garbage_detected_total").increment(1);
}

pub fn ssl_expiring() {
    counter!("crawl_daemon_ssl_expiring_total").increment(1);
}

pub fn sitemap_error() {
    counter!("crawl_daemon_errors_total", "type" => "sitemap_parse").increment(1);
}

#[allow(dead_code)]
pub fn body_bytes(bytes: usize) {
    histogram!("crawl_daemon_url_body_bytes").record(bytes as f64);
}

#[allow(dead_code)]
pub fn http_error() {
    counter!("crawl_daemon_errors_total", "type" => "http").increment(1);
}

pub fn no_status_error() {
    counter!("crawl_daemon_errors_total", "type" => "no_status").increment(1);
}
