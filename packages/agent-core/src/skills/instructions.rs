// Adapted from Codex core-skills/src/skill_instructions.rs at
// e363b08c9175ac1cbe5893615dd2cb9ddf95043b (Apache-2.0).
// Copyright 2025 OpenAI. See third-party/codex/LICENSE and NOTICE.
use super::SkillIdentity;
use serde::{Deserialize, Serialize};

/// Native-frozen skill prompt. User context, separate from research evidence and
/// system instructions. Persisted bytes permit history replay after source removal.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkillInstructions {
    pub identity: SkillIdentity,
    pub name: String,
    pub contents: String,
}
impl SkillInstructions {
    pub fn render(&self) -> String {
        format!(
            "<skill>\n<name>{}</name>\n<source>{}</source>\n{}\n</skill>",
            self.name, self.identity.source_id, self.contents
        )
    }
}
