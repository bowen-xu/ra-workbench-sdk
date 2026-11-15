//! Finite writing v2. The original read-only v1 profile remains separate.
use crate::{native_snapshot::SnapshotRef, protocol, wire, writing_project::Operation};
use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 2;
pub const PLUGIN_ID: &str = "writing_projects";
pub const CAPABILITY_ID: &str = "writing.project-files";
pub const CAPABILITY_VERSION: u32 = 1;
pub const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;
pub const INPUT_FAILURE_CODE: &str = "writing_project_input_invalid";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FailureKind {
    InputInvalid,
    StoredJson,
}
impl FailureKind {
    pub fn code(self) -> &'static str {
        match self {
            Self::InputInvalid => INPUT_FAILURE_CODE,
            Self::StoredJson => "storage_error",
        }
    }
}

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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum RequestBody {
    Initialize {},
    Projects {
        operation: Operation,
        snapshot: SnapshotRef,
    },
    PreviewImport {
        source_path: String,
    },
    Shutdown {},
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ResponseBody {
    Initialized {
        capability: String,
        version: u32,
    },
    ProjectResult {
        payload: SnapshotRef,
    },
    ProjectFailure {
        failure: FailureKind,
        message: String,
    },
    PreviewImportResult {
        outcome: protocol::PreviewOutcome,
    },
    ShutdownComplete {},
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ProtocolError {
    #[error("native plugin frame exceeds its byte budget")]
    FrameBudget,
    #[error("invalid native plugin JSON frame")]
    InvalidFrame,
    #[error("invalid writing project plugin envelope")]
    InvalidEnvelope,
    #[error("writing project plugin response does not match its request")]
    ResponseMismatch,
    #[error("invalid request-bound writing project snapshot reference")]
    InvalidSnapshot,
    #[error("native plugin error exceeds its byte budget")]
    ErrorBudget,
    #[error(transparent)]
    Preview(protocol::ProtocolError),
}

impl From<wire::WireError> for ProtocolError {
    fn from(value: wire::WireError) -> Self {
        match value {
            wire::WireError::FrameBudget => Self::FrameBudget,
            wire::WireError::InvalidFrame => Self::InvalidFrame,
        }
    }
}

pub fn input_handle(request_id: &str) -> String {
    format!("project-input-{request_id}.json")
}
pub fn result_handle(request_id: &str) -> String {
    format!("project-result-{request_id}.json")
}

pub fn input_reference(request: &Request, byte_size: u64, sha256: String) -> SnapshotRef {
    SnapshotRef {
        relative_handle: input_handle(&request.request_id),
        byte_size,
        sha256,
        package_key: request.package_key.clone(),
        instance_id: request.instance_id.clone(),
        request_id: request.request_id.clone(),
    }
}

pub fn result_reference(request: &Request, byte_size: u64, sha256: String) -> SnapshotRef {
    SnapshotRef {
        relative_handle: result_handle(&request.request_id),
        ..input_reference(request, byte_size, sha256)
    }
}

fn identity(
    version: u32,
    plugin: &str,
    package: &str,
    instance: &str,
    request: &str,
) -> Result<(), ProtocolError> {
    if version != PROTOCOL_VERSION
        || plugin != PLUGIN_ID
        || !wire::valid_identity(package, instance, request)
    {
        return Err(ProtocolError::InvalidEnvelope);
    }
    Ok(())
}

pub fn validate_request(request: &Request) -> Result<(), ProtocolError> {
    identity(
        request.protocol_version,
        &request.plugin_id,
        &request.package_key,
        &request.instance_id,
        &request.request_id,
    )?;
    if let RequestBody::Projects { snapshot, .. } = &request.body
        && !snapshot.matches(
            &input_handle(&request.request_id),
            &request.package_key,
            &request.instance_id,
            &request.request_id,
        )
    {
        return Err(ProtocolError::InvalidSnapshot);
    }
    Ok(())
}

pub fn validate_response(response: &Response) -> Result<(), ProtocolError> {
    identity(
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
        } if capability != CAPABILITY_ID || *version != CAPABILITY_VERSION => {
            Err(ProtocolError::InvalidEnvelope)
        }
        ResponseBody::ProjectResult { payload }
            if !payload.matches(
                &result_handle(&response.request_id),
                &response.package_key,
                &response.instance_id,
                &response.request_id,
            ) =>
        {
            Err(ProtocolError::InvalidSnapshot)
        }
        ResponseBody::ProjectFailure { message, .. }
            if message.len() > protocol::MAX_ERROR_BYTES =>
        {
            Err(ProtocolError::ErrorBudget)
        }
        ResponseBody::PreviewImportResult { outcome } => {
            // Reuse the unchanged preview DTO, bounds and error budget.
            protocol::validate_response(&protocol::Response {
                protocol_version: protocol::PROTOCOL_VERSION,
                plugin_id: response.plugin_id.clone(),
                package_key: response.package_key.clone(),
                instance_id: response.instance_id.clone(),
                request_id: response.request_id.clone(),
                body: protocol::ResponseBody::PreviewImportResult {
                    outcome: outcome.clone(),
                },
            })
            .map_err(ProtocolError::Preview)
        }
        _ => Ok(()),
    }
}

impl Response {
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
                (RequestBody::Initialize {}, ResponseBody::Initialized { .. })
                    | (
                        RequestBody::Projects { .. },
                        ResponseBody::ProjectResult { .. }
                    )
                    | (
                        RequestBody::Projects { .. },
                        ResponseBody::ProjectFailure { .. }
                    )
                    | (
                        RequestBody::PreviewImport { .. },
                        ResponseBody::PreviewImportResult { .. }
                    )
                    | (RequestBody::Shutdown {}, ResponseBody::ShutdownComplete {})
            )
        {
            return Err(ProtocolError::ResponseMismatch);
        }
        Ok(())
    }
}

pub fn encode_request(request: &Request) -> Result<Vec<u8>, ProtocolError> {
    validate_request(request)?;
    wire::encode(request, MAX_FRAME_BYTES).map_err(Into::into)
}
pub fn decode_request(bytes: &[u8]) -> Result<Request, ProtocolError> {
    let request = wire::decode(bytes, MAX_FRAME_BYTES)?;
    validate_request(&request)?;
    Ok(request)
}
pub fn encode_response(response: &Response) -> Result<Vec<u8>, ProtocolError> {
    validate_response(response)?;
    wire::encode(response, MAX_FRAME_BYTES).map_err(Into::into)
}
pub fn decode_response(bytes: &[u8]) -> Result<Response, ProtocolError> {
    let response = wire::decode(bytes, MAX_FRAME_BYTES)?;
    validate_response(&response)?;
    Ok(response)
}
