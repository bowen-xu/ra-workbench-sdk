//! Adapted from Codex codex-mcp/src/tools.rs and mcp/mod.rs at
//! e363b08c9175ac1cbe5893615dd2cb9ddf95043b, Copyright 2025 OpenAI,
//! Apache-2.0. Only identity normalization is retained; discovery, connector
//! metadata and transport ownership remain with the host.
use sha1::{Digest, Sha1};
use std::collections::{HashMap, HashSet};

const MAX_NAME: usize = 64;
const DELIMITER: &str = "__";
const HASH_LENGTH: usize = 12;

/// Raw identity is never replaced when the model-visible name is normalized.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct McpRawName {
    pub server: String,
    pub namespace: String,
    pub callable_name: String,
    pub tool_name: String,
    pub connector_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct McpModelName {
    pub raw: McpRawName,
    pub namespace: String,
    pub name: String,
}

struct Candidate {
    raw: McpRawName,
    namespace: String,
    name: String,
    namespace_id: String,
    tool_id: String,
}

/// Normalize the complete discovery catalog at once, as Codex does. The
/// For distinct raw identities, mapping and order are independent of input order.
/// Duplicate identities retain their first occurrence, matching Codex.
pub fn normalize_model_names(
    raw_tools: impl IntoIterator<Item = McpRawName>,
    prefix: bool,
    unprefixed_servers: &[String],
) -> Vec<McpModelName> {
    let mut seen = HashSet::new();
    let mut candidates = Vec::new();
    for raw in raw_tools {
        let namespace_id = format!(
            "{}\0{}\0{}",
            raw.server,
            raw.namespace,
            raw.connector_id.as_deref().unwrap_or_default()
        );
        let tool_id = format!("{}\0{}\0{}", namespace_id, raw.callable_name, raw.tool_name);
        if !seen.insert(tool_id.clone()) {
            continue;
        }
        let mut namespace = sanitize(&raw.namespace);
        if prefix && !unprefixed_servers.contains(&raw.server) && !namespace.starts_with("mcp__") {
            namespace = format!("mcp__{namespace}");
        }
        let name = sanitize(&raw.callable_name);
        candidates.push(Candidate {
            raw,
            namespace,
            name,
            namespace_id,
            tool_id,
        });
    }
    let mut namespace_ids = HashMap::<String, HashSet<String>>::new();
    for item in &candidates {
        namespace_ids
            .entry(item.namespace.clone())
            .or_default()
            .insert(item.namespace_id.clone());
    }
    for item in &mut candidates {
        if namespace_ids[&item.namespace].len() > 1 {
            let suffix = hash_suffix(&item.namespace_id);
            item.namespace = match item.namespace.strip_suffix(DELIMITER) {
                Some(base) => format!("{base}{suffix}{DELIMITER}"),
                None => format!("{}{suffix}", item.namespace),
            };
        }
    }
    let mut tool_ids = HashMap::<(String, String), HashSet<String>>::new();
    for item in &candidates {
        tool_ids
            .entry((item.namespace.clone(), item.name.clone()))
            .or_default()
            .insert(item.tool_id.clone());
    }
    for item in &mut candidates {
        if tool_ids[&(item.namespace.clone(), item.name.clone())].len() > 1 {
            item.name.push_str(&hash_suffix(&item.tool_id));
        }
    }
    candidates.sort_by(|a, b| a.tool_id.cmp(&b.tool_id));
    let mut used = HashSet::new();
    candidates
        .into_iter()
        .map(|item| {
            let (namespace, name) =
                unique_parts(&item.namespace, &item.name, &item.tool_id, &mut used);
            McpModelName {
                raw: item.raw,
                namespace,
                name,
            }
        })
        .collect()
}

fn sanitize(input: &str) -> String {
    let output: String = input
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if output.is_empty() {
        "_".into()
    } else {
        output
    }
}

fn hash_suffix(identity: &str) -> String {
    let hash = format!("{:x}", Sha1::digest(identity.as_bytes()));
    format!("_{}", &hash[..HASH_LENGTH])
}

fn unique_parts(
    namespace: &str,
    name: &str,
    identity: &str,
    used: &mut HashSet<String>,
) -> (String, String) {
    let flat = format!("{namespace}{name}");
    if flat.len() + DELIMITER.len() <= MAX_NAME && used.insert(flat) {
        return (namespace.into(), name.into());
    }
    let mut attempt = 0_u32;
    loop {
        let input = if attempt == 0 {
            identity.to_owned()
        } else {
            format!("{identity}\0{attempt}")
        };
        let suffix = hash_suffix(&input);
        let max_name = MAX_NAME.saturating_sub(namespace.len() + DELIMITER.len());
        let (new_namespace, new_name) = if max_name >= suffix.len() {
            (
                namespace.to_owned(),
                format!(
                    "{}{}",
                    name.chars()
                        .take(max_name - suffix.len())
                        .collect::<String>(),
                    suffix
                ),
            )
        } else {
            (
                namespace
                    .chars()
                    .take(MAX_NAME.saturating_sub(suffix.len() + DELIMITER.len()))
                    .collect(),
                suffix,
            )
        };
        if used.insert(format!("{new_namespace}{new_name}")) {
            return (new_namespace, new_name);
        }
        attempt = attempt.saturating_add(1);
    }
}

#[cfg(test)]
mod tests;
