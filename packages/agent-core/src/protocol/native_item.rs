//! Versioned provider material attached to one accepted output item. Opaque
//! payloads are never credentials and are not printed by Debug diagnostics.
use super::ModelIdentity;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, fmt};
use uuid::Uuid;

pub const NATIVE_ITEM_SCHEMA_VERSION: u32 = 1;
pub const MAX_NATIVE_ITEM_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NativeItemData {
    pub schema_version: u32,
    pub api: String,
    /// Configured request identity, distinct from later provider evidence.
    pub model: ModelIdentity,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actual_model: Option<ModelIdentity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_scope: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    pub item_type: String,
    pub data: Value,
    #[serde(default, flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum NativeItemError {
    #[error("native_item_unsupported_version")]
    UnsupportedVersion,
    #[error("native_item_invalid_identity")]
    InvalidIdentity,
    #[error("native_item_invalid_json")]
    InvalidJson,
    #[error("native_item_byte_limit")]
    ByteLimit,
}

impl NativeItemData {
    pub fn new(api: String, model: ModelIdentity, item_type: String, data: Value) -> Self {
        Self {
            schema_version: NATIVE_ITEM_SCHEMA_VERSION,
            api,
            model,
            actual_model: None,
            account_scope: None,
            response_id: None,
            item_id: None,
            item_type,
            data,
            extra: BTreeMap::new(),
        }
    }

    pub fn validate(&self) -> Result<(), NativeItemError> {
        if self.schema_version != NATIVE_ITEM_SCHEMA_VERSION {
            return Err(NativeItemError::UnsupportedVersion);
        }
        if !name(&self.api)
            || !name(&self.item_type)
            || !model(&self.model)
            || self
                .actual_model
                .as_ref()
                .is_some_and(|value| !model(value))
            || self
                .response_id
                .as_deref()
                .is_some_and(|value| !name(value))
            || self.item_id.as_deref().is_some_and(|value| !name(value))
            || self.account_scope.is_some_and(|scope| scope.is_nil())
            || !self.data.is_object()
            || self.extra.keys().any(|key| {
                matches!(
                    key.as_str(),
                    "schema_version"
                        | "api"
                        | "model"
                        | "actual_model"
                        | "account_scope"
                        | "response_id"
                        | "item_id"
                        | "item_type"
                        | "data"
                )
            })
        {
            return Err(NativeItemError::InvalidIdentity);
        }
        let bytes = serde_json::to_vec(self).map_err(|_| NativeItemError::InvalidJson)?;
        if bytes.len() > MAX_NATIVE_ITEM_BYTES {
            return Err(NativeItemError::ByteLimit);
        }
        Ok(())
    }

    pub fn from_json(json: &str) -> Result<Self, NativeItemError> {
        if json.len() > MAX_NATIVE_ITEM_BYTES {
            return Err(NativeItemError::ByteLimit);
        }
        let value: Self = serde_json::from_str(json).map_err(|_| NativeItemError::InvalidJson)?;
        value.validate()?;
        Ok(value)
    }

    pub fn to_json(&self) -> Result<String, NativeItemError> {
        self.validate()?;
        serde_json::to_string(self).map_err(|_| NativeItemError::InvalidJson)
    }
}

impl fmt::Debug for NativeItemData {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("NativeItemData")
            .field("schema_version", &self.schema_version)
            .field("api", &self.api)
            .field("model", &self.model)
            .field("actual_model", &self.actual_model)
            .field("account_scope", &self.account_scope)
            .field("response_id", &self.response_id)
            .field("item_id", &self.item_id)
            .field("item_type", &self.item_type)
            .field("data", &"[redacted]")
            .field("extra", &"[redacted]")
            .finish()
    }
}
fn name(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 1024 && !value.contains('\0')
}
fn model(value: &ModelIdentity) -> bool {
    name(&value.provider_id) && name(&value.model_id) && value.revision.as_deref().is_none_or(name)
}
