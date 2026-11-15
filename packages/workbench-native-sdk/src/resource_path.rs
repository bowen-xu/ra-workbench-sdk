//! Original source-relative path policy shared by native file adapters.

use std::path::{Component, Path, PathBuf};

pub use research_agent_api::workspace::is_recovery_file_name;

const MAX_PATH_LENGTH: usize = 1024;

/// Preserve the stored UUID spelling used by existing manuscript attachments.
pub fn writing_note_asset_path(asset_id: &str) -> Result<String, InvalidRelativePath> {
    uuid::Uuid::parse_str(asset_id).map_err(|_| InvalidRelativePath)?;
    Ok(format!(".ranote-assets/{asset_id}"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("invalid source-relative path")]
pub struct InvalidRelativePath;

/// Validate the established native source-relative path grammar.
///
/// This intentionally keeps `Path::components()` normalization and the original
/// byte limit; it does not impose the stricter Agent workspace-path grammar.
pub fn validate_relative_path(value: &str) -> Result<PathBuf, InvalidRelativePath> {
    if value.is_empty() || value.len() > MAX_PATH_LENGTH || value.contains('\0') {
        return Err(InvalidRelativePath);
    }
    if value.contains('\\') || value.ends_with('/') {
        return Err(InvalidRelativePath);
    }

    let path = Path::new(value);
    if path.is_absolute() {
        return Err(InvalidRelativePath);
    }

    for component in path.components() {
        let Component::Normal(segment) = component else {
            return Err(InvalidRelativePath);
        };
        let segment = segment.to_string_lossy();
        if is_reserved_name(&segment)
            || segment.ends_with(' ')
            || segment.ends_with('.')
            || is_recovery_file_name(&segment)
        {
            return Err(InvalidRelativePath);
        }
    }
    Ok(path.to_path_buf())
}

fn is_reserved_name(value: &str) -> bool {
    let stem = value
        .split('.')
        .next()
        .unwrap_or(value)
        .to_ascii_lowercase();
    matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
        || stem
            .strip_prefix("com")
            .or_else(|| stem.strip_prefix("lpt"))
            .is_some_and(|suffix| {
                matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            })
}

#[cfg(test)]
mod tests;

/// Original writing snapshot exclusion for Core note documents and assets.
pub fn is_note_input(path: &Path) -> bool {
    path.starts_with(".ranote-assets")
        || path
            .extension()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.eq_ignore_ascii_case("ranote"))
}
