//! Finite original reading-history observations and decisions.
pub mod contracts;
use crate::{
    analysis_history::contracts::PaperAnalysisWorkflow,
    paper_context::PaperAiReadingAttachmentStatus, paper_context_prepare::ReadingSessionRowV1,
};
use contracts::*;
use serde::{Deserialize, Serialize};

pub const CAPABILITY_ID: &str = "literature.reading-history";
pub const CAPABILITY_VERSION: u32 = 1;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ReadingHistoryRequestV1 {
    List {
        paper_id: String,
    },
    Session {
        session_id: String,
    },
    Debug {
        turn_id: String,
    },
    Archive {
        session_id: String,
    },
    Bootstrap {
        paper_id: String,
        attachment_ids: Vec<String>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadingDebugRowV1 {
    pub turn_id: String,
    pub raw_request_json: Option<String>,
    pub raw_response_json: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ReadingHistoryInputV1 {
    List {
        rows: Vec<ReadingSessionRowV1>,
    },
    Session {
        summary: Option<Box<ReadingSessionRowV1>>,
        turns: Vec<PaperAiReadingTurn>,
    },
    DebugIdentity {
        turn_id: String,
    },
    DebugRecord {
        row: Option<ReadingDebugRowV1>,
    },
    Archive {
        session_id: String,
    },
    BootstrapSources {
        statuses: Vec<PaperAiReadingAttachmentStatus>,
    },
    BootstrapHistory {
        workflow: Option<Box<PaperAnalysisWorkflow>>,
    },
    BootstrapSnapshot {
        statuses: Vec<PaperAiReadingAttachmentStatus>,
        workflow: Box<PaperAnalysisWorkflow>,
        attachments: Vec<(String, String, String)>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ReadingHistoryDecisionV1 {
    List {
        sessions: Vec<PaperAiReadingSessionSummary>,
    },
    Session {
        session: Box<PaperAiReadingSessionDetail>,
    },
    DebugIdentity {
        turn_id: String,
    },
    DebugRecord {
        data: PaperAiReadingTurnDebugData,
    },
    Archive {
        session_id: String,
    },
    HistoryRequired {},
    SnapshotRequired {
        context_snapshot_id: String,
    },
    Bootstrap {
        options: PaperReadingBootstrapOptions,
    },
    Rejected {
        message: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{CatalogInput, CatalogOperation, CatalogOutput};
    use serde_json::{Value, json};

    #[test]
    fn finite_history_catalog_wire_rejects_unknown_fields_and_keeps_json_values() {
        for input in [
            ReadingHistoryInputV1::List { rows: vec![] },
            ReadingHistoryInputV1::Session {
                summary: None,
                turns: vec![],
            },
            ReadingHistoryInputV1::DebugIdentity {
                turn_id: " Ω ".into(),
            },
            ReadingHistoryInputV1::DebugRecord {
                row: Some(ReadingDebugRowV1 {
                    turn_id: "turn".into(),
                    raw_request_json: Some("null".into()),
                    raw_response_json: Some(format!(
                        "{{\"integer\":{},\"negativeZero\":-0.0}}",
                        u64::MAX
                    )),
                }),
            },
            ReadingHistoryInputV1::Archive {
                session_id: "old".into(),
            },
            ReadingHistoryInputV1::BootstrapSources { statuses: vec![] },
            ReadingHistoryInputV1::BootstrapHistory { workflow: None },
        ] {
            let wire = CatalogInput::ProjectReadingHistory {
                input: Box::new(input.clone()),
            };
            let roundtrip: CatalogInput =
                serde_json::from_slice(&serde_json::to_vec(&wire).unwrap()).unwrap();
            assert_eq!(
                roundtrip.operation(),
                CatalogOperation::ProjectReadingHistory
            );
            let CatalogInput::ProjectReadingHistory { input: decoded } = roundtrip else {
                panic!("history input")
            };
            assert_eq!(*decoded, input);
        }
        let value = json!({"integer":u64::MAX,"negativeZero":-0.0,"text":"Ω"});
        let result = CatalogOutput::ReadingHistory {
            input: Box::new(ReadingHistoryInputV1::DebugRecord { row: None }),
            decision: Box::new(ReadingHistoryDecisionV1::DebugRecord {
                data: PaperAiReadingTurnDebugData {
                    turn_id: "turn".into(),
                    raw_request: Some(Value::Null),
                    raw_response: Some(value),
                },
            }),
        };
        let bytes = serde_json::to_vec(&result).unwrap();
        let decoded: CatalogOutput = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(decoded.operation(), CatalogOperation::ProjectReadingHistory);
        assert_eq!(serde_json::to_vec(&decoded).unwrap(), bytes);
        assert!(
            serde_json::from_value::<ReadingHistoryRequestV1>(
                json!({"kind":"archive","sessionId":"id","sql":"delete"})
            )
            .is_err()
        );
        assert!(
            serde_json::from_value::<PaperAiReadingMessage>(
                json!({"id":"id","role":"user","content":"text","unknown":1})
            )
            .is_err()
        );
    }
}
