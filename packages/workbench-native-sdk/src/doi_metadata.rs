//! Owned results of the original DOI HTTP reads. No client or network authority.
use serde::{Deserialize, Serialize};

pub const CAPABILITY_ID: &str = "literature.doi-preview";
pub const CAPABILITY_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DoiHttpBodyV1 {
    pub content_type: String,
    pub body: String,
    pub final_https: bool,
}

/// The HTTP adapter captures safe Display causes, never Debug/source chains,
/// proxy configuration, credentials, request bodies or provider response dumps.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DoiHttpErrorV1 {
    InvalidResolver { cause: String },
    Client { cause: String },
    Send { cause: String },
    NotFound {},
    Status { status: u16, cause: String },
    TooLarge { status: u16 },
    Read { status: u16, cause: String },
    Utf8 { status: u16, cause: String },
}

/// Original candidate response field order, including its omitted empty warnings.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataPreviewV1 {
    pub id: String,
    pub import_job_id: String,
    pub item_id: Option<String>,
    pub source_kind: String,
    pub source_reference: String,
    pub draft: crate::catalog_save::CatalogDraft,
    pub diffs: Vec<crate::metadata::MetadataFieldDiff>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DoiTranslationV1 {
    pub draft: crate::catalog_save::CatalogDraft,
    pub raw_payload: String,
    pub source_kind: String,
    pub warnings: Vec<String>,
}

/// One closed preview workflow. Core supplies only its original IO/ID facts.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DoiPreviewInputV1 {
    Start {
        raw_input: String,
        normalized_doi: Option<String>,
    },
    Translate {
        normalized_doi: String,
        resolver: Result<DoiHttpBodyV1, DoiHttpErrorV1>,
        publisher: Option<Result<DoiHttpBodyV1, DoiHttpErrorV1>>,
    },
    Candidate {
        id: String,
        import_job_id: String,
        item_id: Option<String>,
        normalized_doi: String,
        translation: Box<DoiTranslationV1>,
        current: Option<crate::catalog::CatalogItemRows>,
        current_normalized_doi: String,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DoiPreviewOutcomeV1 {
    Started {
        normalized_doi: String,
        source_kind: String,
        finish_states: crate::import_jobs::ImportFinishStatesV1,
        resolver_accept: String,
        publisher_accept: String,
        resolver_limit: usize,
        publisher_limit: usize,
    },
    NeedsPublisher {},
    Translated {
        translation: DoiTranslationV1,
    },
    Candidate {
        preview: MetadataPreviewV1,
        raw_payload: String,
    },
    Rejected {
        code: String,
        message: String,
    },
}

#[cfg(test)]
#[path = "doi_metadata/preview_wire_tests.rs"]
mod preview_wire_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn http_results_preserve_known_status_and_safe_cause() {
        for error in [
            DoiHttpErrorV1::InvalidResolver {
                cause: "synthetic URL".into(),
            },
            DoiHttpErrorV1::Client {
                cause: "synthetic client".into(),
            },
            DoiHttpErrorV1::Send {
                cause: "synthetic send".into(),
            },
            DoiHttpErrorV1::NotFound {},
            DoiHttpErrorV1::Status {
                status: 503,
                cause: "synthetic status".into(),
            },
            DoiHttpErrorV1::TooLarge { status: 200 },
            DoiHttpErrorV1::Read {
                status: 200,
                cause: "synthetic read".into(),
            },
            DoiHttpErrorV1::Utf8 {
                status: 200,
                cause: "synthetic UTF-8".into(),
            },
        ] {
            let encoded = serde_json::to_value(&error).unwrap();
            assert_eq!(
                serde_json::from_value::<DoiHttpErrorV1>(encoded).unwrap(),
                error
            );
        }
        assert_eq!(
            serde_json::to_value(DoiHttpErrorV1::NotFound {}).unwrap(),
            json!({"kind":"notFound"})
        );
        let body = DoiHttpBodyV1 {
            content_type: "application/json".into(),
            body: "{\"raw\":true}".into(),
            final_https: true,
        };
        let wire =
            json!({"contentType":"application/json","body":"{\"raw\":true}","finalHttps":true});
        assert_eq!(serde_json::to_value(&body).unwrap(), wire);
        assert_eq!(serde_json::from_value::<DoiHttpBodyV1>(wire).unwrap(), body);
    }

    #[test]
    fn http_contract_rejects_unknown_and_incomplete_shapes() {
        for invalid in [
            json!({"kind":"invalidResolver","cause":"safe","url":"forbidden"}),
            json!({"kind":"client"}),
            json!({"kind":"send","cause":"safe","proxy":"forbidden"}),
            json!({"kind":"status","cause":"safe"}),
            json!({"kind":"notFound","cause":"extra"}),
            json!({"kind":"arbitraryRequest","url":"https://example.invalid"}),
        ] {
            assert!(serde_json::from_value::<DoiHttpErrorV1>(invalid).is_err());
        }
        assert!(
            serde_json::from_value::<DoiHttpBodyV1>(json!({"body":"x","contentType":"x"})).is_err()
        );
    }
}
