//! Original Core Note wire shapes and owned analysis snapshots.
//! Validation, text projection, HBS and storage retain their Core owners.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteDocument {
    pub schema_version: i64,
    pub page_id: String,
    /// Page-title projection belongs to the same edit, revision and HBS state.
    /// Absent in legacy body-only documents; saving those preserves the title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub blocks: Vec<NoteDocumentBlock>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteDocumentBlock {
    pub id: String,
    #[serde(rename = "type")]
    pub block_type: String,
    pub props: serde_json::Value,
    pub content: serde_json::Value,
    pub children: Vec<NoteDocumentBlock>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoteDocumentAnalysis {
    pub document: NoteDocument,
    pub known_block_types: Vec<String>,
    pub result: NoteDocumentAnalysisResult,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum NoteDocumentAnalysisResult {
    Ready { text: String, folded_text: String },
    Invalid { cause: String },
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn original_note_shapes_keep_legacy_title_defaults_type_name_and_extra_fields() {
        let original = r#"{"schemaVersion":1,"pageId":"page","blocks":[{"id":"block","type":"paragraph","props":{},"content":{"items":[],"kind":"inline"},"children":[]}]}"#;
        let document: NoteDocument = serde_json::from_str(original).unwrap();
        assert_eq!(document.title, None);
        assert_eq!(serde_json::to_string(&document).unwrap(), original);
        let mut value = serde_json::from_str::<serde_json::Value>(original).unwrap();
        value["legacyExtra"] = true.into();
        value["blocks"][0]["legacyExtra"] = true.into();
        assert_eq!(
            serde_json::from_value::<NoteDocument>(value.clone()).unwrap(),
            document
        );
        value["title"] = "标题".into();
        let titled: NoteDocument = serde_json::from_value(value).unwrap();
        assert_eq!(titled.title.as_deref(), Some("标题"));
        assert_eq!(
            serde_json::to_value(titled).unwrap()["blocks"][0]["type"],
            "paragraph"
        );
    }
}
