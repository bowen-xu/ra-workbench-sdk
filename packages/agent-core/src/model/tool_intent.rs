//! Raw arguments follow Codex ResponseItem::FunctionCall and tools/router.rs
//! at e363b08c9175ac1cbe5893615dd2cb9ddf95043b (Apache-2.0).
//! Parsing grants no execution authority; the registered handler owns its schema.
use super::{ModelError, ToolCall, ToolCallIntent};
use serde::{Deserialize, Deserializer};
use serde_json::Value;

pub(super) fn validate_identity(call_id: &str, name: &str) -> Result<(), ModelError> {
    if call_id.trim().is_empty() || name.trim().is_empty() {
        return Err(ModelError::InvalidStream);
    }
    if [call_id, name]
        .iter()
        .any(|value| value.chars().count() > crate::protocol::MAX_EVENT_NAME_CHARS)
    {
        return Err(ModelError::BudgetExceeded);
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StoredIntent {
    call_id: String,
    name: String,
    #[serde(default)]
    namespace: Option<String>,
    #[serde(default, deserialize_with = "present_value")]
    arguments: Option<Value>,
    #[serde(default)]
    raw_arguments_json: Option<String>,
}

fn present_value<'de, D: Deserializer<'de>>(decoder: D) -> Result<Option<Value>, D::Error> {
    Value::deserialize(decoder).map(Some)
}

impl TryFrom<StoredIntent> for ToolCallIntent {
    type Error = ModelError;
    fn try_from(stored: StoredIntent) -> Result<Self, Self::Error> {
        // Earlier checkpoints held parsed and raw copies. Validate both when
        // present; new checkpoints contain only the authoritative raw string.
        let raw_arguments_json = match (stored.raw_arguments_json, stored.arguments) {
            (Some(raw), Some(arguments)) => {
                if serde_json::from_str::<Value>(&raw).ok().as_ref() != Some(&arguments) {
                    return Err(ModelError::InvalidStream);
                }
                raw
            }
            (Some(raw), None) => raw,
            (None, Some(arguments)) => arguments.to_string(),
            (None, None) => return Err(ModelError::InvalidStream),
        };
        Ok(Self {
            call_id: stored.call_id,
            name: stored.name,
            raw_arguments_json,
            namespace: stored.namespace,
        })
    }
}

impl TryFrom<&ToolCall> for ToolCallIntent {
    type Error = ModelError;
    fn try_from(call: &ToolCall) -> Result<Self, Self::Error> {
        validate_identity(&call.call_id, &call.name)?;
        Ok(Self {
            call_id: call.call_id.clone(),
            name: call.name.clone(),
            raw_arguments_json: call.arguments_json()?,
            namespace: call.namespace.clone(),
        })
    }
}

impl ToolCallIntent {
    /// Called only after durable admission and before registered validation.
    /// Valid non-object JSON remains available to the target handler.
    pub fn parse(&self) -> Result<ToolCall, ToolCallParseError> {
        Ok(ToolCall {
            call_id: self.call_id.clone(),
            name: self.name.clone(),
            namespace: self.namespace.clone(),
            arguments: serde_json::from_str(&self.raw_arguments_json)?,
            raw_arguments_json: Some(self.raw_arguments_json.clone()),
        })
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ToolCallParseError {
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}
