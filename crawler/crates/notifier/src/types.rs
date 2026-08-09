use crawl_core::types::CrawlSummary;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPayload {
    pub event: NotificationEvent,
    pub title: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crawl_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report_stats: Option<ReportStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report_urls: Option<ReportUrls>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub html_body: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum NotificationEvent {
    OnCrawlFailure,
    OnContentChange,
    OnSslExpiring,
    OnCrawlComplete,
    OnMojibakeDetected,
    OnLlmGarbageDetected,
    OnCrawlProgress,
}

impl NotificationEvent {
    pub fn as_str(&self) -> &'static str {
        match self {
            NotificationEvent::OnCrawlFailure => "onCrawlFailure",
            NotificationEvent::OnContentChange => "onContentChange",
            NotificationEvent::OnSslExpiring => "onSslExpiring",
            NotificationEvent::OnCrawlComplete => "onCrawlComplete",
            NotificationEvent::OnMojibakeDetected => "onMojibakeDetected",
            NotificationEvent::OnLlmGarbageDetected => "onLlmGarbageDetected",
            NotificationEvent::OnCrawlProgress => "onCrawlProgress",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportStats {
    pub health_score: f64,
    pub total_found: usize,
    pub total_checked: usize,
    pub broken_count: usize,
    pub changed_count: usize,
    pub ssl_count: usize,
    pub mojibake_count: usize,
    pub llm_garbage_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avg_response_time_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fastest_response_time_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slowest_response_time_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportUrls {
    pub broken: Vec<UrlDetail>,
    pub changed: Vec<UrlDetail>,
    pub ssl_expiring: Vec<UrlDetail>,
    pub mojibake: Vec<UrlDetail>,
    pub llm_garbage: Vec<UrlDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UrlDetail {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationsConfig {
    pub providers: ProviderConfigs,
    pub events: EventConfig,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfigs {
    pub slack: SlackConfig,
    pub telegram: TelegramConfig,
    pub email: EmailConfig,
    pub webhook: WebhookConfig,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlackConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_url: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bot_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chat_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailConfig {
    #[serde(default)]
    pub enabled: bool,
    pub smtp: Option<SmtpConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub to: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmtpConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(default)]
    pub secure: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pass: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secret: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventConfig {
    #[serde(rename = "onCrawlFailure")]
    pub on_crawl_failure: bool,
    #[serde(rename = "onContentChange")]
    pub on_content_change: bool,
    #[serde(rename = "onSslExpiring")]
    pub on_ssl_expiring: bool,
    #[serde(rename = "onCrawlComplete")]
    pub on_crawl_complete: bool,
    #[serde(rename = "onMojibakeDetected")]
    pub on_mojibake_detected: bool,
    #[serde(rename = "onLlmGarbageDetected")]
    pub on_llm_garbage_detected: bool,
    #[serde(rename = "onCrawlProgress")]
    pub on_crawl_progress: bool,
}

impl Default for NotificationsConfig {
    fn default() -> Self {
        Self {
            providers: ProviderConfigs::default(),
            events: EventConfig::default(),
        }
    }
}

impl Default for EventConfig {
    fn default() -> Self {
        Self {
            on_crawl_failure: true,
            on_content_change: true,
            on_ssl_expiring: true,
            on_crawl_complete: true,
            on_mojibake_detected: true,
            on_llm_garbage_detected: true,
            on_crawl_progress: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum NotifierEvent {
    #[serde(rename = "onCrawlFailure")]
    OnCrawlFailure,
    #[serde(rename = "onContentChange")]
    OnContentChange,
    #[serde(rename = "onSslExpiring")]
    OnSslExpiring,
    #[serde(rename = "onCrawlComplete")]
    OnCrawlComplete,
    #[serde(rename = "onMojibakeDetected")]
    OnMojibakeDetected,
    #[serde(rename = "onLlmGarbageDetected")]
    OnLlmGarbageDetected,
    #[serde(rename = "onCrawlProgress")]
    OnCrawlProgress,
}

impl NotificationPayload {
    pub fn from_crawl_summary(
        event: NotificationEvent,
        title: &str,
        summary: &CrawlSummary,
    ) -> Self {
        let report_stats = ReportStats {
            health_score: summary.health_score,
            total_found: summary.total,
            total_checked: summary.checked,
            broken_count: summary.broken,
            changed_count: summary.changed,
            ssl_count: summary.ssl_expiring.len(),
            mojibake_count: summary.mojibake_flagged.len(),
            llm_garbage_count: summary.llm_garbage_flagged.len(),
            avg_response_time_ms: None,
            fastest_response_time_ms: None,
            slowest_response_time_ms: None,
        };

        let report_urls = ReportUrls {
            broken: summary
                .broken_urls
                .iter()
                .map(|u| UrlDetail {
                    url: u.clone(),
                    detail: None,
                })
                .collect(),
            changed: summary
                .changed_urls
                .iter()
                .map(|u| UrlDetail {
                    url: u.clone(),
                    detail: None,
                })
                .collect(),
            ssl_expiring: summary
                .ssl_expiring
                .iter()
                .map(|u| UrlDetail {
                    url: u.clone(),
                    detail: None,
                })
                .collect(),
            mojibake: summary
                .mojibake_flagged
                .iter()
                .map(|u| UrlDetail {
                    url: u.clone(),
                    detail: None,
                })
                .collect(),
            llm_garbage: summary
                .llm_garbage_flagged
                .iter()
                .map(|u| UrlDetail {
                    url: u.clone(),
                    detail: None,
                })
                .collect(),
        };

        NotificationPayload {
            event: event.clone(),
            title: title.to_string(),
            message: format!(
                "{} URLs checked, {} broken, {} changed, health: {:.0}%",
                summary.checked, summary.broken, summary.changed, summary.health_score
            ),
            crawl_id: Some(summary.crawl_id.clone()),
            report_stats: Some(report_stats),
            report_urls: Some(report_urls),
            meta: None,
            html_body: None,
        }
    }
}
