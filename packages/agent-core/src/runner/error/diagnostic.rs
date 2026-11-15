//! Closed native-owner metadata for an effect whose outcome needs recovery.
//! Never construct this from tool arguments, provider text, paths or SQL messages.
use serde::{Deserialize, Serialize, Serializer};
use serde_json::Value;
use std::fmt;
use uuid::Uuid;

const MAX_BYTES: usize = 8 * 1024;
const MAX_IDENTIFIER_BYTES: usize = 1024;
const DISPLAY_BYTES: usize = 1024 - "tool_outcome_unknown: ".len();
const OPAQUE_IDENTIFIERS: [&str; 4] = [
    "callId",
    "targetRequestId",
    "callRequestId",
    "journalRequestId",
];

/// Validated owner metadata. Serialization keeps the complete bounded payload;
/// Display uses a smaller summary compatible with the existing TurnFailed bound.
#[derive(Clone, Debug)]
pub struct ToolOutcomeDiagnostic {
    full: Value,
    display: Value,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error("invalid tool outcome diagnostic")]
pub struct InvalidToolOutcomeDiagnostic;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fields {
    code: String,
    phase: String,
    safe_cause: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    conversation_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    request_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    turn_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    operation_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    context_snapshot_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    child_conversation_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    child_turn_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    child_context_snapshot_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    child_archive_intent_version: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    child_archive_operation_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    child_archive_expected_watermark: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    manuscript_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    lease_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    result_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    call_request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    target_request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    journal_request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sqlite_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sqlite_extended_code: Option<i32>,
}

fn token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 101
        && value.as_bytes()[0].is_ascii_alphabetic()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
}
fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_IDENTIFIER_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-.:/".contains(&byte))
}
fn display_summary(value: &Value) -> Result<Value, InvalidToolOutcomeDiagnostic> {
    let mut summary = value.clone();
    let fields = summary
        .as_object_mut()
        .ok_or(InvalidToolOutcomeDiagnostic)?;
    for key in OPAQUE_IDENTIFIERS {
        fields.remove(key);
    }
    // Reserve the marker before adding whole original identifiers. Known UUIDs,
    // code/cause and driver evidence are never shortened or dropped.
    fields.insert("identifiersOmitted".into(), Value::Bool(true));
    if serde_json::to_vec(&summary)
        .map_err(|_| InvalidToolOutcomeDiagnostic)?
        .len()
        > DISPLAY_BYTES
    {
        return Err(InvalidToolOutcomeDiagnostic);
    }
    let mut omitted = false;
    for key in OPAQUE_IDENTIFIERS {
        if let Some(original) = value.get(key) {
            summary[key] = original.clone();
            if serde_json::to_vec(&summary)
                .map_err(|_| InvalidToolOutcomeDiagnostic)?
                .len()
                > DISPLAY_BYTES
            {
                summary
                    .as_object_mut()
                    .ok_or(InvalidToolOutcomeDiagnostic)?
                    .remove(key);
                omitted = true;
            }
        }
    }
    if !omitted {
        summary
            .as_object_mut()
            .ok_or(InvalidToolOutcomeDiagnostic)?
            .remove("identifiersOmitted");
    }
    Ok(summary)
}
impl ToolOutcomeDiagnostic {
    pub fn try_from_value(value: Value) -> Result<Self, InvalidToolOutcomeDiagnostic> {
        let original = value.as_object().ok_or(InvalidToolOutcomeDiagnostic)?;
        if original.len() > 16
            || original.values().any(|value| match value {
                Value::String(value) => value.len() > MAX_IDENTIFIER_BYTES,
                Value::Null | Value::Number(_) => false,
                _ => true,
            })
            || serde_json::to_vec(&value)
                .map_err(|_| InvalidToolOutcomeDiagnostic)?
                .len()
                > MAX_BYTES
        {
            return Err(InvalidToolOutcomeDiagnostic);
        }
        let fields: Fields =
            serde_json::from_value(value.clone()).map_err(|_| InvalidToolOutcomeDiagnostic)?;
        if !token(&fields.code)
            || !token(&fields.phase)
            || !token(&fields.safe_cause)
            || [
                fields.conversation_id,
                fields.request_id,
                fields.turn_id,
                fields.operation_id,
                fields.context_snapshot_id,
                fields.child_conversation_id,
                fields.child_turn_id,
                fields.child_context_snapshot_id,
                fields.child_archive_operation_id,
                fields.manuscript_id,
                fields.lease_id,
                fields.result_id,
            ]
            .into_iter()
            .flatten()
            .any(|id| id.is_nil())
            || match (
                fields.child_archive_intent_version,
                fields.child_archive_operation_id,
                fields.child_archive_expected_watermark,
            ) {
                (None, None, None) => false,
                (Some(1), Some(_), Some(watermark)) => {
                    watermark > 9_007_199_254_740_991
                        || fields.request_id.is_none()
                        || fields.result_id.is_none()
                }
                _ => true,
            }
            || [
                fields.call_id.as_deref(),
                fields.call_request_id.as_deref(),
                fields.target_request_id.as_deref(),
                fields.journal_request_id.as_deref(),
            ]
            .into_iter()
            .flatten()
            .any(|value| !identifier(value))
            || fields
                .sqlite_code
                .as_deref()
                .is_some_and(|value| !token(value))
            || fields.sqlite_extended_code.is_some_and(|value| value < 0)
        {
            return Err(InvalidToolOutcomeDiagnostic);
        }
        let mut canonical =
            serde_json::to_value(fields).map_err(|_| InvalidToolOutcomeDiagnostic)?;
        // Retain explicit nulls without inventing fields the owner did not know.
        for (key, value) in original {
            if value.is_null() {
                canonical[key] = Value::Null;
            }
        }
        if serde_json::to_vec(&canonical)
            .map_err(|_| InvalidToolOutcomeDiagnostic)?
            .len()
            > MAX_BYTES
        {
            return Err(InvalidToolOutcomeDiagnostic);
        }
        let display = display_summary(&canonical)?;
        Ok(Self {
            full: canonical,
            display,
        })
    }
}
impl fmt::Display for ToolOutcomeDiagnostic {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        // This private value was canonicalized from the closed typed fields.
        write!(formatter, "{}", self.display)
    }
}
impl Serialize for ToolOutcomeDiagnostic {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.full.serialize(serializer)
    }
}

#[cfg(test)]
mod tests;
