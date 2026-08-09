use crate::types::CrawlConfig;
use crate::types::ChecksConfig;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigFile {
    pub sitemaps: Vec<SitemapSource>,
    #[serde(default)]
    pub crawl: Option<CrawlConfig>,
    #[serde(default)]
    pub checks: Option<ChecksConfig>,
    pub schedule: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SitemapSource {
    String(String),
    Object {
        url: Option<String>,
        urls: Option<Vec<String>>,
        name: Option<String>,
    },
}

impl SitemapSource {
    pub fn urls(&self) -> Vec<String> {
        match self {
            SitemapSource::String(url) => {
                if url.is_empty() {
                    vec![]
                } else {
                    vec![url.clone()]
                }
            }
            SitemapSource::Object { url, urls, .. } => {
                let mut result = Vec::new();
                if let Some(u) = url {
                    if !u.is_empty() {
                        result.push(u.clone());
                    }
                }
                if let Some(list) = urls {
                    result.extend(list.iter().cloned());
                }
                result
            }
        }
    }
}

pub fn load_config(config_path: &str) -> Result<ConfigFile, std::io::Error> {
    let data = std::fs::read_to_string(config_path)?;
    let config: ConfigFile = serde_json::from_str(&data)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    Ok(config)
}

impl ConfigFile {
    pub fn sitemap_urls(&self) -> Vec<String> {
        self.sitemaps.iter().flat_map(|s| s.urls()).collect()
    }
}
