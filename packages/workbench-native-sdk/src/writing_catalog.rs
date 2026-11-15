//! Owned inputs for the existing bounded writing-note index preparation.
use crate::{
    data::DataRows,
    note_document::NoteDocumentAnalysis,
    writing_file::{WritingNoteCatalogProjection, WritingNotePreparation},
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PreparationScope {
    Active,
    Archived,
    #[default]
    Live,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preparation {
    pub processed_count: usize,
    pub pending_count: i64,
    pub error_count: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingFile {
    pub manuscript_id: String,
    pub path: String,
    pub hash: String,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum FileRead {
    Read { content: String, hash: String },
    Failed { cause: String },
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemInput {
    pub file: PendingFile,
    pub read: FileRead,
    pub note_title: String,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemPreparation {
    pub input: ItemInput,
    #[serde(deserialize_with = "required_optional")]
    pub note: Option<WritingNotePreparation>,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ItemEffect {
    Record {
        projection: WritingNoteCatalogProjection,
    },
    ExternalChange {},
    Error {
        cause: String,
    },
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemPlan {
    pub preparation: ItemPreparation,
    pub effect: ItemEffect,
    pub duplicate_identity_cause: String,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(
    tag = "phase",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CatalogInput {
    Batch {
        scope: PreparationScope,
        retry_errors: bool,
    },
    Pending {
        rows: DataRows,
    },
    PrepareItem {
        item: Box<ItemInput>,
    },
    FinishItem {
        preparation: Box<ItemPreparation>,
        #[serde(deserialize_with = "required_optional")]
        analysis: Option<NoteDocumentAnalysis>,
    },
    Finish {
        processed_count: usize,
        rows: DataRows,
    },
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(
    tag = "phase",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CatalogDecision {
    Batch { statuses: [String; 2] },
    Pending { files: Vec<PendingFile> },
    PrepareItem { preparation: Box<ItemPreparation> },
    FinishItem { plan: Box<ItemPlan> },
    Finish { result: Preparation },
}

fn required_optional<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::deserialize(deserializer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::writing_project::{Decision, Input, Operation, Output};

    #[test]
    fn catalog_preparation_preserves_original_scope_and_public_result() {
        assert_eq!(PreparationScope::default(), PreparationScope::Live);
        assert_eq!(
            serde_json::from_str::<PreparationScope>("\"archived\"").unwrap(),
            PreparationScope::Archived
        );
        assert!(serde_json::from_str::<PreparationScope>("\"trash\"").is_err());
        let result = Preparation {
            processed_count: 8,
            pending_count: 3,
            error_count: 1,
        };
        assert_eq!(
            serde_json::to_value(&result).unwrap(),
            serde_json::json!({"processedCount":8,"pendingCount":3,"errorCount":1})
        );
        assert_eq!(serde_json::from_value::<Preparation>(serde_json::json!({"processedCount":8,"pendingCount":3,"errorCount":1,"oldExtra":true})).unwrap(),result);
    }

    #[test]
    fn catalog_wire_keeps_raw_read_input_exact_echo_and_required_nullable_analysis() {
        let item = ItemInput {
            file: PendingFile {
                manuscript_id: " raw ".into(),
                path: "notes/思路.ranote".into(),
                hash: "legacy-hash".into(),
            },
            read: FileRead::Read {
                content: "原文\r\n".into(),
                hash: "read-hash".into(),
            },
            note_title: "思路".into(),
        };
        let input = Input::CatalogPreparation {
            input: Box::new(CatalogInput::PrepareItem {
                item: Box::new(item.clone()),
            }),
        };
        assert_eq!(input.operation(), Operation::CatalogPreparation);
        assert_eq!(
            serde_json::from_value::<Input>(serde_json::to_value(&input).unwrap()).unwrap(),
            input
        );
        let preparation = ItemPreparation {
            input: item,
            note: None,
        };
        let output = Output {
            input: input.clone(),
            decision: Decision::CatalogPreparation {
                decision: Box::new(CatalogDecision::PrepareItem {
                    preparation: Box::new(preparation.clone()),
                }),
            },
        };
        assert_eq!(
            serde_json::from_value::<Output>(serde_json::to_value(&output).unwrap()).unwrap(),
            output
        );
        let finish = CatalogInput::FinishItem {
            preparation: Box::new(preparation),
            analysis: None,
        };
        let mut json = serde_json::to_value(&finish).unwrap();
        assert!(json["analysis"].is_null());
        json.as_object_mut().unwrap().remove("analysis");
        assert!(serde_json::from_value::<CatalogInput>(json).is_err());
        let mut json = serde_json::to_value(&finish).unwrap();
        json["sql"] = "untrusted".into();
        assert!(serde_json::from_value::<CatalogInput>(json).is_err());
        let mut json = serde_json::to_value(&input).unwrap();
        json["input"]["item"]["file"]["directory"] = "/private".into();
        assert!(serde_json::from_value::<Input>(json).is_err());
        assert!(
            serde_json::from_value::<ItemEffect>(
                serde_json::json!({"kind":"externalChange","execute":true})
            )
            .is_err()
        );
    }
}
