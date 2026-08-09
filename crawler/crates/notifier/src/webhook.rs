use crate::types::{NotificationPayload, WebhookConfig};
use hmac::{Hmac, Mac};
use sha2::Sha256;

pub struct WebhookNotifier {
    url: String,
    secret: Option<String>,
}

impl WebhookNotifier {
    pub fn new(config: &WebhookConfig) -> Option<Self> {
        if !config.enabled {
            return None;
        }
        Some(Self {
            url: config.url.as_ref()?.clone(),
            secret: config.secret.clone(),
        })
    }

    pub async fn send(&self, payload: &NotificationPayload) -> Result<(), String> {
        let body =
            serde_json::to_string(payload).map_err(|e| format!("JSON serialization error: {}", e))?;

        let mut req = reqwest::Client::new()
            .post(&self.url)
            .header("Content-Type", "application/json")
            .header("User-Agent", "supacrawl/0.1");

        if let Some(ref secret) = self.secret {
            let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
                .expect("HMAC can take key of any size");
            mac.update(body.as_bytes());
            let digest = mac.finalize().into_bytes();
            req = req.header(
                "X-Supacrawl-Signature",
                format!("sha256={}", hex::encode(digest)),
            );
        }

        let resp = req
            .body(body)
            .send()
            .await
            .map_err(|e| format!("Webhook request failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Webhook HTTP {}", resp.status()));
        }
        Ok(())
    }
}
