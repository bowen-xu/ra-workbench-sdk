//! Original stored duplicate-merge snapshots, without merge policy or IO.
pub use snapshot::{
    Assignment as CollectionAssignment, Membership as CollectionMembership,
    MergeClassification as MergeClassificationSnapshot, MergeNal as MergeNalSnapshot,
    MergeSnapshot as DuplicateMergeSnapshot,
};

// Keep the original Rust declaration names as well as the JSON field names:
// serde's derived visitor uses them in wrong-type and invalid-length errors.
mod snapshot {
    use crate::{nal_annotation::NalAnnotation, nal_state::NalStatement};
    use serde::{Deserialize, Serialize};

    /// Original outer snapshot: unknown fields remain tolerated for stored history.
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct MergeSnapshot {
        #[serde(default)]
        pub classification: Option<MergeClassification>,
        pub candidate_id: String,
        pub attachment_ids: Vec<String>,
        pub identifier_ids: Vec<String>,
        pub anchor_ids: Vec<String>,
        pub added_project_ids: Vec<String>,
        pub added_tag_ids: Vec<String>,
        pub added_provenance_fields: Vec<String>,
        pub created_reading_state: bool,
        pub merged_archived_at: Option<String>,
    }

    /// Original classification snapshot, including its optional legacy NAL part.
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct MergeClassification {
        #[serde(default)]
        pub nal: Option<MergeNal>,
        pub before_memberships: Vec<Membership>,
        pub before_assignments: Vec<Assignment>,
        pub after_memberships: Vec<Membership>,
        pub after_assignments: Vec<Assignment>,
    }

    /// These four historical field names intentionally remain snake_case.
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct MergeNal {
        pub before: Vec<NalStatement>,
        pub after: Vec<NalStatement>,
        pub before_annotations: Vec<NalAnnotation>,
        pub after_annotations: Vec<NalAnnotation>,
    }

    #[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub struct Membership {
        pub item_id: String,
        pub collection_id: String,
    }

    #[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub struct Assignment {
        pub item_id: String,
        pub relation_id: String,
    }
}

#[cfg(test)]
mod tests;
