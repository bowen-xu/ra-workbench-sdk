//! Original NAL query collection data shapes and structural JSON codecs only.
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

pub const CAPABILITY_ID: &str = "literature.nal-query-collections";
pub const CAPABILITY_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Pattern {
    Concept {
        id: String,
    },
    Paper {
        id: String,
    },
    Variable {
        name: String,
    },
    Product {
        terms: Vec<Pattern>,
    },
    Conjunction {
        terms: Vec<Pattern>,
    },
    Disjunction {
        terms: Vec<Pattern>,
    },
    Statement {
        #[serde(default)]
        copula: Copula,
        subject: Box<Pattern>,
        predicate: Box<Pattern>,
    },
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Copula {
    #[default]
    Inheritance,
    Implication,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StatementCondition {
    #[serde(default)]
    pub copula: Copula,
    pub subject: Pattern,
    pub predicate: Pattern,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(untagged)]
pub enum Condition {
    Statement(StatementCondition),
    Group(GroupCondition),
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GroupKind {
    Group,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GroupConnector {
    Conjunction,
    Disjunction,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GroupCondition {
    pub kind: GroupKind,
    pub connector: GroupConnector,
    pub children: Vec<Condition>,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Definition {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    pub conditions: Vec<Condition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_variables: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_mode: Option<OutputMode>,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputMode {
    All,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Content {
    pub definitions: Vec<Definition>,
    pub cache: Option<Value>,
    pub legacy_imported: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stored {
    pub revision: i64,
    #[serde(flatten)]
    pub content: Content,
}

// A flat helper preserves the original serialized shape without combining
// serde's unsupported flatten + deny_unknown_fields deserialization features.
impl<'de> Deserialize<'de> for Stored {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Wire {
            revision: i64,
            definitions: Vec<Definition>,
            cache: Option<Value>,
            legacy_imported: bool,
        }
        let value = Wire::deserialize(deserializer)?;
        Ok(Self {
            revision: value.revision,
            content: Content {
                definitions: value.definitions,
                cache: value.cache,
                legacy_imported: value.legacy_imported,
            },
        })
    }
}

/// Owned original row values. JSON strings keep their original parse boundary.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoredRow {
    pub revision: i64,
    pub definitions_json: String,
    pub cache_json: Option<String>,
    pub legacy_imported: bool,
}

impl StoredRow {
    /// Match the original read: definitions parse before optional opaque cache.
    /// Semantic validation is intentionally not part of a storage read.
    pub fn decode(self) -> Result<Stored, serde_json::Error> {
        Ok(Stored {
            revision: self.revision,
            content: SavePlan {
                definitions_json: self.definitions_json,
                cache_json: self.cache_json,
                legacy_imported: self.legacy_imported,
            }
            .decode_content()?,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavePlan {
    pub definitions_json: String,
    pub cache_json: Option<String>,
    pub legacy_imported: bool,
}

impl SavePlan {
    /// Mechanical original bindings only; this does not perform validation or
    /// authorize a write. Separate nullable JSON text preserves Some(Null).
    pub fn encode(content: &Content) -> Result<Self, serde_json::Error> {
        Ok(Self {
            definitions_json: serde_json::to_string(&content.definitions)?,
            cache_json: content
                .cache
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?,
            legacy_imported: content.legacy_imported,
        })
    }

    pub fn decode_content(self) -> Result<Content, serde_json::Error> {
        Ok(Content {
            definitions: serde_json::from_str(&self.definitions_json)?,
            cache: self
                .cache_json
                .map(|cache| serde_json::from_str(&cache))
                .transpose()?,
            legacy_imported: self.legacy_imported,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Rejection {
    TooLarge,
    InvalidDefinition,
    InvalidHierarchy,
    MissingParent,
    InvalidOutputVariables,
    InvalidStructure,
}

impl<'de> Deserialize<'de> for Rejection {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
        enum Wire {
            TooLarge {},
            InvalidDefinition {},
            InvalidHierarchy {},
            MissingParent {},
            InvalidOutputVariables {},
            InvalidStructure {},
        }
        Ok(match Wire::deserialize(deserializer)? {
            Wire::TooLarge {} => Self::TooLarge,
            Wire::InvalidDefinition {} => Self::InvalidDefinition,
            Wire::InvalidHierarchy {} => Self::InvalidHierarchy,
            Wire::MissingParent {} => Self::MissingParent,
            Wire::InvalidOutputVariables {} => Self::InvalidOutputVariables,
            Wire::InvalidStructure {} => Self::InvalidStructure,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(tag = "status", rename_all = "camelCase", deny_unknown_fields)]
pub enum PrepareOutcome {
    Planned { plan: SavePlan },
    Rejected { reason: Rejection },
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(tag = "status", rename_all = "camelCase", deny_unknown_fields)]
pub enum ProjectionOutcome {
    Success { row: StoredRow },
    Rejected { reason: Rejection },
}

#[cfg(test)]
mod tests;
