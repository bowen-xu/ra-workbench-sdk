//! Original NAL fact shapes, distinct from the query-pattern language.
use crate::nal_annotation::NalAnnotation;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum NalTerm {
    Concept { id: String },
    Paper { id: String },
    Product { terms: Vec<NalTerm> },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NalConcept {
    pub id: String,
    pub label: String,
    pub explanation: String,
    pub revision: i64,
    pub concept_kind: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NalStatement {
    pub id: String,
    pub subject: NalTerm,
    pub predicate: NalTerm,
    pub origin: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NalState {
    pub revision: i64,
    pub concepts: Vec<NalConcept>,
    pub statements: Vec<NalStatement>,
    pub annotations: Vec<NalAnnotation>,
    pub rules: Vec<NalRule>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NalRule {
    pub id: String,
    pub kind: String,
    pub relation_concept_id: String,
}
