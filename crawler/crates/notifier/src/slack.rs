use crate::types::{NotificationPayload, SlackConfig};
use serde_json::json;

pub struct SlackNotifier {
    webhook_url: String,
}

impl SlackNotifier {
    pub fn new(config: &SlackConfig) -> Option<Self> {
        if !config.enabled {
            return None;
        }
        let url = config.webhook_url.as_ref()?;
        Some(Self {
            webhook_url: url.clone(),
        })
    }

    pub async fn send(&self, payload: &NotificationPayload) -> Result<(), String> {
        let body = if payload.event.as_str() == "onCrawlProgress" {
            self.build_progress(payload)
        } else {
            self.build_report(payload)
        };

        let client = reqwest::Client::new();
        let resp = client
            .post(&self.webhook_url)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Slack request failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Slack HTTP {}", resp.status()));
        }
        Ok(())
    }

    fn build_progress(&self, p: &NotificationPayload) -> serde_json::Value {
        let meta = p.meta.as_ref().and_then(|m| m.as_object());
        let pct = meta
            .and_then(|m| m.get("percent"))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0) as u32;
        let checked = meta
            .and_then(|m| m.get("checked"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let total = meta
            .and_then(|m| m.get("total"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        let filled = (pct as usize * 10 / 100).min(10);
        let bar = format!("`{}`  {}%", "\u{2588}".repeat(filled) + &"\u{2591}".repeat(10 - filled), pct);

        json!({
            "blocks": [
                {
                    "type": "header",
                    "text": { "type": "plain_text", "text": format!("\u{1F50D} Crawl {}% complete", pct), "emoji": true }
                },
                {
                    "type": "section",
                    "text": { "type": "mrkdwn", "text": format!("{}\n{}/{} URLs checked", bar, checked, total) }
                }
            ]
        })
    }

    fn build_report(&self, p: &NotificationPayload) -> serde_json::Value {
        let stats = p.report_stats.as_ref();
        let health = stats.map(|s| s.health_score).unwrap_or(100.0);
        let health_emoji = if health >= 90.0 { "\u{1F7E2}" } else if health >= 70.0 { "\u{1F7E1}" } else { "\u{1F534}" };

        let mut blocks: Vec<serde_json::Value> = vec![];

        blocks.push(json!({
            "type": "header",
            "text": { "type": "plain_text", "text": format!("{} {}", health_emoji, p.title), "emoji": true }
        }));

        if let Some(s) = stats {
            blocks.push(json!({
                "type": "section",
                "fields": [
                    { "type": "mrkdwn", "text": format!("\u{1F6A8} *{}*\n_Broken_", s.broken_count) },
                    { "type": "mrkdwn", "text": format!("\u{1F504} *{}*\n_Changed_", s.changed_count) },
                    { "type": "mrkdwn", "text": format!("\u{1F512} *{}*\n_SSL Expiring_", s.ssl_count) },
                    { "type": "mrkdwn", "text": format!("\u{1F524} *{}*\n_Mojibake_", s.mojibake_count) },
                    { "type": "mrkdwn", "text": format!("\u{1F916} *{}*\n_LLM Garbage_", s.llm_garbage_count) }
                ]
            }));

            blocks.push(json!({
                "type": "context",
                "elements": [
                    { "type": "mrkdwn", "text": format!("{} Health: *{:.0}%* \u{00B7} {}/{} URLs", health_emoji, s.health_score, s.total_checked, s.total_found) }
                ]
            }));
        }

        if let Some(p) = &p.crawl_id {
            blocks.push(json!({
                "type": "context",
                "elements": [
                    { "type": "mrkdwn", "text": format!("supacrawl \u{00B7} ID: `{}`", &p[..8.min(p.len())]) }
                ]
            }));
        }

        blocks.push(json!({ "type": "divider" }));

        json!({ "blocks": blocks })
    }
}
