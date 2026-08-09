use encoding_rs::Encoding;

pub fn detect_mojibake(body: &[u8]) -> (f64, bool) {
    let mut score: f64 = 0.0;

    if let Some((enc, confidence)) = Encoding::for_bom(body) {
        if enc.name() != "UTF-8" && confidence >= 70 {
            return (0.9, true);
        }
    }

    let text = String::from_utf8_lossy(body);
    let replacement_count = text.chars().filter(|&c| c == '\u{FFFD}').count();
    let total_chars = text.chars().count().max(1) as f64;
    let rep_density = replacement_count as f64 / total_chars;

    score += (rep_density * 20.0).min(0.5);

    let bytes = body;
    let pattern_count = bytes
        .windows(2)
        .filter(|w| w[0] == 0xC3 && (w[1] >= 0x80 && w[1] <= 0xBF))
        .count();
    let pattern_density = pattern_count as f64 / total_chars.max(1.0);
    score += (pattern_density * 8.0).min(0.3);

    let (latin, cyrillic, cjk, korean, arabic, devanagari, thai) =
        count_scripts(&text);
    let script_count = [latin, cyrillic, cjk, korean, arabic, devanagari, thai]
        .iter()
        .filter(|&&c| c > 0)
        .count();
    if script_count >= 3 {
        score += 0.8 * (script_count as f64 - 2.0) / 5.0;
    }

    let score = score.min(1.0);
    let flagged = score > 0.5;

    (score, flagged)
}

fn count_scripts(text: &str) -> (usize, usize, usize, usize, usize, usize, usize) {
    let mut latin = 0;
    let mut cyrillic = 0;
    let mut cjk = 0;
    let mut korean = 0;
    let mut arabic = 0;
    let mut devanagari = 0;
    let mut thai = 0;

    for c in text.chars() {
        match c {
            '\u{0041}'..='\u{007A}' | '\u{00C0}'..='\u{024F}' => latin += 1,
            '\u{0400}'..='\u{04FF}' | '\u{0500}'..='\u{052F}' => cyrillic += 1,
            '\u{4E00}'..='\u{9FFF}'
            | '\u{3400}'..='\u{4DBF}'
            | '\u{3040}'..='\u{309F}'
            | '\u{30A0}'..='\u{30FF}' => cjk += 1,
            '\u{AC00}'..='\u{D7AF}' | '\u{1100}'..='\u{11FF}' => korean += 1,
            '\u{0600}'..='\u{06FF}' | '\u{0750}'..='\u{077F}' => arabic += 1,
            '\u{0900}'..='\u{097F}' => devanagari += 1,
            '\u{0E00}'..='\u{0E7F}' => thai += 1,
            _ => {}
        }
    }

    (latin, cyrillic, cjk, korean, arabic, devanagari, thai)
}
