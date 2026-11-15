//! Owned inputs and results for the original complete research export.
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CAPABILITY_ID: &str = "literature.research-export";
pub const CAPABILITY_VERSION: u32 = 1;
pub const MAX_EXPORT_RECORDS: usize = 100_000;
pub const MAX_EXPORT_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResearchExportDatasetV1 {
    pub name: String,
    pub records: Vec<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResearchExportSnapshotV1 {
    pub application_version: String,
    pub exported_at: String,
    pub datasets: Vec<ResearchExportDatasetV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedResearchExportV1 {
    pub exported_at: String,
    pub manifest_json: String,
    pub markdown: String,
    pub object_count: usize,
    pub source_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ResearchExportRejectionV1 {
    TooLarge,
    InvalidSnapshot,
    Serialization { message: String },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        analysis_workflow::wire::{WorkflowDecisionV1, WorkflowInputV1},
        paper_context_wire::{decode_payload, encode_payload},
    };

    #[test]
    fn owned_snapshot_codec_and_result_identity_are_preserved() {
        let snapshot = ResearchExportSnapshotV1 {
            application_version: "0.7.6".into(),
            exported_at: "time".into(),
            datasets: vec![ResearchExportDatasetV1 {
                name: "claims".into(),
                records: vec![serde_json::json!({"id":"claim", "statement":"Ω"})],
            }],
        };
        assert_eq!(
            decode_payload::<ResearchExportSnapshotV1>(&encode_payload(&snapshot).unwrap())
                .unwrap(),
            snapshot
        );
        let input = WorkflowInputV1::ResearchExport {
            snapshot: Box::new(snapshot),
        };
        let mut prepared = PreparedResearchExportV1 {
            exported_at: "time".into(),
            manifest_json: "{}".into(),
            markdown: "Ω".into(),
            object_count: 1,
            source_count: 0,
        };
        assert!(input.matches_decision(&WorkflowDecisionV1::ResearchExport {
            result: Ok(Box::new(prepared.clone()))
        }));
        prepared.exported_at = "other".into();
        assert!(
            !input.matches_decision(&WorkflowDecisionV1::ResearchExport {
                result: Ok(Box::new(prepared))
            })
        );
        assert!(input.matches_decision(&WorkflowDecisionV1::ResearchExport {
            result: Err(ResearchExportRejectionV1::InvalidSnapshot)
        }));
    }
}
