//! Exact, ambiguity-rejecting adaptation of Codex's chunk replacement algorithm.
use super::UpdateFileChunk;
use thiserror::Error;

#[derive(Debug, PartialEq, Eq, Error)]
pub enum PatchConflict {
    #[error("expected context was not found; re-read the target")]
    Missing,
    #[error(
        "补丁块 {chunk} 的原文上下文未匹配：{context}。请先检查这些行是否本应是新增（+）或删除（-）的补丁行，是否漏写前缀；若确实是用于匹配的原文，请重新读取目标文件，核对是否已被其他操作修改，再修正补丁。"
    )]
    MissingContext { chunk: usize, context: String },
    #[error("multiple locations match; add distinguishing context")]
    Ambiguous,
    #[error("patch has too many chunks")]
    Budget,
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
struct State {
    cursor: usize,
    replacements: Vec<(usize, usize, Vec<String>)>,
}

fn matches(lines: &[String], pattern: &[String], from: usize, eof: bool) -> Vec<usize> {
    if pattern.len() > lines.len() {
        return vec![];
    }
    (from..=lines.len() - pattern.len())
        .filter(|&position| {
            (!eof || position + pattern.len() == lines.len())
                && lines[position..position + pattern.len()] == *pattern
        })
        .collect()
}

pub fn replace_chunks(original: &str, chunks: &[UpdateFileChunk]) -> Result<String, PatchConflict> {
    replace_with_edits(original, chunks).map(|(text, _)| text)
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct TextEdit {
    pub start: usize,
    pub end: usize,
    pub replacement: String,
}

pub fn replace_with_edits(
    original: &str,
    chunks: &[UpdateFileChunk],
) -> Result<(String, Vec<TextEdit>), PatchConflict> {
    if chunks.is_empty() {
        return Ok((original.to_owned(), vec![]));
    }
    if chunks.len() > 256 {
        return Err(PatchConflict::Budget);
    }
    let normalized = original.replace("\r\n", "\n");
    let mut lines: Vec<String> = normalized.split('\n').map(str::to_owned).collect();
    if lines.last().is_some_and(String::is_empty) {
        lines.pop();
    }
    let mut states = vec![State {
        cursor: 0,
        replacements: vec![],
    }];
    for (chunk_index, chunk) in chunks.iter().enumerate() {
        let mut next = std::collections::BTreeSet::new();
        for state in states {
            let starts = if let Some(context) = &chunk.change_context {
                matches(&lines, std::slice::from_ref(context), state.cursor, false)
                    .into_iter()
                    .map(|index| index + 1)
                    .collect()
            } else {
                vec![state.cursor]
            };
            for start in starts {
                if chunk.old_lines.is_empty() && chunk.new_lines.is_empty() {
                    next.insert(State {
                        cursor: start,
                        replacements: state.replacements.clone(),
                    });
                    continue;
                }
                let pattern = chunk.old_lines.as_slice();
                let replacement = chunk.new_lines.as_slice();
                let positions = if pattern.is_empty() {
                    vec![if chunk.change_context.is_some() {
                        start
                    } else {
                        lines.len()
                    }]
                } else {
                    matches(&lines, pattern, start, chunk.is_end_of_file)
                };
                for position in positions {
                    let mut replacements = state.replacements.clone();
                    replacements.push((position, pattern.len(), replacement.to_vec()));
                    next.insert(State {
                        cursor: position + pattern.len(),
                        replacements,
                    });
                    if next.len() > 256 {
                        return Err(PatchConflict::Ambiguous);
                    }
                }
            }
        }
        if next.is_empty() {
            let context = chunk
                .change_context
                .iter()
                .chain(chunk.old_lines.iter())
                .take(3)
                .map(|line| {
                    let encoded = serde_json::to_string(line).unwrap_or_default();
                    let preview: String = encoded.chars().take(200).collect();
                    if encoded.chars().count() > 200 {
                        format!("{preview}…（已截断，原行 {} 字符）", line.chars().count())
                    } else {
                        preview
                    }
                })
                .collect::<Vec<_>>()
                .join(" / ");
            return Err(PatchConflict::MissingContext {
                chunk: chunk_index + 1,
                context,
            });
        }
        states = next.into_iter().collect();
    }
    let unique: std::collections::BTreeSet<_> =
        states.into_iter().map(|state| state.replacements).collect();
    if unique.len() != 1 {
        return Err(PatchConflict::Ambiguous);
    }
    let replacements = unique.into_iter().next().ok_or(PatchConflict::Missing)?;
    let mut edits = Vec::new();
    let offsets = std::iter::once(0)
        .chain(lines.iter().scan(0, |offset, line| {
            *offset += line.len() + 1;
            Some(*offset)
        }))
        .collect::<Vec<_>>();
    for (start, count, replacement) in &replacements {
        let old = &lines[*start..start + count];
        let prefix = old
            .iter()
            .zip(replacement)
            .take_while(|(a, b)| a == b)
            .count();
        let suffix = old[prefix..]
            .iter()
            .rev()
            .zip(replacement[prefix..].iter().rev())
            .take_while(|(a, b)| a == b)
            .count();
        let added = &replacement[prefix..replacement.len() - suffix];
        if prefix + suffix == *count && added.is_empty() {
            continue;
        }
        edits.push(TextEdit {
            start: offsets[start + prefix].min(normalized.len()),
            end: offsets[start + count - suffix].min(normalized.len()),
            replacement: if added.is_empty() {
                String::new()
            } else {
                format!("{}\n", added.join("\n"))
            },
        });
    }
    for (start, count, replacement) in replacements.into_iter().rev() {
        lines.splice(start..start + count, replacement);
    }
    if edits.is_empty() {
        return Ok((original.to_owned(), edits));
    }
    let mut output = lines.join("\n");
    if !output.ends_with('\n') {
        output.push('\n');
    }
    Ok((output, edits))
}
