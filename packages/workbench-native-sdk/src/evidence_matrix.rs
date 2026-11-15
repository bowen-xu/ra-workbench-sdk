//! Original matrix DTOs and finite validation observations; no storage owner.
use serde::{Deserialize, Serialize};
pub const CAPABILITY_ID: &str = "literature.evidence-matrix";

/// Stages follow the original interleaving with Core's project/anchor queries.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MatrixValidationInputV1 {
    Matrix {
        draft: EvidenceMatrixDraft,
    },
    Cell {
        draft: EvidenceMatrixCellDraft,
        matrix: EvidenceMatrix,
    },
    Statement {
        statement: EvidenceMatrixStatement,
        prior_statement_ids: Vec<String>,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MatrixValidationDecisionV1 {
    pub rejection: Option<MatrixRejectionV1>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MatrixRejectionV1 {
    Matrix,
    Cell,
    Statement,
}
impl MatrixRejectionV1 {
    pub fn message(self) -> &'static str {
        match self {
            Self::Matrix => "证据矩阵参数无效",
            Self::Cell => "证据矩阵单元参数无效",
            Self::Statement => "矩阵陈述参数无效",
        }
    }
}
impl MatrixValidationInputV1 {
    /// A child may reject only the current stage, never substitute another rule.
    pub fn matches_decision(&self, value: &MatrixValidationDecisionV1) -> bool {
        value.rejection.is_none_or(|reason| {
            matches!(
                (self, reason),
                (Self::Matrix { .. }, MatrixRejectionV1::Matrix)
                    | (Self::Cell { .. }, MatrixRejectionV1::Cell)
                    | (Self::Statement { .. }, MatrixRejectionV1::Statement)
            )
        })
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceMatrixDimension {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceMatrixDraft {
    pub id: Option<String>,
    pub project_id: String,
    pub title: String,
    pub paper_ids: Vec<String>,
    pub dimensions: Vec<EvidenceMatrixDimension>,
    pub expected_revision: Option<i64>,
    pub change_reason: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceMatrix {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub paper_ids: Vec<String>,
    pub dimensions: Vec<EvidenceMatrixDimension>,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceMatrixStatement {
    pub id: String,
    pub text: String,
    pub epistemic_role: String,
    pub evidence_anchor_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceMatrixCellDraft {
    pub matrix_id: String,
    pub paper_id: String,
    pub dimension_id: String,
    pub coverage_state: String,
    #[serde(default)]
    pub coverage_note: String,
    #[serde(default)]
    pub statements: Vec<EvidenceMatrixStatement>,
    pub expected_revision: Option<i64>,
    pub change_reason: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceMatrixCell {
    pub id: String,
    pub matrix_id: String,
    pub paper_id: String,
    pub dimension_id: String,
    pub coverage_state: String,
    pub coverage_note: String,
    pub statements: Vec<EvidenceMatrixStatement>,
    pub provenance_kind: String,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}
