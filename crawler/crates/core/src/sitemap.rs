use quick_xml::events::Event;
use quick_xml::Reader;
use std::collections::{HashMap, VecDeque};
use url::Url;

use crate::types::SitemapEntry;

#[derive(Debug, Clone)]
pub struct SitemapTreeNode {
    pub url: Url,
    pub leaf_count: usize,
    pub children: Vec<SitemapTreeNode>,
}

pub async fn fetch_and_parse_sitemap(
    root_url: &Url,
) -> Result<Vec<SitemapEntry>, Box<dyn std::error::Error>> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10))
        .gzip(true)
        .brotli(true)
        .build()?;

    let mut all_entries: HashMap<String, SitemapEntry> = HashMap::new();
    let mut queue: VecDeque<Url> = VecDeque::new();
    queue.push_back(root_url.clone());
    let mut depth = 0;
    const MAX_DEPTH: u32 = 3;

    while let Some(url) = queue.pop_front() {
        if depth > MAX_DEPTH {
            break;
        }

        let resp = client.get(url.clone()).send().await?.error_for_status()?;
        let body = resp.bytes().await?;

        let body_bytes = if is_gzipped(&body) {
            use std::io::Read;
            let mut decoder = flate2::read::GzDecoder::new(&body[..]);
            let mut decompressed = Vec::new();
            decoder.read_to_end(&mut decompressed)?;
            decompressed
        } else {
            body.to_vec()
        };

        let text = String::from_utf8_lossy(&body_bytes);

        if text.contains("<sitemapindex") {
            let sitemap_urls = parse_sitemap_index(&text, &url);
            for child_url in sitemap_urls {
                queue.push_back(child_url);
            }
            depth += 1;
        } else {
            let entries = parse_urlset(&text);
            for entry in entries {
                let key = entry.loc.clone();
                match all_entries.get(&key) {
                    Some(existing) => {
                        let new_is_newer = entry.lastmod.as_ref() > existing.lastmod.as_ref();
                        if new_is_newer {
                            all_entries.insert(key, entry);
                        }
                    }
                    None => {
                        all_entries.insert(key, entry);
                    }
                }
            }
        }
    }

    Ok(all_entries.into_values().collect())
}

pub async fn discover_sitemap_tree(root_url: &Url) -> Result<SitemapTreeNode, Box<dyn std::error::Error + Send + Sync>> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()?;

    let mut root = SitemapTreeNode {
        url: root_url.clone(),
        leaf_count: 0,
        children: vec![],
    };

    let mut queue: VecDeque<(*mut SitemapTreeNode, Url)> = VecDeque::new();
    queue.push_back((&mut root as *mut SitemapTreeNode, root_url.clone()));

    while let Some((parent_ptr, url)) = queue.pop_front() {
        let resp = client.get(url.clone()).send().await?.error_for_status()?;
        let body = resp.bytes().await?;

        let body_bytes = if is_gzipped(&body) {
            use std::io::Read;
            let mut decoder = flate2::read::GzDecoder::new(&body[..]);
            let mut decompressed = Vec::new();
            decoder.read_to_end(&mut decompressed)?;
            decompressed
        } else {
            body.to_vec()
        };

        let text = String::from_utf8_lossy(&body_bytes);
        let parent = unsafe { &mut *parent_ptr };

        if text.contains("<sitemapindex") {
            let children_urls = parse_sitemap_index(&text, &url);
            for child_url in &children_urls {
                parent.children.push(SitemapTreeNode {
                    url: child_url.clone(),
                    leaf_count: 0,
                    children: vec![],
                });
            }
            let child_count = parent.children.len();
            for i in 0..child_count {
                let child_ptr = &mut parent.children[i] as *mut SitemapTreeNode;
                let child_url = parent.children[i].url.clone();
                queue.push_back((child_ptr, child_url));
            }
        } else {
            let entries = parse_urlset(&text);
            parent.leaf_count = entries.len();
        }
    }

    sum_leaf_counts(&mut root);

    Ok(root)
}

fn sum_leaf_counts(node: &mut SitemapTreeNode) -> usize {
    if node.children.is_empty() {
        return node.leaf_count;
    }
    let total: usize = node.children.iter_mut().map(|c| sum_leaf_counts(c)).sum();
    node.leaf_count = total;
    total
}

fn parse_sitemap_index(xml: &str, base: &Url) -> Vec<Url> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut urls = Vec::new();
    let mut in_sitemap = false;
    let mut in_loc = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => match e.name().as_ref() {
                b"sitemap" => in_sitemap = true,
                b"loc" if in_sitemap => in_loc = true,
                _ => {}
            },
            Ok(Event::End(ref e)) => match e.name().as_ref() {
                b"sitemap" => in_sitemap = false,
                b"loc" => in_loc = false,
                _ => {}
            },
            Ok(Event::Text(ref e)) => {
                if in_loc {
                    let text = e.unescape().unwrap_or_default();
                    if let Ok(url) = Url::parse(&text) {
                        urls.push(url);
                    } else if let Ok(url) = base.join(&text) {
                        urls.push(url);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }

    urls
}

fn parse_urlset(xml: &str) -> Vec<SitemapEntry> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut entries = Vec::new();
    let mut in_url = false;
    let mut current_tag = String::new();

    let mut loc = String::new();
    let mut lastmod: Option<String> = None;
    let mut changefreq: Option<String> = None;
    let mut priority: Option<f64> = None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if name == "url" {
                    in_url = true;
                    loc.clear();
                    lastmod = None;
                    changefreq = None;
                    priority = None;
                } else if in_url {
                    current_tag = name;
                }
            }
            Ok(Event::End(ref e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if name == "url" && in_url {
                    in_url = false;
                    if !loc.is_empty() {
                        entries.push(SitemapEntry {
                            loc: loc.clone(),
                            lastmod: lastmod.take(),
                            changefreq: changefreq.take(),
                            priority,
                        });
                    }
                }
            }
            Ok(Event::Text(ref e)) => {
                if in_url {
                    let text = e.unescape().unwrap_or_default();
                    match current_tag.as_str() {
                        "loc" => loc = text.to_string(),
                        "lastmod" => lastmod = Some(text.to_string()),
                        "changefreq" => changefreq = Some(text.to_string()),
                        "priority" => {
                            priority = text.parse().ok();
                        }
                        _ => {}
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }

    entries
}

fn is_gzipped(data: &[u8]) -> bool {
    data.len() >= 2 && data[0] == 0x1f && data[1] == 0x8b
}
