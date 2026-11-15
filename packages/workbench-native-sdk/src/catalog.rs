//! Finite literature domain calls. No SQL, connection, clock or execution owner.
use crate::data::DataRows;
use serde::{Deserialize, Serialize};
pub mod bibliography;
mod input;
mod output;
pub use input::CatalogInput;
pub use output::CatalogOutput;

pub const CAPABILITY_ID: &str = "literature.catalog-read";
pub const CAPABILITY_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CatalogOperation {
    BibliographySearch,
    PlanBibliographyCandidates,
    Plan,
    Select,
    Project,
    PrepareSave,
    ReadNalQueries,
    PrepareNalQuerySave,
    PrepareNalBootstrapProbes,
    PrepareNalBootstrap,
    ValidateNalAnnotation,
    PrepareNalAnnotation,
    PrepareNalMutation,
    ProjectDuplicateCandidates,
    ProjectMergeOperations,
    PrepareDuplicateDecision,
    FinishDuplicateDecision,
    PrepareDuplicateUndo,
    PrepareDuplicateMerge,
    PrepareLiteratureLifecycle,
    PrepareTrashCleanup,
    PrepareMetadata,
    PrepareBibtex,
    ProjectImportJobs,
    DoiPreview,
    PrepareReferenceRecord,
    ValidateEvidenceMatrix,
    DecideDerivedView,
    ValidateEvidenceWrite,
    PrepareLiteratureAttachment,
    PreparePdfImportHeader,
    DecodePdfImportCandidate,
    PrepareResearchConcept,
    PrepareReadingUnit,
    ValidateStructured,
    SelectUnreviewedFields,
    ValidateEditableTemplate,
    PreparePaperContext,
    DecidePaperRetrievalTrace,
    PrepareConceptRetrieval,
    PrepareSemanticIndex,
    ProjectContextMetadata,
    ProjectAnalysisHistory,
    DecideAnalysisWorkflow,
    PrepareBrowserCapture,
    ProjectReadingHistory,
    PreparePaperConfirmation,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CatalogRequest {
    List { query: Option<String> },
    Get { id: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CatalogQueryPlan {
    All,
    Search {
        fts_query: String,
        year: Option<i32>,
    },
    Get {
        id: String,
    },
}

impl<'de> Deserialize<'de> for CatalogQueryPlan {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(
            tag = "kind",
            rename_all = "camelCase",
            rename_all_fields = "camelCase",
            deny_unknown_fields
        )]
        enum Wire {
            All {},
            Search {
                fts_query: String,
                year: Option<i32>,
            },
            Get {
                id: String,
            },
        }
        Ok(match Wire::deserialize(deserializer)? {
            Wire::All {} => Self::All,
            Wire::Search { fts_query, year } => Self::Search { fts_query, year },
            Wire::Get { id } => Self::Get { id },
        })
    }
}

/// Preserve both original ID streams. The domain, not Core, combines them.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogSelectionRows {
    pub primary: DataRows,
    pub year: Option<DataRows>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogRelatedRows {
    pub creators: DataRows,
    pub tags: DataRows,
    pub attachments: DataRows,
    pub project_ids: DataRows,
    pub metadata_sources: DataRows,
}

/// Main is the original query_row/optional result, not a second list query.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogItemRows {
    pub main: DataRows,
    pub related: Option<CatalogRelatedRows>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogProjectionInput {
    pub request: CatalogRequest,
    pub items: Vec<CatalogItemRows>,
}

/// This existing DTO also remains an input in the legacy LiteratureDraft.
/// Preserve its historical defaults and unknown-field tolerance there.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogCreator {
    pub family_name: String,
    pub given_name: String,
    #[serde(default)]
    pub literal_name: String,
    #[serde(default = "author_role")]
    pub role: String,
}

fn author_role() -> String {
    "author".to_owned()
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogAttachment {
    pub id: String,
    pub display_name: String,
    pub mime_type: String,
    pub byte_size: u64,
    pub content_sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogMetadataSource {
    pub field_name: String,
    pub source_kind: String,
    pub confirmed_by_user: bool,
}

/// Field order and nullable/skip rules match the original LiteratureItem JSON.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogItem {
    pub id: String,
    pub item_type: String,
    pub title: String,
    pub abstract_text: String,
    pub issued_year: Option<i32>,
    pub container_title: String,
    pub conference_name: String,
    pub proceedings_title: String,
    pub place: String,
    pub volume: String,
    pub issue: String,
    pub pages: String,
    pub doi: String,
    pub url: String,
    pub language: String,
    pub bibtex_key: String,
    pub raw_bibtex: Option<String>,
    pub reading_status: String,
    pub creators: Vec<CatalogCreator>,
    pub tags: Vec<String>,
    pub attachments: Vec<CatalogAttachment>,
    pub project_ids: Vec<String>,
    pub metadata_sources: Vec<CatalogMetadataSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trashed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CatalogProjectionOutcome {
    Success { items: Vec<CatalogItem> },
    NotFound,
}

impl<'de> Deserialize<'de> for CatalogProjectionOutcome {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(
            tag = "kind",
            rename_all = "camelCase",
            rename_all_fields = "camelCase",
            deny_unknown_fields
        )]
        enum Wire {
            Success { items: Vec<CatalogItem> },
            NotFound {},
        }
        Ok(match Wire::deserialize(deserializer)? {
            Wire::Success { items } => Self::Success { items },
            Wire::NotFound {} => Self::NotFound,
        })
    }
}

#[cfg(test)]
#[path = "catalog/tests.rs"]
mod tests;

#[cfg(test)]
#[path = "catalog/bootstrap_tests.rs"]
mod bootstrap_tests;

#[cfg(test)]
#[path = "catalog/metadata_wire.rs"]
mod metadata_wire;
