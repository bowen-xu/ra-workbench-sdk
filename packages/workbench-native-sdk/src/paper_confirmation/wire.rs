//! Finite confirmation stages over request-bound owned values.
use super::{
    PaperConfirmationRequestV1, contracts::*, field::FieldPlanV1, overview::QualifiedOverviewV1,
};
use crate::{
    candidate_contracts::{CandidateValidationError, PaperOverviewField, PaperOverviewPayload},
    candidate_review::contracts::{AiCandidate, AiOverviewFieldConfirmation},
};
use serde::{Deserialize, Serialize};

pub const CAPABILITY_ID: &str = "literature.paper-confirmation";
pub const CAPABILITY_VERSION: u32 = 1;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PaperConfirmationInputV1 {
    Request {
        request: PaperConfirmationRequestV1,
    },
    OverviewReplay {
        requested_candidate_id: String,
        batch_candidate_id: String,
    },
    OverviewCandidate {
        stored_review_state: String,
        candidate: Box<AiCandidate>,
        draft: AiOverviewFieldConfirmationDraft,
    },
    OverviewFields {
        overview: Box<PaperOverviewPayload>,
        requested_fields: Vec<String>,
        confirmed_fields: Vec<AiOverviewFieldConfirmation>,
    },
    OverviewField {
        candidate: Box<AiCandidate>,
        overview: Box<PaperOverviewPayload>,
        field: Box<PaperOverviewField>,
    },
    UndoBatchKey {
        reset_key_exists: bool,
    },
    UndoReplayKey {
        existing_batch_id: Option<String>,
        requested_batch_id: String,
        paper: bool,
    },
    ResetField {
        batch: Box<AiOverviewConfirmationBatch>,
        field_kind: String,
    },
    ResetEligibility {
        field: Box<AiOverviewFieldConfirmation>,
        existing_reset_id: Option<String>,
        legacy_key_exists: bool,
    },
    ResetState {
        field_active: Vec<bool>,
        revision_editor_kinds: Vec<String>,
    },
    Unit {
        scope_key: String,
        input: super::unit::UnitInputV1,
    },
    PaperReplay {
        paper_id: String,
        request_json: String,
        stored_paper_id: String,
        stored_request_json: String,
    },
    PaperExists {
        exists: bool,
    },
    PaperTarget {
        candidate: Box<AiCandidate>,
        paper_id: String,
    },
    MetadataSource {
        field_name: String,
        source: Option<(bool, String)>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PaperConfirmationDecisionV1 {
    Request {
        request: PaperConfirmationRequestV1,
    },
    OverviewReplay {},
    OverviewCandidate {
        qualified: Box<QualifiedOverviewV1>,
    },
    OverviewFields {
        fields: Vec<PaperOverviewField>,
    },
    OverviewField {
        plan: Box<FieldPlanV1>,
    },
    UndoBatchKey {},
    UndoReplayKey {},
    ResetField {
        field: Box<AiOverviewFieldConfirmation>,
    },
    ResetEligibility {
        append: bool,
    },
    ResetState {
        state: String,
    },
    Unit {
        decision: super::unit::UnitDecisionV1,
    },
    PaperReplay {},
    PaperExists {},
    PaperTarget {},
    MetadataSource {
        apply: bool,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperConfirmationWireInputV1 {
    pub cbor_base64: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperConfirmationWireOutcomeV1 {
    pub input: PaperConfirmationWireInputV1,
    pub result_cbor_base64: String,
}
pub type PaperConfirmationResultV1 = Result<PaperConfirmationDecisionV1, CandidateValidationError>;

impl PaperConfirmationInputV1 {
    pub fn matches_result(&self, result: &PaperConfirmationResultV1) -> bool {
        let Ok(decision) = result else { return true };
        if let (Self::Unit { input, .. }, PaperConfirmationDecisionV1::Unit { decision }) =
            (self, decision)
        {
            return input.matches_decision(decision);
        }
        if let (
            Self::Request { request: input },
            PaperConfirmationDecisionV1::Request { request: output },
        ) = (self, decision)
        {
            return std::mem::discriminant(input) == std::mem::discriminant(output);
        }
        matches!(
            (self, decision),
            (
                Self::OverviewReplay { .. },
                PaperConfirmationDecisionV1::OverviewReplay {}
            ) | (
                Self::OverviewCandidate { .. },
                PaperConfirmationDecisionV1::OverviewCandidate { .. }
            ) | (
                Self::OverviewFields { .. },
                PaperConfirmationDecisionV1::OverviewFields { .. }
            ) | (
                Self::OverviewField { .. },
                PaperConfirmationDecisionV1::OverviewField { .. }
            ) | (
                Self::UndoBatchKey { .. },
                PaperConfirmationDecisionV1::UndoBatchKey {}
            ) | (
                Self::UndoReplayKey { .. },
                PaperConfirmationDecisionV1::UndoReplayKey {}
            ) | (
                Self::ResetField { .. },
                PaperConfirmationDecisionV1::ResetField { .. }
            ) | (
                Self::ResetEligibility { .. },
                PaperConfirmationDecisionV1::ResetEligibility { .. }
            ) | (
                Self::ResetState { .. },
                PaperConfirmationDecisionV1::ResetState { .. }
            ) | (Self::Unit { .. }, PaperConfirmationDecisionV1::Unit { .. })
                | (
                    Self::PaperReplay { .. },
                    PaperConfirmationDecisionV1::PaperReplay {}
                )
                | (
                    Self::PaperExists { .. },
                    PaperConfirmationDecisionV1::PaperExists {}
                )
                | (
                    Self::PaperTarget { .. },
                    PaperConfirmationDecisionV1::PaperTarget {}
                )
                | (
                    Self::MetadataSource { .. },
                    PaperConfirmationDecisionV1::MetadataSource { .. }
                )
        )
    }
}
