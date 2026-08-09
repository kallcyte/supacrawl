use crate::types::RobotsData;
use url::Url;

pub async fn fetch_and_parse_robots(origin: &Url) -> RobotsData {
    let robots_url = origin.join("/robots.txt").unwrap_or_else(|_| origin.clone());
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .ok();

    match client {
        Some(client) => match client.get(robots_url.clone()).send().await {
            Ok(resp) if resp.status().is_success() => {
                let body = resp.text().await.unwrap_or_default();
                parse_robots_txt(&body, origin)
            }
            _ => RobotsData {
                sitemaps: vec![],
                crawl_delay: None,
                allowed_rules: vec![],
                disallowed_rules: vec![],
            },
        },
        None => RobotsData {
            sitemaps: vec![],
            crawl_delay: None,
            allowed_rules: vec![],
            disallowed_rules: vec![],
        },
    }
}

fn parse_robots_txt(body: &str, base: &Url) -> RobotsData {
    let mut sitemaps = Vec::new();
    let mut crawl_delay = None;
    let mut allowed = Vec::new();
    let mut disallowed = Vec::new();
    let mut in_user_agent = false;

    for line in body.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let (key, value) = match line.split_once(':') {
            Some((k, v)) => (k.trim().to_lowercase(), v.trim().to_string()),
            None => continue,
        };

        match key.as_str() {
            "user-agent" => {
                let ua = value.to_lowercase();
                in_user_agent = ua == "*" || ua.contains("supacrawl");
            }
            "sitemap" if in_user_agent || sitemaps.is_empty() => {
                if let Ok(u) = Url::parse(&value) {
                    sitemaps.push(u);
                } else if let Ok(u) = base.join(&value) {
                    sitemaps.push(u);
                }
            }
            "crawl-delay" if in_user_agent => {
                crawl_delay = value.parse::<f64>().ok().map(|d| (d * 1000.0) as u64);
            }
            "allow" if in_user_agent => {
                allowed.push((value.clone(), value));
            }
            "disallow" if in_user_agent => {
                disallowed.push((value.clone(), value));
            }
            _ => {}
        }
    }

    RobotsData {
        sitemaps,
        crawl_delay,
        allowed_rules: allowed,
        disallowed_rules: disallowed,
    }
}

pub const COMMON_SITEMAP_PATHS: &[&str] = &[
    "/sitemap.xml",
    "/sitemap_index.xml",
    "/sitemap-index.xml",
    "/sitemap.php",
    "/sitemap.txt",
    "/sitemap.xml.gz",
    "/sitemap_index.xml.gz",
    "/sitemap/sitemap.xml",
    "/sitemap/index.xml",
    "/wp-sitemap.xml",
    "/sitemap/sitemap-index.xml",
    "/sitemap-news.xml",
];

pub async fn resolve_sitemap_urls(base_url: &Url) -> Vec<Url> {
    if is_likely_sitemap_url(base_url) {
        return vec![base_url.clone()];
    }

    let robots = fetch_and_parse_robots(base_url).await;
    if !robots.sitemaps.is_empty() {
        return robots.sitemaps;
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    for path in COMMON_SITEMAP_PATHS {
        let url = match base_url.join(path) {
            Ok(u) => u,
            Err(_) => continue,
        };
        if let Ok(resp) = client.head(url.clone()).send().await {
            if resp.status().is_success() {
                return vec![url];
            }
        }
    }

    vec![]
}

pub fn is_likely_sitemap_url(url: &Url) -> bool {
    let path = url.path().to_lowercase();
    path.ends_with(".xml")
        || path.ends_with(".xml.gz")
        || path.contains("sitemap")
        || path.ends_with(".txt")
}
