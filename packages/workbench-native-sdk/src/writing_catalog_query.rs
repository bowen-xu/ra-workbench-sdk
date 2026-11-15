//! Finite writing-note catalog query plans and original public metadata.
use crate::{data::DataRows, note_catalog_query::PageCatalogQuery};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPage {
    pub items: Vec<CatalogItem>,
    pub revision: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    pub pending_count: i64,
    pub error_count: i64,
    pub issues: Vec<CatalogIssue>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogIssue {
    pub manuscript_id: String,
    pub path: String,
    pub cause: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogItem {
    pub id: String,
    pub title: String,
    pub snippet: String,
    pub category: String,
    pub owner: CatalogOwner,
    pub updated_at: String,
    pub status: String,
    pub is_favorite: bool,
    pub target: CatalogTarget,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CatalogOwner {
    pub kind: String,
    pub id: String,
    pub label: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogTarget {
    pub kind: String,
    pub manuscript_id: String,
    pub path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cursor {
    pub schema: u8,
    pub revision: i64,
    pub scope: String,
    pub id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum QueryOrder {
    TitleUp,
    TitleDown,
    SourceUp,
    SourceDown,
    Category,
    TimeUp,
    TimeDown,
}
impl QueryOrder {
    pub fn asset_key(self) -> &'static str {
        match self {
            Self::TitleUp => "title-up",
            Self::TitleDown => "title-down",
            Self::SourceUp => "source-up",
            Self::SourceDown => "source-down",
            Self::Category => "category",
            Self::TimeUp => "time-up",
            Self::TimeDown => "time-down",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum QueryProblem {
    InvalidInput { cause: String },
    IndexFailed { cause: String },
    CatalogChanged { current_revision: i64 },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum QueryCursor {
    Absent {},
    Ready { cursor: Cursor },
    Rejected { problem: QueryProblem },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueryPlan {
    pub query: PageCatalogQuery,
    pub terms: Vec<QueryTerm>,
    pub order: QueryOrder,
    pub scope: String,
    pub cursor: QueryCursor,
    pub includes: bool,
    pub status: String,
    pub limit: usize,
    pub versions: [String; 3],
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueryTerm {
    pub raw: String,
    pub parameter: String,
    pub scan: bool,
}

/// A closed original read prefix. SQL/row-codec failures remain in Core.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(
    tag = "stage",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum QueryRead {
    CursorBoundary {},
    Excluded {},
    VersionMismatch {
        versions: [String; 3],
    },
    TimestampInvalid {
        manuscript_id: String,
        path: String,
    },
    CursorMissing {},
    Ready {
        counts: DataRows,
        issues: DataRows,
        items: DataRows,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuerySnapshot {
    pub revision: i64,
    pub read: QueryRead,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "phase", rename_all = "camelCase", deny_unknown_fields)]
pub enum QueryInput {
    Prepare {
        query: PageCatalogQuery,
    },
    Project {
        plan: Box<QueryPlan>,
        snapshot: Box<QuerySnapshot>,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "phase", rename_all = "camelCase", deny_unknown_fields)]
pub enum QueryDecision {
    Prepared { plan: Box<QueryPlan> },
    Page { page: CatalogPage },
    Rejected { problem: QueryProblem },
}
