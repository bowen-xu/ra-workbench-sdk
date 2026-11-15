//! Finite decisions over original index observations. No provider or SQL handles.
use super::{EmbeddingJobSummary, ReconciliationRecord, SemanticIndexSpaceStatus};
use serde::{Deserialize, Serialize};

pub const CAPABILITY_ID: &str = "literature.semantic-index";
pub const CAPABILITY_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "stage", rename_all = "camelCase", deny_unknown_fields)]
pub enum IndexInputV1 {
    Status {
        spaces: Vec<SemanticIndexSpaceStatus>,
    },
    Retry {
        record_status: String,
        latest: Option<EmbeddingJobSummary>,
    },
    Running {
        changed: usize,
    },
    Ready {
        changed: usize,
    },
    Activate {
        status: String,
        pending: i64,
    },
    Space {
        exists: bool,
    },
    RepairState {
        status: String,
    },
    ReconcileRecord {
        record: ReconciliationRecord,
        stored: Option<StoredIndexRowV1>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoredIndexRowV1 {
    pub input_sha256: String,
    pub dataset_version: u64,
    pub vector_norm_bits: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum IndexDecisionV1 {
    Flag {
        value: bool,
    },
    Validated,
    Rejected {
        message: String,
    },
    ReuseJob {
        summary: EmbeddingJobSummary,
        should_start: bool,
    },
    QueueJob,
    Reconcile {
        action: ReconcileActionV1,
    },
}

impl IndexDecisionV1 {
    /// Bind the finite result to Core's scoped observations. Domain decisions
    /// cannot replace a job identity or acknowledge another physical receipt.
    pub fn matches_input(&self, input: &IndexInputV1) -> bool {
        match (input, self) {
            (
                IndexInputV1::Status { .. }
                | IndexInputV1::Activate { .. }
                | IndexInputV1::RepairState { .. },
                Self::Flag { .. },
            ) => true,
            (IndexInputV1::Retry { .. }, Self::QueueJob) => true,
            (
                IndexInputV1::Retry { latest, .. },
                Self::ReuseJob {
                    summary,
                    should_start,
                },
            ) => latest.as_ref() == Some(summary) && *should_start == (summary.status == "queued"),
            (
                IndexInputV1::Running { changed } | IndexInputV1::Ready { changed },
                Self::Validated,
            ) => *changed == 1,
            (IndexInputV1::Space { exists }, Self::Validated) => *exists,
            (
                IndexInputV1::Running { .. }
                | IndexInputV1::Ready { .. }
                | IndexInputV1::Space { .. },
                Self::Rejected { .. },
            ) => true,
            (
                IndexInputV1::ReconcileRecord { record, stored },
                Self::Reconcile {
                    action:
                        ReconcileActionV1::Complete {
                            dataset_version,
                            vector_norm_bits,
                        },
                },
            ) => stored.as_ref().is_some_and(|stored| {
                stored.input_sha256 == record.input_sha256
                    && stored.dataset_version == *dataset_version
                    && stored.vector_norm_bits == *vector_norm_bits
            }),
            (
                IndexInputV1::ReconcileRecord { .. },
                Self::Reconcile {
                    action:
                        ReconcileActionV1::Keep
                        | ReconcileActionV1::Replace
                        | ReconcileActionV1::Missing { .. },
                },
            ) => true,
            _ => false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ReconcileActionV1 {
    Keep,
    Complete {
        dataset_version: u64,
        vector_norm_bits: u32,
    },
    Replace,
    Missing {
        count_repaired: bool,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IndexWireInputV1 {
    pub cbor_base64: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IndexWireOutcomeV1 {
    pub input: Box<IndexWireInputV1>,
    pub decision_cbor_base64: String,
}
