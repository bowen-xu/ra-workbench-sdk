//! The original seven NAL mutations and their finite owned preparations.
use crate::{nal_annotation::NalAnnotation, nal_state::NalStatement};
use serde::{Deserialize, Serialize};

mod plans;
pub use plans::*;

pub const CAPABILITY_ID: &str = "literature.nal-mutation";
pub const CAPABILITY_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum NalMutation {
    DeleteConcept {
        id: String,
    },
    SetConceptKind {
        concept_id: String,
        concept_kind: String,
    },
    SetTransitivity {
        relation_concept_id: String,
        enabled: bool,
    },
    AddStatements {
        statements: Vec<NalStatement>,
    },
    DeleteStatement {
        id: String,
    },
    LinkAnnotation {
        annotation: NalAnnotation,
    },
    UnlinkAnnotation {
        id: String,
    },
}

#[cfg(test)]
mod tests;
