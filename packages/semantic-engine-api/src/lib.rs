use std::ffi::c_void;

use serde::{Deserialize, Serialize};

pub const SEMANTIC_ENGINE_ABI_VERSION: u32 = 1;

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct FfiBuffer {
    pub data: *mut u8,
    pub length: usize,
    pub capacity: usize,
}

impl FfiBuffer {
    pub const fn empty() -> Self {
        Self {
            data: std::ptr::null_mut(),
            length: 0,
            capacity: 0,
        }
    }
}

pub type SemanticEngineHandle = *mut c_void;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SemanticNamespace {
    AcceptedConcepts,
    CandidateStaging,
    DefinitionClaims,
    SourcePassages,
}

impl SemanticNamespace {
    pub const fn table_name(self) -> &'static str {
        match self {
            Self::AcceptedConcepts => "accepted_concepts",
            Self::CandidateStaging => "candidate_staging",
            Self::DefinitionClaims => "definition_claims",
            Self::SourcePassages => "source_passages",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OpenRequest {
    pub schema_version: u32,
    pub database_path: String,
    pub namespace: SemanticNamespace,
    pub dimension: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SemanticVectorRow {
    pub row_id: String,
    pub representation_id: String,
    pub subject_kind: String,
    pub subject_id: String,
    pub subject_revision: i64,
    pub representation_kind: String,
    pub language: String,
    pub input_sha256: String,
    pub embedding_space_id: String,
    pub generation: i64,
    pub vector: Vec<f32>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum EngineRequest {
    EnsureReady,
    Upsert {
        row: SemanticVectorRow,
    },
    Contains {
        row_id: String,
        input_sha256: String,
    },
    ListMetadata,
    Search {
        query: Vec<f32>,
        limit: usize,
    },
    Delete {
        row_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SemanticVectorSearchHit {
    pub row_id: String,
    pub representation_id: String,
    pub subject_id: String,
    pub subject_revision: i64,
    pub distance: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct VectorWriteReceipt {
    pub dataset_version: u64,
    pub inserted_rows: u64,
    pub updated_rows: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredVectorMetadata {
    pub row_id: String,
    pub input_sha256: String,
    pub vector_norm: f32,
    pub dataset_version: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "result", content = "value", rename_all = "snake_case")]
pub enum EngineResponse {
    Opened,
    Ready(u64),
    Upserted(VectorWriteReceipt),
    Contains(bool),
    Metadata(Vec<StoredVectorMetadata>),
    SearchHits(Vec<SemanticVectorSearchHit>),
    Deleted(u64),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EngineErrorResponse {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", content = "payload", rename_all = "snake_case")]
pub enum EngineEnvelope {
    Ok(EngineResponse),
    Error(EngineErrorResponse),
}
