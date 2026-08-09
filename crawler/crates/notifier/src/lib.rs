pub mod email;
pub mod slack;
pub mod telegram;
pub mod types;
pub mod webhook;

use std::sync::Arc;
use tracing::warn;

use crate::email::EmailNotifier;
use crate::slack::SlackNotifier;
use crate::telegram::TelegramNotifier;
use crate::types::{NotificationPayload, NotificationsConfig};
use crate::webhook::WebhookNotifier;

pub struct Notifier {
    slack: Option<Arc<SlackNotifier>>,
    telegram: Option<Arc<TelegramNotifier>>,
    email: Option<Arc<EmailNotifier>>,
    webhook: Option<Arc<WebhookNotifier>>,
}

impl Notifier {
    pub fn new(config: &NotificationsConfig) -> Self {
        Self {
            slack: SlackNotifier::new(&config.providers.slack).map(Arc::new),
            telegram: TelegramNotifier::new(&config.providers.telegram).map(Arc::new),
            email: EmailNotifier::new(&config.providers.email).map(Arc::new),
            webhook: WebhookNotifier::new(&config.providers.webhook).map(Arc::new),
        }
    }

    pub fn enabled_providers(&self) -> Vec<String> {
        let mut names = Vec::new();
        if self.slack.is_some() {
            names.push("slack".to_string());
        }
        if self.telegram.is_some() {
            names.push("telegram".to_string());
        }
        if self.email.is_some() {
            names.push("email".to_string());
        }
        if self.webhook.is_some() {
            names.push("webhook".to_string());
        }
        names
    }

    pub async fn notify(&self, payload: &NotificationPayload) {
        let payload = Arc::new(payload.clone());

        if let Some(ref slack) = self.slack {
            let slack = slack.clone();
            let p = payload.clone();
            let _ = tokio::spawn(async move {
                if let Err(e) = slack.send(&p).await {
                    warn!("Slack notification failed: {}", e);
                }
            })
            .await;
        }
        if let Some(ref telegram) = self.telegram {
            let telegram = telegram.clone();
            let p = payload.clone();
            let _ = tokio::spawn(async move {
                if let Err(e) = telegram.send(&p).await {
                    warn!("Telegram notification failed: {}", e);
                }
            })
            .await;
        }
        if let Some(ref email) = self.email {
            let email = email.clone();
            let p = payload.clone();
            let _ = tokio::spawn(async move {
                if let Err(e) = email.send(&p).await {
                    warn!("Email notification failed: {}", e);
                }
            })
            .await;
        }
        if let Some(ref webhook) = self.webhook {
            if let Err(e) = webhook.send(&payload).await {
                warn!("Webhook notification failed: {}", e);
            }
        }
    }
}
