//! Versioned, finite stdio protocol for the read-only writing preview pilot.

use serde::{Deserialize, Serialize, de::DeserializeOwned};

pub const PROTOCOL_VERSION: u32 = 1;
pub const PLUGIN_ID: &str = "writing_projects";
pub const CAPABILITY_ID: &str = "writing.import-preview";
/// Maximum complete wire frame, including its final newline.
pub const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_ERROR_BYTES: usize = 16 * 1024;
const MAX_PREVIEW_FILES: u64 = 10_000;
const MAX_PREVIEW_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub protocol_version: u32,
    pub plugin_id: String,
    pub package_key: String,
    pub instance_id: String,
    pub request_id: String,
    pub body: RequestBody,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum RequestBody {
    Initialize,
    PreviewImport { source_path: String },
    Shutdown,
}

impl<'de> Deserialize<'de> for RequestBody {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        // Serde's internally tagged unit variants ignore extra fields even with
        // deny_unknown_fields. Empty struct variants enforce the same wire rule
        // for initialize/shutdown without changing the public Rust variants.
        #[derive(Deserialize)]
        #[serde(
            tag = "kind",
            rename_all = "camelCase",
            rename_all_fields = "camelCase",
            deny_unknown_fields
        )]
        enum Wire {
            Initialize {},
            PreviewImport { source_path: String },
            Shutdown {},
        }
        Ok(match Wire::deserialize(deserializer)? {
            Wire::Initialize {} => Self::Initialize,
            Wire::PreviewImport { source_path } => Self::PreviewImport { source_path },
            Wire::Shutdown {} => Self::Shutdown,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Response {
    pub protocol_version: u32,
    pub plugin_id: String,
    pub package_key: String,
    pub instance_id: String,
    pub request_id: String,
    pub body: ResponseBody,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ResponseBody {
    Initialized { capability: String, version: u32 },
    PreviewImportResult { outcome: PreviewOutcome },
    ShutdownComplete,
}

impl<'de> Deserialize<'de> for ResponseBody {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(
            tag = "kind",
            rename_all = "camelCase",
            rename_all_fields = "camelCase",
            deny_unknown_fields
        )]
        enum Wire {
            Initialized { capability: String, version: u32 },
            PreviewImportResult { outcome: PreviewOutcome },
            ShutdownComplete {},
        }
        Ok(match Wire::deserialize(deserializer)? {
            Wire::Initialized {
                capability,
                version,
            } => Self::Initialized {
                capability,
                version,
            },
            Wire::PreviewImportResult { outcome } => Self::PreviewImportResult { outcome },
            Wire::ShutdownComplete {} => Self::ShutdownComplete,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase", deny_unknown_fields)]
pub enum PreviewOutcome {
    Success { preview: ImportPreview },
    Failure { error: PreviewFailure },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportPreview {
    pub file_count: u64,
    pub byte_size: u64,
    pub root_candidates: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreviewFailure {
    pub code: PreviewErrorCode,
    pub message: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreviewErrorCode {
    InvalidInput,
    UnsafePath,
    FileTooLarge,
    StorageError,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ProtocolError {
    #[error("native plugin frame exceeds its byte budget")]
    FrameBudget,
    #[error("invalid native plugin JSON frame")]
    InvalidFrame,
    #[error("invalid native plugin envelope")]
    InvalidEnvelope,
    #[error("native plugin response does not match its request")]
    ResponseMismatch,
    #[error("native plugin error exceeds its byte budget")]
    ErrorBudget,
    #[error("native plugin preview exceeds the established result limits")]
    InvalidPreview,
}

impl Response {
    /// Copy the complete request identity; this does not validate the request.
    pub fn for_request(request: &Request, body: ResponseBody) -> Self {
        Self {
            protocol_version: request.protocol_version,
            plugin_id: request.plugin_id.clone(),
            package_key: request.package_key.clone(),
            instance_id: request.instance_id.clone(),
            request_id: request.request_id.clone(),
            body,
        }
    }

    /// Validate the complete identity and the only legal reply kind.
    /// Lifecycle ordering remains the owning host's responsibility.
    pub fn validate_for_request(&self, request: &Request) -> Result<(), ProtocolError> {
        validate_request(request)?;
        validate_response(self)?;
        if self.protocol_version != request.protocol_version
            || self.plugin_id != request.plugin_id
            || self.package_key != request.package_key
            || self.instance_id != request.instance_id
            || self.request_id != request.request_id
            || !matches!(
                (&request.body, &self.body),
                (RequestBody::Initialize, ResponseBody::Initialized { .. })
                    | (
                        RequestBody::PreviewImport { .. },
                        ResponseBody::PreviewImportResult { .. }
                    )
                    | (RequestBody::Shutdown, ResponseBody::ShutdownComplete)
            )
        {
            return Err(ProtocolError::ResponseMismatch);
        }
        Ok(())
    }
}

pub fn validate_request(request: &Request) -> Result<(), ProtocolError> {
    validate_envelope(
        request.protocol_version,
        &request.plugin_id,
        &request.package_key,
        &request.instance_id,
        &request.request_id,
    )
}

pub fn validate_response(response: &Response) -> Result<(), ProtocolError> {
    validate_envelope(
        response.protocol_version,
        &response.plugin_id,
        &response.package_key,
        &response.instance_id,
        &response.request_id,
    )?;
    match &response.body {
        ResponseBody::Initialized {
            capability,
            version,
        } if capability != CAPABILITY_ID || *version != 1 => Err(ProtocolError::InvalidEnvelope),
        ResponseBody::PreviewImportResult {
            outcome: PreviewOutcome::Failure { error },
        } if error.message.len() > MAX_ERROR_BYTES => Err(ProtocolError::ErrorBudget),
        ResponseBody::PreviewImportResult {
            outcome: PreviewOutcome::Success { preview },
        } => validate_preview(preview),
        _ => Ok(()),
    }
}

fn validate_preview(preview: &ImportPreview) -> Result<(), ProtocolError> {
    // Keep the original inspection limits at the receiving boundary, including
    // the legacy path grammar. Do not add sorting or normalization policies.
    if preview.file_count > MAX_PREVIEW_FILES || preview.byte_size > MAX_PREVIEW_BYTES {
        return Err(ProtocolError::InvalidPreview);
    }
    if preview.root_candidates.len() > preview.file_count as usize
        || preview
            .root_candidates
            .iter()
            .any(|path| crate::resource_path::validate_relative_path(path).is_err())
    {
        return Err(ProtocolError::InvalidPreview);
    }
    Ok(())
}

fn validate_envelope(
    version: u32,
    plugin: &str,
    package: &str,
    instance: &str,
    request: &str,
) -> Result<(), ProtocolError> {
    if version != PROTOCOL_VERSION
        || plugin != PLUGIN_ID
        || !crate::wire::valid_identity(package, instance, request)
    {
        return Err(ProtocolError::InvalidEnvelope);
    }
    Ok(())
}

/// Encode one complete bounded wire frame, including its newline.
pub fn encode_request(request: &Request) -> Result<Vec<u8>, ProtocolError> {
    validate_request(request)?;
    encode(request)
}

/// Decode the payload emitted by FrameDecoder, without CRLF/LF delimiters.
pub fn decode_request(frame: &[u8]) -> Result<Request, ProtocolError> {
    let request = decode(frame)?;
    validate_request(&request)?;
    Ok(request)
}

pub fn encode_response(response: &Response) -> Result<Vec<u8>, ProtocolError> {
    validate_response(response)?;
    encode(response)
}

pub fn decode_response(frame: &[u8]) -> Result<Response, ProtocolError> {
    let response = decode(frame)?;
    validate_response(&response)?;
    Ok(response)
}

fn decode<T: DeserializeOwned>(frame: &[u8]) -> Result<T, ProtocolError> {
    crate::wire::decode(frame, MAX_FRAME_BYTES).map_err(wire_error)
}

fn encode(value: &impl Serialize) -> Result<Vec<u8>, ProtocolError> {
    crate::wire::encode(value, MAX_FRAME_BYTES).map_err(wire_error)
}

fn wire_error(error: crate::wire::WireError) -> ProtocolError {
    match error {
        crate::wire::WireError::FrameBudget => ProtocolError::FrameBudget,
        crate::wire::WireError::InvalidFrame => ProtocolError::InvalidFrame,
    }
}

#[cfg(test)]
mod tests;
