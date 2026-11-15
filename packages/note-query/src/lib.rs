//! Rebuildable query projections. No storage, permissions, clocks or HBS state.
use icu_collator::{
    Collator, CollatorBorrowed,
    options::{CollatorOptions, Strength},
};
use icu_locale_core::locale;
use std::sync::OnceLock;
mod catalog_sql;
pub use catalog_sql::{CatalogSearchSql, catalog_search_sql};

static COLLATOR: OnceLock<Result<CollatorBorrowed<'static>, String>> = OnceLock::new();

/// The key format includes data/options. Bump and rebuild keys on ICU updates.
pub fn note_collation_version() -> String {
    "icu4x-2.3.1/zh-CN/kn-primary/v1".to_owned()
}

/// Only valid UTF-8 strings reach ICU. Do not call its lossy byte-normalizer API.
pub fn note_sort_key(text: &str) -> Result<Vec<u8>, String> {
    let collator = COLLATOR
        .get_or_init(|| {
            let mut options = CollatorOptions::default();
            options.strength = Some(Strength::Primary);
            Collator::try_new(locale!("zh-CN-u-kn-true").into(), options)
                .map_err(|error| format!("note_catalog_collation_unavailable: {error}"))
        })
        .as_ref()
        .map_err(Clone::clone)?;
    let mut key = Vec::new();
    let Ok(()) = collator.write_sort_key_to(text, &mut key);
    Ok(key)
}

/// ECMAScript whitespace: FEFF is whitespace, 0085 is not.
pub fn js_whitespace(value: char) -> bool {
    matches!(value, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}'
        | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}'
        | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

pub fn note_normalization_version() -> String {
    let (major, minor, patch) = char::UNICODE_VERSION;
    format!("rust-unicode-{major}.{minor}.{patch}/lower-js-space/v1")
}

pub fn note_fold(text: &str) -> String {
    text.to_lowercase()
}

/// The same grammar and limits in native and browser persistent search.
pub fn note_query_terms(text: &str) -> Result<Vec<String>, String> {
    if text.len() > 4096 {
        return Err("note_catalog_search_invalid：搜索文本超过安全长度。".to_owned());
    }
    let mut terms = Vec::new();
    for part in note_fold(text)
        .split(js_whitespace)
        .filter(|part| !part.is_empty())
    {
        if part.len() > 512 {
            return Err("note_catalog_search_invalid：搜索词过长。".to_owned());
        }
        if terms.iter().any(|term| term == part) {
            continue;
        }
        if terms.len() == 32 {
            return Err("note_catalog_search_invalid：搜索词数量过多。".to_owned());
        }
        terms.push(part.to_owned());
    }
    Ok(terms)
}

pub fn note_display_title(body: &str, quote: &str, fallback: &str) -> String {
    let first = |text: &str| {
        text.split('\n')
            .map(|line| line.trim_matches(js_whitespace))
            .find(|line| !line.is_empty())
            .unwrap_or_default()
            .to_owned()
    };
    let body = first(body);
    let quote = first(quote);
    let text = if !body.is_empty() {
        &body
    } else if !quote.is_empty() {
        &quote
    } else {
        fallback
    };
    let mut length = 0;
    text.chars()
        .take_while(|value| {
            length += value.len_utf16();
            length <= 100
        })
        .collect()
}

/// Bytewise ascending key reverses value order, while a separate ID tie key
/// stays ascending. Escaping plus a terminator also reverses prefix ordering.
pub fn note_reverse_key(key: &[u8]) -> Vec<u8> {
    let mut reversed = Vec::with_capacity(key.len() * 2 + 1);
    for byte in key {
        reversed.extend_from_slice(&[254, 255 - byte]);
    }
    reversed.push(255);
    reversed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chinese_numeric_and_base_order() {
        let key = |text| note_sort_key(text).unwrap();
        assert!(key("笔记2") < key("笔记10"));
        assert!(key("阿") < key("中"));
        assert_eq!(key("ÉCOLE"), key("ecole"));
    }

    #[test]
    fn reverse_includes_prefix_and_zero_bytes() {
        let values = [vec![], vec![0], vec![0, 0], vec![1], vec![255]];
        for pair in values.windows(2) {
            assert!(note_reverse_key(&pair[0]) > note_reverse_key(&pair[1]));
        }
    }

    #[test]
    fn terms_are_literal_unicode_and_unique() {
        assert_eq!(
            note_query_terms("\u{feff}中 文 A*a  İ ΟΣ\u{0085} x\0y").unwrap(),
            ["中", "文", "a*a", "i\u{307}", "ος\u{0085}", "x\0y"]
        );
        let thirty_two = (0..32)
            .map(|value| value.to_string())
            .collect::<Vec<_>>()
            .join(" ");
        assert_eq!(
            note_query_terms(&format!("{thirty_two} 0")).unwrap().len(),
            32
        );
        assert!(note_query_terms(&format!("{thirty_two} new")).is_err());
        assert!(note_query_terms(&"中".repeat(171)).is_err());
        assert!(note_query_terms(&" ".repeat(4097)).is_err());
    }

    #[test]
    fn display_title_keeps_complete_scalars() {
        assert_eq!(
            note_display_title(" \n\u{feff}正文\n尾行", "摘录", "标题"),
            "正文"
        );
        assert_eq!(note_display_title("\n", "摘录\n尾行", "标题"), "摘录");
        assert_eq!(note_display_title("", "", "标题"), "标题");
        assert_eq!(
            note_display_title(&format!("{}😀", "a".repeat(99)), "", ""),
            "a".repeat(99)
        );
    }
}
