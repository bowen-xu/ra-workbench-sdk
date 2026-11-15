// Adapted from OpenAI Codex skills/src/model.rs and ext/skills/src/render.rs
// at e363b08c9175ac1cbe5893615dd2cb9ddf95043b (Apache-2.0).
// Copyright 2025 OpenAI. See third-party/codex/LICENSE and NOTICE.
// Changes: opaque environment provenance, bounded JSON catalog, explicit omissions,
// version-checked demand loading; no Codex plugin/account/path or permission types.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SkillIdentity {
    pub environment_id: String,
    pub source_id: String,
    pub revision: String,
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum SkillError {
    #[error("invalid skill metadata or provenance")]
    Invalid,
    #[error("skill context budget is invalid")]
    Budget,
    #[error("skill version changed after discovery")]
    Stale,
    #[error("skill requires explicit invocation")]
    ExplicitRequired,
}

impl SkillIdentity {
    pub fn validate(&self) -> Result<(), SkillError> {
        if [&self.environment_id, &self.source_id, &self.revision]
            .iter()
            .any(|value| !name(value, 1024))
        {
            return Err(SkillError::Invalid);
        }
        Ok(())
    }
}
fn name(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}
