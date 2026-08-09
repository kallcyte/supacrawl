use crawl_core::types::SeoInfo;
use scraper::{Html, Selector};

pub fn extract_seo_info(html: &str, final_url: &str, byte_length: usize) -> Option<SeoInfo> {
    if byte_length > 5 * 1024 * 1024 {
        return None;
    }

    let document = Html::parse_document(html);

    let title = document
        .select(&Selector::parse("title").ok()?)
        .next()
        .map(|e| e.text().collect::<String>().trim().to_string());

    let title_length = title.as_ref().map(|t| t.chars().count());

    let description = document
        .select(&Selector::parse(r#"meta[name="description"]"#).ok()?)
        .next()
        .and_then(|e| e.value().attr("content"))
        .map(|s| s.to_string());

    let description_length = description.as_ref().map(|d| d.chars().count());

    let og_title = document
        .select(&Selector::parse(r#"meta[property="og:title"]"#).ok()?)
        .next()
        .and_then(|e| e.value().attr("content"))
        .map(|s| s.to_string());

    let og_description = document
        .select(&Selector::parse(r#"meta[property="og:description"]"#).ok()?)
        .next()
        .and_then(|e| e.value().attr("content"))
        .map(|s| s.to_string());

    let og_image = document
        .select(&Selector::parse(r#"meta[property="og:image"]"#).ok()?)
        .next()
        .and_then(|e| e.value().attr("content"))
        .map(|s| resolve_url(s, final_url));

    let canonical = document
        .select(&Selector::parse(r#"link[rel="canonical"]"#).ok()?)
        .next()
        .and_then(|e| e.value().attr("href"))
        .map(|s| s.to_string());

    let canonical_self_reference = canonical
        .as_ref()
        .map(|c| c.trim_end_matches('/') == final_url.trim_end_matches('/'));

    let noindex = document
        .select(&Selector::parse(r#"meta[name="robots"]"#).ok()?)
        .any(|e| {
            e.value()
                .attr("content")
                .map_or(false, |c| c.to_lowercase().contains("noindex"))
        });

    let nofollow = document
        .select(&Selector::parse(r#"meta[name="robots"]"#).ok()?)
        .any(|e| {
            e.value()
                .attr("content")
                .map_or(false, |c| c.to_lowercase().contains("nofollow"))
        });

    let h1_count = document
        .select(&Selector::parse("h1").unwrap())
        .count();

    let word_count = count_words(&document);

    let jsonld_types = extract_jsonld_types(html);

    Some(SeoInfo {
        title,
        title_length,
        description,
        description_length,
        og_title,
        og_description,
        og_image,
        canonical,
        canonical_self_reference,
        noindex,
        nofollow,
        h1_count,
        word_count,
        jsonld_types,
    })
}

fn resolve_url(src: &str, base: &str) -> String {
    match url::Url::parse(base) {
        Ok(base_url) => match base_url.join(src) {
            Ok(resolved) => resolved.to_string(),
            Err(_) => src.to_string(),
        },
        Err(_) => src.to_string(),
    }
}

fn count_words(document: &Html) -> usize {
    let selector = match Selector::parse("body") {
        Ok(s) => s,
        Err(_) => return 0,
    };

    let body = match document.select(&selector).next() {
        Some(b) => b,
        None => return 0,
    };

    let text = body.text().collect::<Vec<_>>().join(" ");

    text.split_whitespace()
        .filter(|w| {
            w.chars()
                .any(|c| c.is_alphabetic() || c.is_numeric())
        })
        .count()
}

fn extract_jsonld_types(html: &str) -> Vec<String> {
    let document = Html::parse_document(html);
    let selector = match Selector::parse(r#"script[type="application/ld+json"]"#) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    let mut types = Vec::new();

    for element in document.select(&selector) {
        let json: String = element.text().collect();
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&json) {
            collect_types(&value, &mut types);
        }
    }

    types
}

fn collect_types(value: &serde_json::Value, types: &mut Vec<String>) {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(t) = map.get("@type") {
                match t {
                    serde_json::Value::String(s) => types.push(s.clone()),
                    serde_json::Value::Array(arr) => {
                        for v in arr {
                            if let serde_json::Value::String(s) = v {
                                types.push(s.clone());
                            }
                        }
                    }
                    _ => {}
                }
            }
            if let Some(graph) = map.get("@graph") {
                if let serde_json::Value::Array(items) = graph {
                    for item in items {
                        collect_types(item, types);
                    }
                }
            }
        }
        _ => {}
    }
}
