use std::collections::HashSet;

fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Extract `#tag` tokens (without the `#`) from Markdown text.
///
/// A tag must start at the beginning of a line or after whitespace and be
/// followed by at least one word character. Fenced code blocks are skipped.
/// Order of first appearance is kept; duplicates are dropped.
pub fn extract_tags(content: &str) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut tags = Vec::new();
    let mut in_fence = false;

    for line in content.lines() {
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let mut prev: Option<char> = None;
        for (i, c) in line.char_indices() {
            if c == '#' && prev.is_none_or(|p| p.is_whitespace()) {
                let rest = &line[i + 1..];
                let word: String = rest.chars().take_while(|&ch| is_tag_char(ch)).collect();
                if !word.is_empty() && seen.insert(word.clone()) {
                    tags.push(word);
                }
            }
            prev = Some(c);
        }
    }
    tags
}

/// A short plain-text preview of a note: body lines (headings, fences and
/// blank lines skipped) joined by spaces and cut at `max` characters.
pub fn extract_excerpt(content: &str, max: usize) -> String {
    let mut parts: Vec<&str> = Vec::new();
    let mut in_fence = false;
    for line in content.lines() {
        let t = line.trim();
        if t.starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence || t.is_empty() || t.starts_with('#') && t.chars().nth(1).is_none_or(|c| c == '#' || c == ' ') {
            continue;
        }
        parts.push(t);
    }
    let joined = parts.join(" ");
    if joined.chars().count() <= max {
        joined
    } else {
        let cut: String = joined.chars().take(max).collect();
        format!("{}…", cut.trim_end())
    }
}
