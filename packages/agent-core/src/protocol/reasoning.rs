//! Public summaries only. Signed Codex indexes never pass through JS numbers.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ReasoningSummaryIndex(String);
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error("invalid reasoning summary index")]
pub struct ReasoningSummaryIndexError;
impl From<i64> for ReasoningSummaryIndex {
    fn from(value: i64) -> Self {
        Self(value.to_string())
    }
}
impl TryFrom<String> for ReasoningSummaryIndex {
    type Error = ReasoningSummaryIndexError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        let index = value
            .parse::<i64>()
            .map_err(|_| ReasoningSummaryIndexError)?;
        if index.to_string() != value {
            return Err(ReasoningSummaryIndexError);
        }
        Ok(Self(value))
    }
}
impl From<ReasoningSummaryIndex> for String {
    fn from(value: ReasoningSummaryIndex) -> Self {
        value.0
    }
}
impl ReasoningSummaryIndex {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReasoningSummaryPart {
    pub index: ReasoningSummaryIndex,
    pub start_byte: usize,
    pub len_byte: usize,
}
pub fn validate_summary_parts(text: &str, parts: &[ReasoningSummaryPart]) -> bool {
    let mut cursor = 0;
    let mut indexes = BTreeSet::new();
    for part in parts {
        let Some(end) = part.start_byte.checked_add(part.len_byte) else {
            return false;
        };
        if part.start_byte != cursor
            || text.get(cursor..end).is_none()
            || !indexes.insert(&part.index)
        {
            return false;
        }
        cursor = end;
    }
    cursor == text.len()
}

/// Interleaved deltas retain their first-appearance order. Completion supplies
/// an independent canonical array; it need not match this draft's prefix.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReasoningSummaryDraft {
    order: Vec<ReasoningSummaryIndex>,
    parts: BTreeMap<ReasoningSummaryIndex, String>,
    text_bytes: usize,
    metadata_bytes: usize,
}
impl Default for ReasoningSummaryDraft {
    fn default() -> Self {
        Self {
            order: vec![],
            parts: BTreeMap::new(),
            text_bytes: 0,
            metadata_bytes: 2,
        }
    }
}
impl ReasoningSummaryDraft {
    pub fn contains(&self, index: &ReasoningSummaryIndex) -> bool {
        self.parts.contains_key(index)
    }
    pub fn add_part(&mut self, index: ReasoningSummaryIndex) {
        if self.parts.contains_key(&index) {
            return;
        }
        self.metadata_bytes = self
            .metadata_bytes
            .saturating_add(self.metadata_growth(&index));
        self.order.push(index.clone());
        self.parts.insert(index, String::new());
    }
    pub fn append(&mut self, index: ReasoningSummaryIndex, text: &str) {
        self.add_part(index.clone());
        self.parts
            .get_mut(&index)
            .expect("part was inserted")
            .push_str(text);
        self.text_bytes = self.text_bytes.saturating_add(text.len());
    }
    pub fn text_bytes(&self) -> usize {
        self.text_bytes
    }
    pub fn metadata_bytes(&self) -> usize {
        self.metadata_bytes
    }
    pub fn metadata_growth(&self, index: &ReasoningSummaryIndex) -> usize {
        if self.contains(index) {
            0
        } else {
            index.as_str().len() + 2 + usize::from(!self.order.is_empty())
        }
    }
    pub fn parts(&self) -> impl Iterator<Item = (&ReasoningSummaryIndex, &str)> {
        self.order
            .iter()
            .map(|index| (index, self.parts[index].as_str()))
    }
    pub fn is_last(&self, index: &ReasoningSummaryIndex) -> bool {
        self.order.last() == Some(index)
    }
    pub fn snapshot(&self) -> (String, Vec<ReasoningSummaryPart>) {
        let mut text = String::new();
        let mut parts = Vec::with_capacity(self.order.len());
        for (index, body) in self.parts() {
            parts.push(ReasoningSummaryPart {
                index: index.clone(),
                start_byte: text.len(),
                len_byte: body.len(),
            });
            text.push_str(body);
        }
        (text, parts)
    }
    pub fn additional_final_bytes(&self, text: &str, parts: &[ReasoningSummaryPart]) -> usize {
        parts.iter().fold(0usize, |sum, part| {
            let body = text
                .get(part.start_byte..part.start_byte.saturating_add(part.len_byte))
                .unwrap_or(text);
            let old = self
                .parts
                .get(&part.index)
                .map(String::as_str)
                .unwrap_or_default();
            sum.saturating_add(body.strip_prefix(old).map_or(body.len(), str::len))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn indexes_are_lossless_canonical_i64_strings_without_an_array_allocation() {
        for value in [i64::MIN, -1, 0, 9_007_199_254_740_993, i64::MAX] {
            let index = ReasoningSummaryIndex::from(value);
            assert_eq!(
                serde_json::to_string(&index).unwrap(),
                format!("\"{value}\"")
            );
            assert_eq!(
                serde_json::from_str::<ReasoningSummaryIndex>(&format!("\"{value}\"")).unwrap(),
                index
            );
        }
        for invalid in ["+1", "01", "-0", "1.0", "9223372036854775808", ""] {
            assert!(ReasoningSummaryIndex::try_from(invalid.to_owned()).is_err());
        }
    }
    #[test]
    fn interleaved_parts_group_in_first_appearance_order_and_metadata_matches_key_json() {
        let mut draft = ReasoningSummaryDraft::default();
        let a = ReasoningSummaryIndex::from(i64::MIN);
        let b = ReasoningSummaryIndex::from(i64::MAX);
        draft.add_part(a.clone());
        draft.add_part(a.clone());
        draft.append(a.clone(), "A你");
        draft.append(b.clone(), "B🦀");
        draft.append(a.clone(), "A2");
        let (text, parts) = draft.snapshot();
        assert_eq!(text, "A你A2B🦀");
        assert!(validate_summary_parts(&text, &parts));
        assert_eq!(
            draft.metadata_bytes(),
            serde_json::to_vec(&vec![a, b]).unwrap().len()
        );
        assert_eq!(draft.text_bytes(), text.len());
        assert_eq!(draft.parts().count(), 2);
    }
}
