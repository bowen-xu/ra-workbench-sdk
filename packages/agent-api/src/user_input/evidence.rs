//! Application evidence envelope. Codex UserInput Text/Image separation is kept;
//! the public CLI does not define Desktop selection/annotation envelopes.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvidenceImage {
    pub media_type: String,
    pub asset_id: String,
    pub capture_id: uuid::Uuid,
    pub byte_size: usize,
}
impl EvidenceImage {
    pub fn validates_bytes(&self, bytes: &[u8]) -> bool {
        self.valid()
            && bytes.len() == self.byte_size
            && format!("{:x}", Sha256::digest(bytes)) == self.asset_id
            && match self.media_type.as_str() {
                "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
                "image/jpeg" => bytes.starts_with(&[255, 216, 255]),
                "image/webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
                _ => false,
            }
    }
    pub(super) fn valid(&self) -> bool {
        self.byte_size > 0
            && self.byte_size <= 524_288
            && !self.capture_id.is_nil()
            && self.asset_id.len() == 64
            && self
                .asset_id
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
            && matches!(
                self.media_type.as_str(),
                "image/png" | "image/jpeg" | "image/webp"
            )
    }
}
pub(super) fn valid_target(source: Option<&str>, title: &str, text: &str) -> bool {
    // Source paths are quoted evidence only. Navigation's directory resolver
    // owns grammar and ownership; no native file access or grant follows here.
    source.map_or_else(
        || !text.trim().is_empty(),
        |source| {
            source.starts_with("source://")
                && source.len() > 9
                && source.len() <= 8192
                && !source.chars().any(char::is_control)
        },
    ) && super::safe(title)
        && text.len() <= 262_144
        && !text.contains('\0')
}
