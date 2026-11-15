//! Original shared provider-input values, without network or credential ownership.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderInput {
    pub audit_text: String,
    pub system_text: Option<String>,
    pub messages: Vec<ProviderMessage>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderMessage {
    pub role: ProviderMessageRole,
    pub text: String,
    pub images: Vec<ProviderImage>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProviderMessageRole {
    User,
    Assistant,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderImage {
    pub context_item_id: String,
    pub context_text: String,
    pub data_url: String,
}

impl ProviderInput {
    pub fn has_images(&self) -> bool {
        self.messages
            .iter()
            .any(|message| !message.images.is_empty())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoredImageAsset {
    pub context_item_id: String,
    pub content_sha256: String,
    pub data_url: String,
}
