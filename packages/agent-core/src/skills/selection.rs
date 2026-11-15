// Adapted from OpenAI Codex core-skills/src/injection.rs at
// e363b08c9175ac1cbe5893615dd2cb9ddf95043b, Apache-2.0, Copyright 2025 OpenAI.
// Changes: frozen research catalog identities, no filesystem lookup or connectors.
use super::{SkillDescriptor, SkillError, SubmissionSkill, render_catalog};
use std::collections::{HashMap, HashSet};

/// Structured bindings take precedence over text fallback, as in Codex's
/// collect_explicit_skill_mentions. Names never redirect an exact identity.
pub fn select_inputs(
    catalog: Vec<SkillDescriptor>,
    text: &str,
    input: &[crate::user_input::UserInput],
) -> Result<Vec<SubmissionSkill>, SkillError> {
    let mut selected = select_explicit(catalog, text)?;
    for item in input {
        if let crate::user_input::UserInput::Skill { name, identity } = item {
            let Some(skill) = selected.iter_mut().find(|skill| {
                &skill.descriptor.identity == identity && &skill.descriptor.name == name
            }) else {
                continue;
            };
            skill.explicit = true;
        }
    }
    // The user-selected order controls injection; remaining catalog entries
    // retain discovery order for implicit demand loading.
    selected.sort_by_key(|skill| input.iter().position(|item| matches!(item, crate::user_input::UserInput::Skill {identity, ..} if identity == &skill.descriptor.identity)).unwrap_or(usize::MAX));
    Ok(selected)
}

/// Only direct user input belongs here. Never pass source, tool or assistant text.
/// Plain names select only unique catalog names; linked paths select only unique
/// exact source IDs. Unknown or ambiguous mentions grant nothing.
pub fn select_explicit(
    skills: Vec<SkillDescriptor>,
    text: &str,
) -> Result<Vec<SubmissionSkill>, SkillError> {
    if text.len() > 1024 * 1024 {
        return Err(SkillError::Budget);
    }
    render_catalog(&skills, 2)?;
    let mut names = HashSet::new();
    let mut paths = HashSet::new();
    let bytes = text.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'$' {
            index += 1;
            continue;
        }
        let start = index + 1;
        let mut end = start;
        while end < bytes.len() && is_name(bytes[end]) {
            end += 1;
        }
        if start == end {
            index += 1;
            continue;
        }
        let name = &text[start..end];
        if index > 0 && bytes[index - 1] == b'[' && bytes.get(end..end + 2) == Some(b"](") {
            let target_start = end + 2;
            let Some(offset) = text[target_start..].find(')') else {
                break;
            };
            let target_end = target_start + offset;
            let target = &text[target_start..target_end];
            // An explicit link never falls back to its display name.
            if !is_env(name) && !target.contains("://") {
                paths.insert(target);
            } else if !is_env(name)
                && let Some(path) = target.strip_prefix("skill://")
            {
                paths.insert(path);
            }
            index = target_end + 1;
        } else {
            if !is_env(name) {
                names.insert(name);
            }
            index = end;
        }
    }
    let mut name_counts = HashMap::new();
    let mut path_counts = HashMap::new();
    for skill in &skills {
        *name_counts.entry(skill.name.clone()).or_insert(0usize) += 1;
        *path_counts
            .entry(skill.identity.source_id.clone())
            .or_insert(0usize) += 1;
    }
    Ok(skills
        .into_iter()
        .map(|descriptor| {
            let explicit = (names.contains(descriptor.name.as_str())
                && name_counts[&descriptor.name] == 1)
                || (paths.contains(descriptor.identity.source_id.as_str())
                    && path_counts[&descriptor.identity.source_id] == 1);
            SubmissionSkill {
                descriptor,
                explicit,
            }
        })
        .collect())
}

/// Select explicitly supplied catalog identities without converting them into
/// prompt text. This is the application equivalent of Codex's structured skill
/// input item: unknown identities and ambiguous catalog entries select nothing.
pub fn select_explicit_sources(
    skills: Vec<SkillDescriptor>,
    source_ids: &[String],
) -> Result<Vec<SubmissionSkill>, SkillError> {
    if source_ids.len() > 256
        || source_ids
            .iter()
            .any(|source| source.is_empty() || source.len() > 1024)
    {
        return Err(SkillError::Invalid);
    }
    render_catalog(&skills, 2)?;
    let requested: HashSet<String> = source_ids.iter().cloned().collect();
    let mut path_counts = HashMap::new();
    for skill in &skills {
        *path_counts
            .entry(skill.identity.source_id.clone())
            .or_insert(0usize) += 1;
    }
    Ok(skills
        .into_iter()
        .map(|descriptor| SubmissionSkill {
            explicit: requested.contains(&descriptor.identity.source_id)
                && path_counts[&descriptor.identity.source_id] == 1,
            descriptor,
        })
        .collect())
}
fn is_name(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b':')
}
fn is_env(name: &str) -> bool {
    matches!(
        name,
        "PATH"
            | "HOME"
            | "USER"
            | "SHELL"
            | "PWD"
            | "OLDPWD"
            | "TMPDIR"
            | "TEMP"
            | "TMP"
            | "LANG"
            | "TERM"
            | "XDG_CONFIG_HOME"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skills::SkillIdentity;
    #[test]
    fn structured_mentions_preserve_order_and_distinguish_same_names() {
        use crate::user_input::UserInput;
        let a = skill("review", "application/review/SKILL.md");
        let mut b = skill("review", "workspace/review/SKILL.md");
        b.identity.environment_id = "workspace".into();
        b.allow_implicit_invocation = false;
        let mentions = vec![
            UserInput::Skill {
                name: b.name.clone(),
                identity: b.identity.clone(),
            },
            UserInput::Skill {
                name: a.name.clone(),
                identity: a.identity.clone(),
            },
            UserInput::Skill {
                name: b.name.clone(),
                identity: b.identity.clone(),
            },
        ];
        let selected =
            select_inputs(vec![a.clone(), b.clone()], "@review @review", &mentions).unwrap();
        assert_eq!(selected[0].descriptor.identity, b.identity);
        assert_eq!(selected[1].descriptor.identity, a.identity);
        assert!(selected.iter().all(|skill| skill.explicit));
        assert_eq!(
            select_inputs(vec![a], "@review", &mentions).unwrap().len(),
            1
        );
        assert!(!select_inputs(vec![b], "@review", &[]).unwrap()[0].explicit);
    }
    fn skill(name: &str, source: &str) -> SkillDescriptor {
        SkillDescriptor {
            identity: SkillIdentity {
                environment_id: "paper".into(),
                source_id: source.into(),
                revision: "v1".into(),
            },
            name: name.into(),
            description: "Review".into(),
            allow_implicit_invocation: false,
        }
    }
    #[test]
    fn exact_names_links_and_ambiguity_follow_catalog_identity() {
        let catalog = vec![
            skill("review", "one/SKILL.md"),
            skill("other", "two/SKILL.md"),
        ];
        for text in [
            "Use $review.",
            "($review)",
            "Use [$review](one/SKILL.md)",
            "[$x](skill://one/SKILL.md)",
        ] {
            let selected = select_explicit(catalog.clone(), text).unwrap();
            assert!(selected[0].explicit);
            assert!(!selected[1].explicit);
        }
        for text in [
            "$review_extra",
            "$reviews",
            "[$review](https://example.com)",
            "[$review](missing/SKILL.md)",
            "review",
        ] {
            assert!(!select_explicit(catalog.clone(), text).unwrap()[0].explicit);
        }
        let duplicate = vec![
            skill("review", "one/SKILL.md"),
            skill("review", "two/SKILL.md"),
        ];
        assert!(
            select_explicit(duplicate.clone(), "$review")
                .unwrap()
                .iter()
                .all(|s| !s.explicit)
        );
        let exact = select_explicit(duplicate, "[$review](two/SKILL.md)").unwrap();
        assert!(!exact[0].explicit);
        assert!(exact[1].explicit);
    }
    #[test]
    fn environment_variables_unicode_and_long_dollar_runs_do_not_expand_scope() {
        assert!(
            !select_explicit(vec![skill("HOME", "home/SKILL.md")], "$HOME").unwrap()[0].explicit
        );
        let text = format!("中文 {} $review", "$".repeat(10000));
        assert!(
            select_explicit(vec![skill("review", "review/SKILL.md")], &text).unwrap()[0].explicit
        );
        assert!(select_explicit(vec![], &"x".repeat(1048577)).is_err());
    }

    #[test]
    fn structured_source_selection_is_exact_and_does_not_fallback_to_names() {
        let catalog = vec![
            skill("review", "one/SKILL.md"),
            skill("review", "two/SKILL.md"),
        ];
        let selected = select_explicit_sources(
            catalog,
            &["two/SKILL.md".to_owned(), "missing/SKILL.md".to_owned()],
        )
        .unwrap();
        assert!(!selected[0].explicit);
        assert!(selected[1].explicit);
    }

    #[test]
    fn structured_source_selection_rejects_unbounded_input() {
        assert!(select_explicit_sources(vec![], &["x".repeat(1025)]).is_err());
    }
}
