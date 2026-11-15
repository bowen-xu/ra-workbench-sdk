//! Original shared note catalog request shapes.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageCatalogQuery {
    pub category: String,
    pub view: String,
    pub limit: Option<usize>,
    pub cursor: Option<String>,
    pub search: Option<String>,
    pub sort: Option<PageCatalogSort>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageCatalogSort {
    pub field: String,
    pub direction: String,
}
