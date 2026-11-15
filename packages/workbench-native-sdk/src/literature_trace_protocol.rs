//! Finite v2 literature wire: original trace and explicitly capability-gated catalog reads.
//! The snapshot is input only. It grants no SQL, Core context or write authority.
use crate::{
    catalog::CatalogOperation,
    retrieval_trace::{MarkSentCondition, RetrievalTraceRow, TraceRejection},
    wire::{self, WireError},
};
use serde::{Deserialize, Deserializer, Serialize};

pub const PROTOCOL_VERSION: u32 = 2;
pub const PLUGIN_ID: &str = "literature_library";
pub const CAPABILITY_ID: &str = "literature.note-trace-decision";
pub const CAPABILITY_VERSION: u32 = 1;
/// Only protocol frames are bounded here, not the original trace input.
pub const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;

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
    rename_all_fields = "camelCase"
)]
pub enum RequestBody {
    Initialize,
    DecideNoteTrace {
        snapshot: SnapshotRef,
    },
    Catalog {
        operation: CatalogOperation,
        snapshot: SnapshotRef,
    },
    Shutdown,
}

impl<'de> Deserialize<'de> for RequestBody {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(
            tag = "kind",
            rename_all = "camelCase",
            rename_all_fields = "camelCase",
            deny_unknown_fields
        )]
        enum Wire {
            Initialize {},
            DecideNoteTrace {
                snapshot: SnapshotRef,
            },
            Catalog {
                operation: CatalogOperation,
                snapshot: SnapshotRef,
            },
            Shutdown {},
        }
        Ok(match Wire::deserialize(deserializer)? {
            Wire::Initialize {} => Self::Initialize,
            Wire::DecideNoteTrace { snapshot } => Self::DecideNoteTrace { snapshot },
            Wire::Catalog {
                operation,
                snapshot,
            } => Self::Catalog {
                operation,
                snapshot,
            },
            Wire::Shutdown {} => Self::Shutdown,
        })
    }
}

pub use crate::native_snapshot::SnapshotRef;

impl SnapshotRef {
    pub fn for_request(request: &Request, byte_size: u64, sha256: String) -> Self {
        Self {
            relative_handle: snapshot_handle(&request.request_id),
            byte_size,
            sha256,
            package_key: request.package_key.clone(),
            instance_id: request.instance_id.clone(),
            request_id: request.request_id.clone(),
        }
    }

    pub fn catalog_input(request: &Request, byte_size: u64, sha256: String) -> Self {
        Self {
            relative_handle: catalog_input_handle(&request.request_id),
            ..Self::for_request(request, byte_size, sha256)
        }
    }

    pub fn catalog_result(request: &Request, byte_size: u64, sha256: String) -> Self {
        Self {
            relative_handle: catalog_result_handle(&request.request_id),
            ..Self::for_request(request, byte_size, sha256)
        }
    }
}

pub fn snapshot_handle(request_id: &str) -> String {
    format!("note-trace-{request_id}.json")
}

pub fn catalog_input_handle(request_id: &str) -> String {
    format!("catalog-input-{request_id}.json")
}
pub fn catalog_result_handle(request_id: &str) -> String {
    format!("catalog-result-{request_id}.json")
}

/// Exact observed domain input. Ordinary Note Page scope is always None.
/// No body budget, trimming, UUID rule or SQL-time calculation is added here.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SnapshotInput {
    pub query: String,
    #[serde(deserialize_with = "required_row")]
    pub row: Option<RetrievalTraceRow>,
}

fn required_row<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<RetrievalTraceRow>, D::Error> {
    Option::deserialize(deserializer)
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
    rename_all_fields = "camelCase"
)]
pub enum ResponseBody {
    Initialized { capability: String, version: u32 },
    NoteTraceDecision { decision: TraceDecision },
    CatalogResult { payload: SnapshotRef },
    ShutdownComplete,
}

impl<'de> Deserialize<'de> for ResponseBody {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(
            tag = "kind",
            rename_all = "camelCase",
            rename_all_fields = "camelCase",
            deny_unknown_fields
        )]
        enum Wire {
            Initialized { capability: String, version: u32 },
            NoteTraceDecision { decision: TraceDecision },
            CatalogResult { payload: SnapshotRef },
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
            Wire::NoteTraceDecision { decision } => Self::NoteTraceDecision { decision },
            Wire::CatalogResult { payload } => Self::CatalogResult { payload },
            Wire::ShutdownComplete {} => Self::ShutdownComplete,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum TraceDecision {
    Ready { mark_sent: MarkSentCondition },
    Rejected { reason: TraceRejection },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ProtocolError {
    #[error("native plugin frame exceeds its byte budget")]
    FrameBudget,
    #[error("invalid native plugin JSON frame")]
    InvalidFrame,
    #[error("invalid literature plugin envelope")]
    InvalidEnvelope,
    #[error("literature plugin response does not match its request")]
    ResponseMismatch,
    #[error("invalid request-bound literature snapshot reference")]
    InvalidSnapshot,
    #[error("invalid literature trace decision")]
    InvalidDecision,
}

impl From<WireError> for ProtocolError {
    fn from(error: WireError) -> Self {
        match error {
            WireError::FrameBudget => Self::FrameBudget,
            WireError::InvalidFrame => Self::InvalidFrame,
        }
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
                (RequestBody::Initialize, ResponseBody::Initialized { .. })
                    | (
                        RequestBody::DecideNoteTrace { .. },
                        ResponseBody::NoteTraceDecision { .. }
                    )
                    | (RequestBody::Shutdown, ResponseBody::ShutdownComplete)
                    | (
                        RequestBody::Catalog { .. },
                        ResponseBody::CatalogResult { .. }
                    )
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
    )?;
    match &request.body {
        RequestBody::DecideNoteTrace { snapshot } => validate_reference(
            snapshot,
            &snapshot_handle(&request.request_id),
            &request.package_key,
            &request.instance_id,
            &request.request_id,
        )?,
        RequestBody::Catalog { snapshot, .. } => validate_reference(
            snapshot,
            &catalog_input_handle(&request.request_id),
            &request.package_key,
            &request.instance_id,
            &request.request_id,
        )?,
        _ => {}
    }
    Ok(())
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
        } if capability != CAPABILITY_ID || *version != CAPABILITY_VERSION => {
            Err(ProtocolError::InvalidEnvelope)
        }
        ResponseBody::NoteTraceDecision {
            decision: TraceDecision::Ready { mark_sent },
        } if *mark_sent != MarkSentCondition::ORIGINAL => Err(ProtocolError::InvalidDecision),
        ResponseBody::CatalogResult { payload } => validate_reference(
            payload,
            &catalog_result_handle(&response.request_id),
            &response.package_key,
            &response.instance_id,
            &response.request_id,
        ),
        _ => Ok(()),
    }
}

fn validate_reference(
    reference: &SnapshotRef,
    handle: &str,
    package: &str,
    instance: &str,
    request: &str,
) -> Result<(), ProtocolError> {
    if reference.relative_handle != handle
        || reference.byte_size == 0
        || !is_digest(&reference.sha256)
        || reference.package_key != package
        || reference.instance_id != instance
        || reference.request_id != request
    {
        return Err(ProtocolError::InvalidSnapshot);
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
    let canonical_uuid = |value: &str| {
        value.len() == 36
            && uuid::Uuid::parse_str(value).is_ok_and(|id| id.hyphenated().to_string() == value)
    };
    if version != PROTOCOL_VERSION
        || plugin != PLUGIN_ID
        || !is_digest(package)
        || !canonical_uuid(instance)
        || !canonical_uuid(request)
    {
        return Err(ProtocolError::InvalidEnvelope);
    }
    Ok(())
}

fn is_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub fn encode_request(request: &Request) -> Result<Vec<u8>, ProtocolError> {
    validate_request(request)?;
    wire::encode(request, MAX_FRAME_BYTES).map_err(Into::into)
}

pub fn decode_request(frame: &[u8]) -> Result<Request, ProtocolError> {
    let request = wire::decode(frame, MAX_FRAME_BYTES)?;
    validate_request(&request)?;
    Ok(request)
}

pub fn encode_response(response: &Response) -> Result<Vec<u8>, ProtocolError> {
    validate_response(response)?;
    wire::encode(response, MAX_FRAME_BYTES).map_err(Into::into)
}

pub fn decode_response(frame: &[u8]) -> Result<Response, ProtocolError> {
    let response = wire::decode(frame, MAX_FRAME_BYTES)?;
    validate_response(&response)?;
    Ok(response)
}

#[cfg(test)]
mod tests;
