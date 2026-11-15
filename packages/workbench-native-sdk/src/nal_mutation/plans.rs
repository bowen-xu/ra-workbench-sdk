use crate::{
    nal_annotation::NalAnnotation,
    nal_annotation_prepare::NalAnnotationLinkPreparation,
    nal_bootstrap::{BootstrapInputV1, BootstrapPreparationV1},
    nal_state::NalRule,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NalMutationPrepareInput {
    pub bootstrap: BootstrapInputV1,
    pub mutation_json: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NalMutationPreparation {
    pub bootstrap: BootstrapPreparationV1,
    pub decision: NalMutationDecision,
    pub rule_projection: Vec<NalRule>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NalMutationRejection {
    TermStructureTooLarge,
    ProductArity,
    InvalidTermIdentity,
    MissingTerm,
    InvalidConceptKind,
    ConceptUsedAsRelation,
    NotRelation,
    InvalidStatementCount,
    InvalidStatementIdentityOrOrigin,
    MissingConcept,
    MissingStatement,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum NalMutationDecision {
    DeferredAfterBootstrap {},
    Prepared { mutation: Box<NalMutationPlan> },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum NalMutationPlan {
    DeleteConcept {
        id: String,
        missing_rejection: NalMutationRejection,
    },
    SetConceptKind {
        concept_id: String,
        term: NalTermPreparation,
        after_term: NalConceptKindPreparation,
    },
    SetTransitivity {
        relation_concept_id: String,
        term: NalTermPreparation,
        action: NalTransitivityAction,
    },
    AddStatements {
        batch: NalStatementBatchPreparation,
    },
    DeleteStatement {
        id: String,
        missing_rejection: NalMutationRejection,
    },
    LinkAnnotation {
        annotation: NalAnnotation,
        link: NalAnnotationLinkPreparation,
    },
    UnlinkAnnotation {
        id: String,
    },
}

/// A Product is complete or ends in a rejecting child prefix. A successful
/// short prefix must never stand in for unvalidated trailing original terms.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum NalTermPreparation {
    Rejected {
        reason: NalMutationRejection,
    },
    Product {
        terms: Vec<NalTermPreparation>,
    },
    Concept {
        id: String,
        missing_rejection: NalMutationRejection,
    },
    Paper {
        id: String,
        missing_rejection: NalMutationRejection,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum NalConceptKindPreparation {
    Rejected {
        reason: NalMutationRejection,
    },
    ReadUsage {
        concept_kind: String,
        on_used: NalUsageCondition,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum NalUsageCondition {
    Continue {},
    Reject { reason: NalMutationRejection },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum NalTransitivityAction {
    Enable {
        missing_rejection: NalMutationRejection,
    },
    Disable {},
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum NalStatementBatchPreparation {
    Rejected {
        reason: NalMutationRejection,
    },
    Prepared {
        statements: Vec<NalStatementPreparation>,
    },
}

/// Statements are inserted one at a time. A rejecting entry terminates the
/// prepared prefix; later identity or term rejection cannot skip earlier SQL.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum NalStatementPreparation {
    RejectedIdentity {
        id: String,
        origin: String,
        reason: NalMutationRejection,
    },
    SubjectRejected {
        id: String,
        origin: String,
        subject: NalTermPreparation,
    },
    PredicateRejected {
        id: String,
        origin: String,
        subject: NalTermPreparation,
        predicate: NalTermPreparation,
    },
    Ready {
        id: String,
        origin: String,
        subject: NalTermPreparation,
        predicate: NalTermPreparation,
        subject_json: String,
        predicate_json: String,
    },
}
