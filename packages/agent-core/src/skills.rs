// Adapted from OpenAI Codex skills/src/model.rs and ext/skills/src/render.rs
// at e363b08c9175ac1cbe5893615dd2cb9ddf95043b (Apache-2.0).
// Copyright 2025 OpenAI. See third-party/codex/LICENSE and NOTICE.
// Changes: opaque environment provenance, bounded JSON catalog, explicit omissions,
// version-checked demand loading; no Codex plugin/account/path or permission types.
pub mod instructions;
pub mod selection;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SkillIdentity {
    pub environment_id: String,
    pub source_id: String,
    pub revision: String,
}

/// Frozen registration policy for one submission, without native roots or credentials.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SubmissionSkill {
    pub descriptor: SkillDescriptor,
    pub explicit: bool,
}

pub fn validate_submission_skills(skills: &[SubmissionSkill]) -> Result<usize, SkillError> {
    if skills.len() > 256 {
        return Err(SkillError::Invalid);
    }
    render_catalog(
        &skills
            .iter()
            .map(|skill| skill.descriptor.clone())
            .collect::<Vec<_>>(),
        2,
    )?;
    let size = if skills.is_empty() {
        0
    } else {
        serde_json::to_vec(skills)
            .map_err(|_| SkillError::Invalid)?
            .len()
    };
    if size > 2 * 1024 * 1024 {
        return Err(SkillError::Budget);
    }
    Ok(size)
}

/// Supplied by an authorized discovery adapter. A descriptor has no executable
/// tool registrations or permission grants; filename text is never a capability.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SkillDescriptor {
    pub identity: SkillIdentity,
    pub name: String,
    pub description: String,
    pub allow_implicit_invocation: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogEntry {
    pub skill: SkillDescriptor,
    pub description_truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SkillCatalog {
    /// Valid JSON array for model input, within the requested byte budget.
    pub model_text: String,
    /// Omitted identities are UI feedback, not included in model_text's budget.
    pub omitted: Vec<SkillIdentity>,
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
impl SkillDescriptor {
    pub fn validate(&self) -> Result<(), SkillError> {
        self.identity.validate()?;
        if !name(&self.name, 256)
            || self.description.trim().is_empty()
            || self.description.len() > 65536
            || self.description.contains('\0')
        {
            return Err(SkillError::Invalid);
        }
        Ok(())
    }
}
fn name(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}

/// Host supplies deterministic precedence order. Identity, not display name,
/// distinguishes same-named skills from different environments. Validate all
/// descriptors before rendering, including entries that will be omitted.
pub fn render_catalog(
    skills: &[SkillDescriptor],
    max_bytes: usize,
) -> Result<SkillCatalog, SkillError> {
    if !(2..=65536).contains(&max_bytes) {
        return Err(SkillError::Budget);
    }
    if skills.len() > 256 {
        return Err(SkillError::Invalid);
    }
    let mut identities = HashSet::new();
    let mut description_bytes = 0usize;
    for skill in skills {
        skill.validate()?;
        description_bytes += skill.description.len();
        if description_bytes > 1024 * 1024
            || !identities.insert((&skill.identity.environment_id, &skill.identity.source_id))
        {
            return Err(SkillError::Invalid);
        }
    }
    let mut model_text = String::from("[");
    let mut omitted = vec![];
    let mut included = 0usize;
    for skill in skills {
        let description: String = skill.description.chars().take(1024).collect();
        let truncated = description.len() < skill.description.len();
        let mut summary = skill.clone();
        summary.description = description;
        let encoded = serde_json::to_string(&CatalogEntry {
            skill: summary,
            description_truncated: truncated,
        })
        .map_err(|_| SkillError::Invalid)?;
        let separator = usize::from(included > 0);
        if model_text.len() + separator + encoded.len() + 1 > max_bytes {
            omitted.push(skill.identity.clone());
            continue;
        }
        if included > 0 {
            model_text.push(',');
        }
        model_text.push_str(&encoded);
        included += 1;
    }
    model_text.push(']');
    Ok(SkillCatalog {
        model_text,
        omitted,
    })
}

/// Explicit selections are mandatory context. Preserve host order within each
/// group, put explicit entries first, and reject budgets that would omit one.
/// All input metadata is validated even when implicit invocation is disabled.
pub fn render_submission_catalog(
    skills: &[SubmissionSkill],
    max_bytes: usize,
) -> Result<SkillCatalog, SkillError> {
    validate_submission_skills(skills)?;
    let ordered = skills
        .iter()
        .filter(|entry| entry.explicit)
        .chain(
            skills
                .iter()
                .filter(|entry| !entry.explicit && entry.descriptor.allow_implicit_invocation),
        )
        .map(|entry| entry.descriptor.clone())
        .collect::<Vec<_>>();
    let catalog = render_catalog(&ordered, max_bytes)?;
    if skills
        .iter()
        .any(|entry| entry.explicit && catalog.omitted.contains(&entry.descriptor.identity))
    {
        return Err(SkillError::Budget);
    }
    Ok(catalog)
}

/// The native loader must reauthorize the resource, read bounded UTF-8 bytes and
/// compute its revision before this check. Text never grants new capabilities.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LoadedSkill {
    pub identity: SkillIdentity,
    pub body: String,
}

pub fn accept_loaded_skill(
    selected: &SkillDescriptor,
    loaded: LoadedSkill,
    explicit: bool,
    max_bytes: usize,
) -> Result<LoadedSkill, SkillError> {
    selected.validate()?;
    loaded.identity.validate()?;
    if !explicit && !selected.allow_implicit_invocation {
        return Err(SkillError::ExplicitRequired);
    }
    if selected.identity != loaded.identity {
        return Err(SkillError::Stale);
    }
    if max_bytes > 1024 * 1024 || loaded.body.len() > max_bytes {
        return Err(SkillError::Budget);
    }
    if loaded.body.trim().is_empty() || loaded.body.contains('\0') {
        return Err(SkillError::Invalid);
    }
    Ok(loaded)
}
