use crawl_core::types::{SeoDiff, SeoInfo};
use std::collections::HashSet;

pub fn diff_seo(prev: &SeoInfo, current: &SeoInfo) -> SeoDiff {
    let title_changed = prev.title != current.title;
    let description_changed = prev.description != current.description;
    let og_title_changed = prev.og_title != current.og_title;
    let og_description_changed = prev.og_description != current.og_description;
    let og_image_changed = prev.og_image != current.og_image;
    let canonical_changed = prev.canonical != current.canonical;
    let noindex_changed = prev.noindex != current.noindex;
    let nofollow_changed = prev.nofollow != current.nofollow;

    let prev_types: HashSet<&String> = prev.jsonld_types.iter().collect();
    let curr_types: HashSet<&String> = current.jsonld_types.iter().collect();

    let jsonld_types_added: Vec<String> = curr_types
        .difference(&prev_types)
        .map(|&s| s.clone())
        .collect();
    let jsonld_types_removed: Vec<String> = prev_types
        .difference(&curr_types)
        .map(|&s| s.clone())
        .collect();

    SeoDiff {
        changed: title_changed
            || description_changed
            || og_title_changed
            || og_description_changed
            || og_image_changed
            || canonical_changed
            || noindex_changed
            || nofollow_changed
            || prev.h1_count != current.h1_count
            || prev.word_count != current.word_count
            || !jsonld_types_added.is_empty()
            || !jsonld_types_removed.is_empty(),
        title_changed,
        description_changed,
        og_title_changed,
        og_description_changed,
        og_image_changed,
        canonical_changed,
        noindex_changed,
        nofollow_changed,
        h1_count_before: prev.h1_count,
        h1_count_after: current.h1_count,
        word_count_before: prev.word_count,
        word_count_after: current.word_count,
        jsonld_types_added,
        jsonld_types_removed,
    }
}
