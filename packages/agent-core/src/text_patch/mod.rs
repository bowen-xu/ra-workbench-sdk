//! File-oriented patches over portable virtual paths. Backends own authorization and IO.
pub mod address;
pub mod backend;
mod matching;
mod parser;
mod streaming_parser;
pub use matching::{PatchConflict, TextEdit, replace_chunks, replace_with_edits};
pub use parser::{Hunk, ParseError, UpdateFileChunk};

pub const MAX_PATCH_BYTES: usize = 1024 * 1024;
pub const MAX_PATCH_FILES: usize = 128;

pub fn parse(patch: &str) -> Result<Vec<Hunk>, ParseError> {
    use parser::ParseError::InvalidPatchError;
    if patch.len() > MAX_PATCH_BYTES {
        return Err(InvalidPatchError("patch exceeds 1 MiB".into()));
    }
    if patch.contains('\0') {
        return Err(InvalidPatchError("patch text cannot contain NUL".into()));
    }
    let mut parser = streaming_parser::StreamingPatchParser::default();
    parser.push_delta(patch.trim())?;
    let mut hunks = parser.finish()?;
    if parser.environment_id().is_some() || hunks.is_empty() || hunks.len() > MAX_PATCH_FILES {
        return Err(InvalidPatchError(
            "use 1–128 targets and existing source addresses, without environment headers".into(),
        ));
    }
    let mut paths = std::collections::BTreeSet::new();
    for hunk in &mut hunks {
        let (path, destination) = match hunk {
            Hunk::AddFile { path, .. } | Hunk::DeleteFile { path } => (path, None),
            Hunk::UpdateFile {
                path, move_path, ..
            } => (path, move_path.as_mut()),
        };
        for path in std::iter::once(path).chain(destination) {
            let raw_path = path
                .to_str()
                .ok_or_else(|| InvalidPatchError("invalid path".into()))?;
            let key = if raw_path.starts_with("source://") {
                address::format(&address::parse(raw_path).map_err(InvalidPatchError)?)
            } else {
                crate::workspace::validate_path(raw_path)
                    .map_err(|_| InvalidPatchError("invalid path".into()))?;
                raw_path.to_owned()
            };
            if !paths.insert(key.clone()) {
                return Err(InvalidPatchError(
                    "duplicate or overlapping target paths".into(),
                ));
            }
            *path = key.into();
        }
    }
    Ok(hunks)
}

#[cfg(test)]
mod tests;
