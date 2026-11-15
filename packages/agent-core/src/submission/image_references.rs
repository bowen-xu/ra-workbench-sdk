//! Immutable image metadata, not a path, permission, or binary-read capability.
use super::{HashSet, SubmissionError};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SubmissionImageReference {
    pub source_id: String,
    pub content_sha256: String,
    pub media_type: String,
    pub byte_size: u64,
    pub ordinal: u32,
}

pub fn validate_image_references(
    images: &[SubmissionImageReference],
) -> Result<(), SubmissionError> {
    let mut sources = HashSet::new();
    let mut hashes = HashSet::new();
    if images.len() > 64 {
        return Err(SubmissionError::InvalidInput);
    }
    for (ordinal, image) in images.iter().enumerate() {
        if image.source_id.trim().is_empty()
            || image.source_id.len() > 1024
            || image.media_type != "image/png"
            || image.content_sha256.len() != 64
            || !image
                .content_sha256
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            || image.byte_size == 0
            || image.byte_size > 20 * 1024 * 1024
            || image.ordinal as usize != ordinal
            || !sources.insert(&image.source_id)
            || !hashes.insert(&image.content_sha256)
        {
            return Err(SubmissionError::InvalidInput);
        }
    }
    Ok(())
}
