// Adapted from OpenAI Codex config/src/{merge,state}.rs at
// e363b08c9175ac1cbe5893615dd2cb9ddf95043b (Apache-2.0).
// Copyright 2025 OpenAI. See third-party/codex/LICENSE and NOTICE.
// Changes: typed application settings, no Codex aliases or permission fields;
// provenance is retained per field. Parsing, trust and IO belong to the host.
use crate::instructions::candidate_filenames;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const DEFAULT_INSTRUCTION_BYTES: usize = 32 * 1024;
pub const MAX_INSTRUCTION_BYTES: usize = 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfigTier {
    Application,
    User,
    Workspace,
    Directory,
    Session,
    Turn,
}

/// Opaque identity/revision supplied by the host, never an instruction to read a path.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfigOrigin {
    pub tier: ConfigTier,
    pub source_id: String,
    pub revision: String,
}

/// None inherits; Some(empty) clears fallbacks; Some(0) excludes instruction text.
/// Deliberately excludes credentials and permission grants.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InstructionConfigPatch {
    pub max_bytes: Option<usize>,
    pub fallback_filenames: Option<Vec<String>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfigLayer {
    pub origin: ConfigOrigin,
    pub instructions: InstructionConfigPatch,
}

/// Immutable configuration inputs for one environment. Resolve from these saved
/// layers on restore; never re-read current files to interpret a historical turn.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InstructionConfigSnapshot {
    pub environment_id: String,
    pub layers: Vec<ConfigLayer>,
}

pub fn validate_snapshots(snapshots: &[InstructionConfigSnapshot]) -> Result<(), ConfigError> {
    let mut environments = HashSet::new();
    if snapshots.len() > 64 {
        return Err(ConfigError::InvalidLayer);
    }
    let mut layer_count = 0;
    for snapshot in snapshots {
        layer_count += snapshot.layers.len();
        if layer_count > 256
            || !valid_identity(&snapshot.environment_id)
            || !environments.insert(&snapshot.environment_id)
        {
            return Err(ConfigError::InvalidLayer);
        }
        resolve_instruction_config(&snapshot.layers)?;
    }
    // Bounds include provenance and overridden values, not just effective text.
    if serde_json::to_vec(snapshots)
        .map_err(|_| ConfigError::InvalidSetting)?
        .len()
        > 1024 * 1024
    {
        return Err(ConfigError::InvalidSetting);
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResolvedSetting<T> {
    pub value: T,
    /// None means the application built-in default.
    pub origin: Option<ConfigOrigin>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResolvedInstructionConfig {
    pub max_bytes: ResolvedSetting<usize>,
    pub fallback_filenames: ResolvedSetting<Vec<String>>,
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum ConfigError {
    #[error("configuration layer order or identity is invalid")]
    InvalidLayer,
    #[error("configuration exceeds its bounded setting limits")]
    InvalidSetting,
}

/// Layers must be authorized by the host and supplied lowest precedence first.
/// Directory layers are root-to-target within ONE environment; resolve different
/// environments separately. Reject order mistakes instead of silently sorting them.
/// Invalid shadowed layers still fail, so a later override cannot hide bad input.
pub fn resolve_instruction_config(
    layers: &[ConfigLayer],
) -> Result<ResolvedInstructionConfig, ConfigError> {
    if layers.len() > 256 {
        return Err(ConfigError::InvalidLayer);
    }
    let mut identities = HashSet::new();
    let mut previous = None;
    let mut resolved = ResolvedInstructionConfig {
        max_bytes: ResolvedSetting {
            value: DEFAULT_INSTRUCTION_BYTES,
            origin: None,
        },
        fallback_filenames: ResolvedSetting {
            value: vec![],
            origin: None,
        },
    };
    for layer in layers {
        let origin = &layer.origin;
        if !valid_identity(&origin.source_id)
            || !valid_identity(&origin.revision)
            || previous.is_some_and(|tier| tier > origin.tier)
            || !identities.insert((origin.tier, origin.source_id.as_str()))
        {
            return Err(ConfigError::InvalidLayer);
        }
        previous = Some(origin.tier);
        if let Some(value) = layer.instructions.max_bytes {
            if value > MAX_INSTRUCTION_BYTES {
                return Err(ConfigError::InvalidSetting);
            }
            resolved.max_bytes = ResolvedSetting {
                value,
                origin: Some(origin.clone()),
            };
        }
        if let Some(value) = &layer.instructions.fallback_filenames {
            if value.len() > 64
                || value.iter().any(|name| name.len() > 255)
                || candidate_filenames(value).is_err()
            {
                return Err(ConfigError::InvalidSetting);
            }
            resolved.fallback_filenames = ResolvedSetting {
                value: value.clone(),
                origin: Some(origin.clone()),
            };
        }
    }
    Ok(resolved)
}

fn valid_identity(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 1024 && !value.chars().any(char::is_control)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layer(tier: ConfigTier, id: &str, patch: InstructionConfigPatch) -> ConfigLayer {
        ConfigLayer {
            origin: ConfigOrigin {
                tier,
                source_id: id.into(),
                revision: "v1".into(),
            },
            instructions: patch,
        }
    }

    #[test]
    fn precedence_preserves_independent_field_origins_and_empty_overrides() {
        let user = layer(
            ConfigTier::User,
            "user",
            InstructionConfigPatch {
                max_bytes: Some(8192),
                fallback_filenames: Some(vec!["TEAM.md".into()]),
            },
        );
        let workspace = layer(
            ConfigTier::Workspace,
            "project",
            InstructionConfigPatch {
                fallback_filenames: Some(vec!["PROJECT.md".into()]),
                ..Default::default()
            },
        );
        let resolved = resolve_instruction_config(&[user.clone(), workspace.clone()]).unwrap();
        assert_eq!(resolved.max_bytes.value, 8192);
        assert_eq!(resolved.max_bytes.origin, Some(user.origin.clone()));
        assert_eq!(resolved.fallback_filenames.value, ["PROJECT.md"]);
        assert_eq!(
            resolved.fallback_filenames.origin,
            Some(workspace.origin.clone())
        );
        let turn = layer(
            ConfigTier::Turn,
            "turn",
            InstructionConfigPatch {
                max_bytes: Some(0),
                fallback_filenames: Some(vec![]),
            },
        );
        let resolved = resolve_instruction_config(&[user, workspace, turn.clone()]).unwrap();
        assert_eq!(resolved.max_bytes.value, 0);
        assert!(resolved.fallback_filenames.value.is_empty());
        assert_eq!(resolved.max_bytes.origin, Some(turn.origin));
        let defaults = resolve_instruction_config(&[]).unwrap();
        assert_eq!(defaults.max_bytes.value, 32768);
        assert_eq!(defaults.max_bytes.origin, None);
    }

    #[test]
    fn invalid_shadowed_settings_order_and_duplicate_sources_are_rejected() {
        let user = layer(ConfigTier::User, "user", Default::default());
        let mut turn = layer(ConfigTier::Turn, "turn", Default::default());
        assert_eq!(
            resolve_instruction_config(&[turn.clone(), user.clone()]),
            Err(ConfigError::InvalidLayer)
        );
        assert_eq!(
            resolve_instruction_config(&[user.clone(), user.clone()]),
            Err(ConfigError::InvalidLayer)
        );
        for patch in [
            InstructionConfigPatch {
                max_bytes: Some(MAX_INSTRUCTION_BYTES + 1),
                ..Default::default()
            },
            InstructionConfigPatch {
                fallback_filenames: Some(vec!["../AGENTS.md".into()]),
                ..Default::default()
            },
            InstructionConfigPatch {
                fallback_filenames: Some(vec!["X".repeat(256)]),
                ..Default::default()
            },
        ] {
            let bad = layer(ConfigTier::User, "user", patch);
            assert_eq!(
                resolve_instruction_config(&[bad, turn.clone()]),
                Err(ConfigError::InvalidSetting)
            );
        }
        turn.origin.revision.clear();
        assert_eq!(
            resolve_instruction_config(&[turn]),
            Err(ConfigError::InvalidLayer)
        );
    }

    #[test]
    fn scope_layers_inherit_and_settings_cannot_smuggle_authority() {
        let root = layer(
            ConfigTier::Directory,
            ".",
            InstructionConfigPatch {
                max_bytes: Some(4000),
                ..Default::default()
            },
        );
        let child = layer(
            ConfigTier::Directory,
            "chapter",
            InstructionConfigPatch {
                max_bytes: Some(2000),
                ..Default::default()
            },
        );
        assert_eq!(
            resolve_instruction_config(&[root, child])
                .unwrap()
                .max_bytes
                .value,
            2000
        );
        assert!(serde_json::from_str::<InstructionConfigPatch>(r#"{"granted":true}"#).is_err());
        assert!(serde_json::from_str::<InstructionConfigPatch>(r#"{"max_bytes":-1}"#).is_err());
    }
}
