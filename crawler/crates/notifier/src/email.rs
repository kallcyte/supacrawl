use crate::types::{EmailConfig, NotificationPayload};
use serde_json::json;

pub struct EmailNotifier {
    smtp_host: String,
    smtp_port: u16,
    smtp_secure: bool,
    from: String,
    to: Vec<String>,
}

impl EmailNotifier {
    pub fn new(config: &EmailConfig) -> Option<Self> {
        if !config.enabled {
            return None;
        }
        let smtp = config.smtp.as_ref()?;
        Some(Self {
            smtp_host: smtp.host.as_ref()?.clone(),
            smtp_port: smtp.port.unwrap_or(587),
            smtp_secure: smtp.secure,
            from: config.from.as_ref()?.clone(),
            to: config.to.clone(),
        })
    }

    pub async fn send(&self, payload: &NotificationPayload) -> Result<(), String> {
        let html = if let Some(ref html_body) = payload.html_body {
            html_body.clone()
        } else {
            self.build_html(payload)
        };

        let email_req = json!({
            "from": self.from,
            "to": self.to.join(", "),
            "subject": format!("[supacrawl] {}", payload.title),
            "text": payload.message,
            "html": html,
        });

        let client = reqwest::Client::new();
        let resp = client
            .post(&format!(
                "{}://{}:{}/api/send",
                if self.smtp_secure { "https" } else { "http" },
                self.smtp_host,
                self.smtp_port
            ))
            .json(&email_req)
            .send()
            .await
            .map_err(|e| format!("Email request failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Email HTTP {}", resp.status()));
        }
        Ok(())
    }

    fn build_html(&self, p: &NotificationPayload) -> String {
        let stats = p.report_stats.as_ref();
        let health = stats.map(|s| s.health_score).unwrap_or(100.0);

        let mut items_html = String::new();
        if let Some(s) = stats {
            items_html.push_str(&format!(
                r#"<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;color:#666;font-size:13px;">Health Score</td><td style="padding:4px 8px;border-bottom:1px solid #eee;font-size:13px;">{:.0}%</td></tr>"#,
                s.health_score
            ));
            items_html.push_str(&format!(
                r#"<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;color:#666;font-size:13px;">URLs Checked</td><td style="padding:4px 8px;border-bottom:1px solid #eee;font-size:13px;">{}/{}</td></tr>"#,
                s.total_checked, s.total_found
            ));
            items_html.push_str(&format!(
                r#"<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;color:#666;font-size:13px;">Broken</td><td style="padding:4px 8px;border-bottom:1px solid #eee;font-size:13px;">{}</td></tr>"#,
                s.broken_count
            ));
            items_html.push_str(&format!(
                r#"<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;color:#666;font-size:13px;">Changed</td><td style="padding:4px 8px;border-bottom:1px solid #eee;font-size:13px;">{}</td></tr>"#,
                s.changed_count
            ));
        }

        let health_color = if health >= 90.0 {
            "#059669"
        } else if health >= 70.0 {
            "#d97706"
        } else {
            "#dc2626"
        };

        format!(
            r#"<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <div style="background:{health_color};color:#fff;border-radius:8px 8px 0 0;padding:20px 24px;">
    <h1 style="margin:0;font-size:18px;">supacrawl</h1>
  </div>
  <div style="background:#fff;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 8px 8px;padding:24px;color:#1e293b;">
    <h2 style="margin:0 0 12px;font-size:16px;">{title}</h2>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#475569;">{msg}</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">{items}</table>
    {footer}
  </div>
  <p style="text-align:center;font-size:11px;color:#94a3b8;margin-top:12px;">supacrawl \u00B7 Automated crawl report</p>
</div>"#,
            title = p.title,
            msg = p.message,
            items = items_html,
            footer = p.crawl_id.as_ref().map_or(String::new(), |id| format!(
                r#"<p style="margin:0;font-size:12px;color:#94a3b8;">Crawl ID: {}</p>"#,
                &id[..8.min(id.len())]
            )),
        )
    }
}
