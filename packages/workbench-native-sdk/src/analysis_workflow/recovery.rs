//! Owned inputs and original candidate-recovery policy. No storage owner.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidateRecoveryInputV1 {
    pub task_kind: String,
    pub candidate_kind: String,
    pub original_payload_hash: String,
    pub revision_payload_hash: String,
    pub payload_json: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidateRecoveryPolicyV1 {
    pub expected_workflow_status: String,
    pub running_workflow_status: String,
    pub completion_with_concept: String,
    pub completion_without_concept: String,
    pub recovery_reasons: [String; 3],
}
