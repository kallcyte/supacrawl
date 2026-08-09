use regex::Regex;

const PATTERNS: &[(&str, f64)] = &[
    (r"\[[A-Z_]+\]", 0.4),
    (r"I('m| am) sorry[, ]+(I cannot|I can't|I am unable to)", 0.5),
    (r#"\{"response"\s*:"#, 0.5),
];

pub fn detect_llm_garbage(text: &str) -> (f64, bool) {
    if text.chars().count() < 80 {
        return (0.0, false);
    }

    let mut score: f64 = 0.0;
    let mut signals: u32 = 0;

    for (pattern, weight) in PATTERNS {
        let re = match Regex::new(pattern) {
            Ok(r) => r,
            Err(_) => continue,
        };
        if re.is_match(text) {
            score += weight;
            signals += 1;
        }
    }

    if signals >= 2 {
        score = score.max(0.8);
    }

    let flagged = score > 0.5;

    (score, flagged)
}
