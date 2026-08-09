use crate::types::{NotificationPayload, TelegramConfig};

pub struct TelegramNotifier {
    bot_token: String,
    chat_id: String,
}

impl TelegramNotifier {
    pub fn new(config: &TelegramConfig) -> Option<Self> {
        if !config.enabled {
            return None;
        }
        Some(Self {
            bot_token: config.bot_token.as_ref()?.clone(),
            chat_id: config.chat_id.as_ref()?.clone(),
        })
    }

    fn api_url(&self) -> String {
        format!("https://api.telegram.org/bot{}/sendMessage", self.bot_token)
    }

    pub async fn send(&self, payload: &NotificationPayload) -> Result<(), String> {
        let text = if payload.event.as_str() == "onCrawlProgress" {
            self.build_progress(payload)
        } else if payload.report_stats.is_some() {
            self.build_report(payload)
        } else {
            format!(
                "<b>{}</b>\n{}",
                escape_html(&payload.title),
                escape_html(&payload.message)
            )
        };

        let client = reqwest::Client::new();
        let resp = client
            .post(&self.api_url())
            .json(&serde_json::json!({
                "chat_id": &self.chat_id,
                "text": text,
                "parse_mode": "HTML",
                "disable_web_page_preview": true,
            }))
            .send()
            .await
            .map_err(|e| format!("Telegram request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Telegram HTTP {}: {}", status, &body[..200.min(body.len())]));
        }
        Ok(())
    }

    fn build_progress(&self, p: &NotificationPayload) -> String {
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

        let filled = (pct as usize * 20 / 100).min(20);
        let bar = "\u{2588}".repeat(filled) + &"\u{2591}".repeat(20 - filled);

        format!(
            "<b>\u{1F50D} Crawl {}% complete</b>\n\n<pre>{}</pre>\n<code>{}/{}</code> URLs checked",
            pct, bar, checked, total
        )
    }

    fn build_report(&self, p: &NotificationPayload) -> String {
        let s = p.report_stats.as_ref().unwrap();
        let health = s.health_score;
        let health_emoji = if health >= 90.0 {
            "\u{1F7E2}"
        } else if health >= 70.0 {
            "\u{1F7E1}"
        } else {
            "\u{1F534}"
        };

        let mut text = format!(
            "<b>{} {}</b>\n\n<b>Health Score: {:.0}%</b> \u{2014} {}/{} URLs checked\n\n",
            health_emoji,
            escape_html(&p.title),
            health,
            s.total_checked,
            s.total_found
        );

        text.push_str(&format!(
            "\u{1F6A8} <b>{}</b> <i>Broken</i>\n",
            s.broken_count
        ));
        text.push_str(&format!(
            "\u{1F504} <b>{}</b> <i>Changed</i>\n",
            s.changed_count
        ));
        text.push_str(&format!(
            "\u{1F512} <b>{}</b> <i>SSL Expiring</i>\n",
            s.ssl_count
        ));
        text.push_str(&format!(
            "\u{1F524} <b>{}</b> <i>Mojibake</i>\n",
            s.mojibake_count
        ));
        text.push_str(&format!(
            "\u{1F916} <b>{}</b> <i>LLM Garbage</i>\n\n",
            s.llm_garbage_count
        ));

        if let Some(urls) = &p.report_urls {
            for section in &[
                ("\u{1F6A8}", "Broken URLs", &urls.broken),
                ("\u{1F504}", "Changed URLs", &urls.changed),
                ("\u{1F512}", "SSL Expiring", &urls.ssl_expiring),
            ] {
                if !section.2.is_empty() {
                    let max = if section.2.len() <= 5 { 5 } else { 3 };
                    text.push_str(&format!(
                        "<b>{} {} ({})</b>\n",
                        section.0,
                        section.1,
                        section.2.len()
                    ));
                    for item in section.2.iter().take(max) {
                        text.push_str(&format!(
                            "\u{2022} {}\n",
                            escape_html(&truncate(&item.url, 42))
                        ));
                    }
                    if section.2.len() > max {
                        text.push_str(&format!(
                            "<i>+{} more</i>\n",
                            section.2.len() - max
                        ));
                    }
                    text.push('\n');
                }
            }
        }

        if let Some(cid) = &p.crawl_id {
            text.push_str(&format!(
                "<i>supacrawl \u{00B7} ID: {}</i>",
                &cid[..8.min(cid.len())]
            ));
        }

        text
    }
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() > n {
        format!("{}\u{2026}", s.chars().take(n - 1).collect::<String>())
    } else {
        s.to_string()
    }
}
