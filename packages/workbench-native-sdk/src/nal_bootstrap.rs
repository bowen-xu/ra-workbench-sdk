//! Closed, owned observations for the original NAL startup chain only.
mod plans;
mod probes;
mod source;

pub use plans::*;
pub use probes::*;
pub use source::*;

pub const CAPABILITY_ID: &str = "literature.nal-bootstrap";
pub const CAPABILITY_VERSION: u32 = 1;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "camelCase", deny_unknown_fields)]
pub enum SourceProbe<T> {
    Skipped {},
    Available { value: T },
    Deferred {},
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BootstrapPhaseV1 {
    LegacyHeader,
    Collections,
    TermValidation,
    TermLookup,
    TermInsert,
    TermReadback,
    TermRevision,
    ConceptNameCollision,
    ConceptValidation,
    ConceptNameAvailability,
    ConceptInsert,
    PreferredLink,
    ConceptReadback,
    ConceptRevision,
    SemanticRender,
    RepresentationLookup,
    RepresentationInsert,
    EmbeddingSettings,
    SpaceInsert,
    ActiveGeneration,
    NextGeneration,
    GenerationInsert,
    QueueLookup,
    RecordInsert,
    JobInsert,
    RelationTypes,
    RelatedFieldExistence,
    Relations,
    Memberships,
    Assignments,
    ImportFlag,
    RepairVersion,
    RepairRecords,
    RepairRole,
    RepairTermDecode,
    RepairFlag,
    CleanupExistence,
    CleanupLoad,
    CleanupDelete,
    StateRevision,
    StateConcepts,
    StateStatements,
    StateAnnotations,
    StateRules,
    FinalLoad,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BootstrapInputV1 {
    pub source: BootstrapSourceV1,
    pub probes: BootstrapProbePreparationV1,
    pub facts: BootstrapProbeFactsV1,
    pub identities: BootstrapIdentitiesV1,
}

#[cfg(test)]
mod tests;
