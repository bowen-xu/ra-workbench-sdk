//! Application-owned extension registry.
//!
//! Adapted from Codex `ext/extension-api` and `ext/mcp` registry boundaries.
//! This crate owns only immutable metadata and authorization decisions; native
//! adapters own MCP transports, credentials and process lifetimes.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

const MAX_SERVERS: usize = 64;
const MAX_TOOLS: usize = 512;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExtensionTool {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExtensionDescriptor {
    pub environment_id: String,
    pub server_id: String,
    pub revision: String,
    pub tools: Vec<ExtensionTool>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RegisteredExtension {
    pub descriptor: ExtensionDescriptor,
    pub qualified_tools: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ExtensionError {
    #[error("invalid extension metadata")]
    Invalid,
    #[error("extension or tool name is already registered")]
    Duplicate,
    #[error("extension registry budget exceeded")]
    Budget,
    #[error("extension tool is not authorized")]
    Unauthorized,
    #[error("extension revision changed")]
    Stale,
}

#[derive(Clone, Debug, Default)]
pub struct ExtensionRegistry {
    extensions: HashMap<String, RegisteredExtension>,
    tools: HashSet<String>,
}

impl ExtensionRegistry {
    pub fn register(&mut self, descriptor: ExtensionDescriptor) -> Result<(), ExtensionError> {
        validate_descriptor(&descriptor)?;
        if self.extensions.contains_key(&descriptor.server_id) {
            return Err(ExtensionError::Duplicate);
        }
        if self.extensions.len() >= MAX_SERVERS
            || self.tools.len() + descriptor.tools.len() > MAX_TOOLS
        {
            return Err(ExtensionError::Budget);
        }
        let qualified_tools = descriptor
            .tools
            .iter()
            .map(|tool| format!("{}__{}", descriptor.server_id, tool.name))
            .collect::<Vec<_>>();
        if qualified_tools.iter().any(|name| self.tools.contains(name)) {
            return Err(ExtensionError::Duplicate);
        }
        self.tools.extend(qualified_tools.iter().cloned());
        self.extensions.insert(
            descriptor.server_id.clone(),
            RegisteredExtension {
                descriptor,
                qualified_tools,
            },
        );
        Ok(())
    }

    pub fn get(&self, server_id: &str) -> Option<&RegisteredExtension> {
        self.extensions.get(server_id)
    }

    /// Reauthorize the exact server revision before exposing a tool to a model.
    /// The caller supplies the user-approved server set for this turn; registry
    /// presence alone never grants execution permission.
    pub fn authorize(
        &self,
        server_id: &str,
        revision: &str,
        qualified_tool: &str,
        approved_servers: &HashSet<String>,
    ) -> Result<(), ExtensionError> {
        let extension = self
            .extensions
            .get(server_id)
            .ok_or(ExtensionError::Unauthorized)?;
        if extension.descriptor.revision != revision {
            return Err(ExtensionError::Stale);
        }
        if !approved_servers.contains(server_id)
            || !extension
                .qualified_tools
                .iter()
                .any(|name| name == qualified_tool)
        {
            return Err(ExtensionError::Unauthorized);
        }
        Ok(())
    }
}

fn validate_descriptor(descriptor: &ExtensionDescriptor) -> Result<(), ExtensionError> {
    for value in [
        &descriptor.environment_id,
        &descriptor.server_id,
        &descriptor.revision,
    ] {
        if value.trim().is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
            return Err(ExtensionError::Invalid);
        }
    }
    if descriptor.tools.is_empty() || descriptor.tools.len() > MAX_TOOLS {
        return Err(ExtensionError::Invalid);
    }
    let mut names = HashSet::new();
    for tool in &descriptor.tools {
        if tool.name.trim().is_empty()
            || tool.name.len() > 128
            || tool.name.chars().any(char::is_control)
            || tool.description.len() > 65_536
            || !tool.input_schema.is_object()
            || !names.insert(&tool.name)
        {
            return Err(ExtensionError::Invalid);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn descriptor(revision: &str) -> ExtensionDescriptor {
        ExtensionDescriptor {
            environment_id: "project".into(),
            server_id: "literature".into(),
            revision: revision.into(),
            tools: vec![ExtensionTool {
                name: "search".into(),
                description: "search sources".into(),
                input_schema: json!({"type":"object"}),
            }],
        }
    }

    #[test]
    fn requires_turn_approval_and_exact_revision() {
        let mut registry = ExtensionRegistry::default();
        registry.register(descriptor("r1")).unwrap();
        let mut approved = HashSet::new();
        assert_eq!(
            registry.authorize("literature", "r1", "literature__search", &approved),
            Err(ExtensionError::Unauthorized)
        );
        approved.insert("literature".into());
        assert_eq!(
            registry.authorize("literature", "old", "literature__search", &approved),
            Err(ExtensionError::Stale)
        );
        registry
            .authorize("literature", "r1", "literature__search", &approved)
            .unwrap();
    }

    #[test]
    fn rejects_duplicate_names_and_invalid_schema() {
        let mut registry = ExtensionRegistry::default();
        registry.register(descriptor("r1")).unwrap();
        assert_eq!(
            registry.register(descriptor("r2")),
            Err(ExtensionError::Duplicate)
        );
        let mut invalid = descriptor("r3");
        invalid.server_id = "other".into();
        invalid.tools[0].input_schema = json!(null);
        assert_eq!(registry.register(invalid), Err(ExtensionError::Invalid));
    }
}
