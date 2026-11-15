//! Finite inputs and prepared data for the original browser capture protocol.
use crate::catalog_save::{CatalogSaveOutcome, PreparedDoi};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CAPABILITY_ID: &str = "literature.browser-capture";
pub const CAPABILITY_VERSION: u32 = 1;
pub const MAX_METADATA_BYTES: usize = 1024 * 1024;
pub const MAX_PDF_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PdfObservationV1 {
    pub byte_size: usize,
    pub starts_with_pdf: bool,
    pub sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum BrowserCaptureInputV1 {
    Items {
        scope: String,
        payload: Value,
        doi: Vec<PreparedDoi>,
    },
    Snapshot {
        scope: String,
        payload: Value,
    },
    Attachment {
        scope: String,
        session_id: String,
        metadata: Value,
        pdf: PdfObservationV1,
    },
    Standalone {
        scope: String,
        session_id: String,
        metadata: Value,
        pdf: PdfObservationV1,
    },
    SessionStatus {
        scope: String,
        session_id: String,
    },
    UpdateSession {
        scope: String,
        payload: Value,
    },
    RecognizedItem {
        scope: String,
        payload: Value,
    },
    SelectedLibrary {},
    ClientHostnames {},
    DelaySync {},
    AttachmentResolvers {},
    Unsupported {},
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
pub enum CaptureRejectionV1 {
    #[error("Invalid browser capture request")]
    InvalidInput,
    #[error("This connector capability is not supported")]
    Unsupported,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptureIdentifierV1 {
    pub kind: String,
    pub normalized: String,
    pub display: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedCaptureItemV1 {
    pub external_id: String,
    pub raw: Value,
    pub save: CatalogSaveOutcome,
    pub identifiers: Vec<Result<CaptureIdentifierV1, CaptureRejectionV1>>,
    pub source_reference: Value,
    pub receipt: CaptureItemReceiptFieldsV1,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptureItemReceiptFieldsV1 {
    pub id: Value,
    pub item_type: String,
    pub title: String,
    pub warnings: Vec<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedCaptureV1 {
    pub session_id: String,
    pub operation: String,
    pub payload_json: String,
    pub request_sha256: String,
    pub items: Vec<PreparedCaptureItemV1>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedCaptureAttachmentV1 {
    pub original_id: Value,
    pub session_id: String,
    pub external_id: String,
    pub parent_external_id: String,
    pub metadata_json: String,
    pub request_sha256: String,
    pub display_name: String,
    pub source_url: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedStandaloneCaptureV1 {
    pub attachment: PreparedCaptureAttachmentV1,
    pub save: CatalogSaveOutcome,
    pub raw: Value,
    pub source_reference: Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionProjectionV1 {
    Full,
    SessionId,
    Null,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum BrowserCapturePreparationV1 {
    Capture {
        plan: Box<PreparedCaptureV1>,
    },
    Attachment {
        plan: PreparedCaptureAttachmentV1,
    },
    Standalone {
        plan: Box<PreparedStandaloneCaptureV1>,
    },
    Session {
        session_id: String,
        projection: SessionProjectionV1,
    },
    Value {
        value: Value,
    },
    Rejected {
        reason: CaptureRejectionV1,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{CatalogInput, CatalogOperation, CatalogOutput};
    use serde_json::json;

    #[test]
    fn finite_capture_operation_and_owned_input_roundtrip_without_execution_handles() {
        let input = BrowserCaptureInputV1::Items {
            scope: "receiver".into(),
            payload: json!({"sessionID":"capture","items":[{"id":u64::MAX,"extra":-0.0}]}),
            doi: vec![PreparedDoi {
                display: String::new(),
                normalized: String::new(),
            }],
        };
        let request = CatalogInput::PrepareBrowserCapture {
            input: Box::new(input.clone()),
        };
        assert_eq!(request.operation(), CatalogOperation::PrepareBrowserCapture);
        assert_eq!(
            serde_json::from_str::<CatalogInput>(&serde_json::to_string(&request).unwrap())
                .unwrap(),
            request
        );
        let response = CatalogOutput::BrowserCapture {
            input: Box::new(input),
            preparation: Box::new(BrowserCapturePreparationV1::Rejected {
                reason: CaptureRejectionV1::InvalidInput,
            }),
        };
        assert_eq!(response.operation(), request.operation());
        assert_eq!(
            serde_json::from_str::<CatalogOutput>(&serde_json::to_string(&response).unwrap())
                .unwrap(),
            response
        );
        assert!(serde_json::from_value::<CatalogInput>(json!({"kind":"prepareBrowserCapture","input":{"kind":"selectedLibrary","connection":{}}})).is_err());
    }
}
