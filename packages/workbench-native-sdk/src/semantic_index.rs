//! Original semantic-index wire DTOs. Core retains providers, vectors and storage.
pub use research_semantic_engine_api::{SemanticNamespace, SemanticVectorRow};
use serde::{Deserialize, Serialize};
pub mod rules;

/// Original owned job metadata. Physical engine access remains with Core.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingEmbeddingJob {
    pub job_id: String,
    pub record_id: String,
    pub namespace: SemanticNamespace,
    pub relative_database_path: String,
    pub dimension: usize,
    pub provider_id: String,
    pub model_id: String,
    pub rendered_text: String,
    pub row: SemanticVectorRow,
}

pub fn decode_namespace(value: &str) -> Result<SemanticNamespace, &'static str> {
    match value {
        "accepted_concepts" => Ok(SemanticNamespace::AcceptedConcepts),
        "candidate_staging" => Ok(SemanticNamespace::CandidateStaging),
        "definition_claims" => Ok(SemanticNamespace::DefinitionClaims),
        "source_passages" => Ok(SemanticNamespace::SourcePassages),
        _ => Err("语义索引 namespace 无效"),
    }
}

/// Read the original finite metadata fields in their original failure order.
/// Callers supply scalar readers and retain their SQL error representation.
pub fn decode_pending_job<E>(
    mut text: impl FnMut(usize) -> Result<String, E>,
    mut integer: impl FnMut(usize) -> Result<i64, E>,
    mut invalid: impl FnMut(&'static str) -> E,
) -> Result<PendingEmbeddingJob, E> {
    let namespace = text(2)?;
    let dimension = integer(4)?;
    let generation = integer(14)?;
    let job_id = text(0)?;
    let record_id = text(1)?;
    let namespace = decode_namespace(&namespace).map_err(&mut invalid)?;
    let relative_database_path = text(3)?;
    let dimension = usize::try_from(dimension).map_err(|_| invalid("向量维度无效"))?;
    let provider_id = text(16)?;
    let model_id = text(17)?;
    let rendered_text = text(18)?;
    let row = SemanticVectorRow {
        row_id: text(5)?,
        representation_id: text(6)?,
        subject_kind: text(7)?,
        subject_id: text(8)?,
        subject_revision: integer(9)?,
        representation_kind: text(10)?,
        language: text(11)?,
        input_sha256: text(12)?,
        embedding_space_id: text(13)?,
        generation,
        vector: Vec::new(),
        created_at: text(15)?,
    };
    Ok(PendingEmbeddingJob {
        job_id,
        record_id,
        namespace,
        relative_database_path,
        dimension,
        provider_id,
        model_id,
        rendered_text,
        row,
    })
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingJobSummary {
    pub job_id: String,
    pub representation_id: String,
    pub subject_kind: String,
    pub subject_id: String,
    pub status: String,
    pub attempt: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticIndexSpaceStatus {
    pub embedding_space_id: String,
    pub provider_id: String,
    pub model_id: String,
    pub model_revision: String,
    pub dimension: i64,
    pub generation: i64,
    pub generation_status: String,
    pub namespace: String,
    pub ready_count: i64,
    pub pending_count: i64,
    pub failed_count: i64,
    pub stale_count: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticIndexStatus {
    pub spaces: Vec<SemanticIndexSpaceStatus>,
    pub running_job_ids: Vec<String>,
    pub reconciliation_required: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconciliationSummary {
    pub run_id: String,
    pub status: String,
    pub checked_count: i64,
    pub missing_count: i64,
    pub orphan_count: i64,
    pub repaired_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexGenerationSummary {
    pub generation_id: String,
    pub embedding_space_id: String,
    pub namespace: String,
    pub generation: i64,
    pub status: String,
    pub record_count: i64,
    pub ready_count: i64,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activated_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconciliationGeneration {
    pub namespace: SemanticNamespace,
    pub relative_database_path: String,
    pub dimension: usize,
    pub records: Vec<ReconciliationRecord>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconciliationRecord {
    pub record_id: String,
    pub representation_id: String,
    pub lance_row_id: String,
    pub input_sha256: String,
    pub status: String,
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconciliationCounts {
    pub checked: i64,
    pub missing: i64,
    pub orphan: i64,
    pub repaired: i64,
}

#[cfg(test)]
mod tests;
