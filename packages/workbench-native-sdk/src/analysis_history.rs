//! Finite original workflow-history reads, without storage or task ownership.
pub mod contracts;
pub mod rows;
use contracts::PaperAnalysisWorkflow;
use rows::CapturedWorkflowV1;
use serde::{Deserialize, Serialize};

pub const CAPABILITY_ID: &str = "literature.analysis-history";
pub const CAPABILITY_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum HistoryRequestV1 {
    Get { workflow_id: String },
    Latest { paper_id: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryInputV1 {
    pub request: HistoryRequestV1,
    pub workflow: Option<CapturedWorkflowV1>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryWireInputV1 {
    pub cbor_base64: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryWireOutcomeV1 {
    pub input: HistoryWireInputV1,
    pub result_cbor_base64: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
pub enum HistoryRejectionV1 {
    #[error("找不到论文分析工作流")]
    NotFound,
}

pub type HistoryResultV1 = Result<Option<PaperAnalysisWorkflow>, HistoryRejectionV1>;

impl HistoryInputV1 {
    /// Bind the returned tree to the exact rows captured for this invocation.
    /// Field values and historical states remain the domain projector's policy.
    pub fn matches_result(&self, result: &HistoryResultV1) -> bool {
        match (&self.workflow, result) {
            (None, Err(HistoryRejectionV1::NotFound)) => {
                matches!(self.request, HistoryRequestV1::Get { .. })
            }
            (None, Ok(None)) => matches!(self.request, HistoryRequestV1::Latest { .. }),
            (Some(captured), Ok(Some(workflow))) => {
                workflow.id == captured.row.id
                    && workflow.paper_id == captured.row.paper_id
                    && workflow.context_snapshot_id == captured.row.context_snapshot_id
                    && workflow.revision == captured.row.revision
                    && workflow.active_client_request_id.is_none()
                    && workflow.turns.len() == captured.turns.len()
                    && workflow
                        .turns
                        .iter()
                        .zip(&captured.turns)
                        .all(|(turn, captured)| {
                            turn.id == captured.row.id
                                && turn.workflow_id == captured.row.workflow_id
                                && turn.attempts.len() == captured.attempts.len()
                                && turn.attempts.iter().zip(&captured.attempts).all(
                                    |(attempt, row)| {
                                        attempt.id == row.id && attempt.turn_id == row.turn_id
                                    },
                                )
                        })
            }
            _ => false,
        }
    }
}
