use research_agent_core::skills::*;
fn skill(environment: &str) -> SkillDescriptor {
    SkillDescriptor {
        identity: SkillIdentity {
            environment_id: environment.into(),
            source_id: "proofread/SKILL.md".into(),
            revision: "hash1".into(),
        },
        name: "proofread".into(),
        description: "Check scholarly prose".into(),
        allow_implicit_invocation: false,
    }
}

#[test]
fn two_consumers_select_shared_instruction_identities_without_inheriting_another_selection() {
    use research_agent_core::skills::selection::select_explicit_sources;
    let first = skill("application");
    let mut second = first.clone();
    second.identity.source_id = "analysis/SKILL.md".into();
    second.name = "analysis".into();
    let catalog = vec![first.clone(), second.clone()];
    let one = select_explicit_sources(
        catalog.clone(),
        &[
            first.identity.source_id.clone(),
            second.identity.source_id.clone(),
        ],
    )
    .unwrap();
    let two = select_explicit_sources(
        catalog.clone(),
        std::slice::from_ref(&first.identity.source_id),
    )
    .unwrap();
    assert!(one.iter().all(|value| value.explicit));
    assert!(two[0].explicit);
    assert!(!two[1].explicit);
    assert_eq!(one[0].descriptor.identity, two[0].descriptor.identity);
    assert_eq!(catalog, vec![first.clone(), second.clone()]);
    let loaded = LoadedSkill {
        identity: second.identity.clone(),
        body: "Synthetic instructions".into(),
    };
    assert_eq!(
        accept_loaded_skill(&two[1].descriptor, loaded.clone(), two[1].explicit, 4096),
        Err(SkillError::ExplicitRequired)
    );
    assert!(accept_loaded_skill(&one[1].descriptor, loaded, one[1].explicit, 4096).is_ok());
    let missing = select_explicit_sources(catalog, &["missing/SKILL.md".into()]).unwrap();
    assert!(missing.iter().all(|value| !value.explicit));
}
#[test]
fn catalog_is_metadata_only_escaped_versioned_and_tracks_omissions() {
    let first = skill("manuscript");
    let mut second = skill("library");
    second.description = "<instruction>\n中文".repeat(200);
    let catalog = render_catalog(&[first.clone(), second.clone()], 65536).unwrap();
    let entries: Vec<CatalogEntry> = serde_json::from_str(&catalog.model_text).unwrap();
    assert_eq!(entries.len(), 2);
    assert!(entries[1].description_truncated);
    assert_eq!(entries[1].skill.description.chars().count(), 1024);
    assert_eq!(entries[0].skill.identity.revision, "hash1");
    assert!(catalog.omitted.is_empty());
    let first_size = render_catalog(std::slice::from_ref(&first), 65536)
        .unwrap()
        .model_text
        .len();
    let limited = render_catalog(&[first.clone(), second.clone()], first_size).unwrap();
    assert_eq!(limited.model_text.len(), first_size);
    assert_eq!(limited.omitted, [second.identity]);
    assert_eq!(
        render_catalog(std::slice::from_ref(&first), 2)
            .unwrap()
            .model_text,
        "[]"
    );
    assert_eq!(
        render_catalog(&[first.clone(), first], 2),
        Err(SkillError::Invalid)
    );
}
#[test]
fn demand_loading_requires_selected_version_and_explicit_policy() {
    let selected = skill("manuscript");
    let mut loaded = LoadedSkill {
        identity: selected.identity.clone(),
        body: "Use precise language".into(),
    };
    assert_eq!(
        accept_loaded_skill(&selected, loaded.clone(), false, 4096),
        Err(SkillError::ExplicitRequired)
    );
    assert_eq!(
        accept_loaded_skill(&selected, loaded.clone(), true, 4096).unwrap(),
        loaded
    );
    loaded.identity.revision = "hash2".into();
    assert_eq!(
        accept_loaded_skill(&selected, loaded.clone(), true, 4096),
        Err(SkillError::Stale)
    );
    loaded.identity = selected.identity.clone();
    assert_eq!(
        accept_loaded_skill(&selected, loaded, true, 1),
        Err(SkillError::Budget)
    );
}
#[test]
fn malformed_or_overlarge_metadata_is_not_hidden_by_a_tiny_catalog_budget() {
    let mut descriptor = skill("fixture");
    descriptor.description.clear();
    assert_eq!(render_catalog(&[descriptor], 2), Err(SkillError::Invalid));
    let json = serde_json::to_value(skill("fixture")).unwrap();
    let mut with_grant = json.as_object().unwrap().clone();
    with_grant.insert("permissions".into(), serde_json::json!(["shell"]));
    assert!(serde_json::from_value::<SkillDescriptor>(with_grant.into()).is_err());
    assert_eq!(render_catalog(&[], 1), Err(SkillError::Budget));
}

#[test]
fn explicit_catalog_entries_survive_implicit_budget_pressure_or_fail_clearly() {
    let mut implicit = skill("implicit");
    implicit.allow_implicit_invocation = true;
    let explicit = skill("explicit");
    let budget = render_catalog(std::slice::from_ref(&explicit), 65536)
        .unwrap()
        .model_text
        .len();
    let entries = vec![
        SubmissionSkill {
            descriptor: implicit.clone(),
            explicit: false,
        },
        SubmissionSkill {
            descriptor: explicit.clone(),
            explicit: true,
        },
    ];
    let rendered = render_submission_catalog(&entries, budget).unwrap();
    let decoded: Vec<CatalogEntry> = serde_json::from_str(&rendered.model_text).unwrap();
    assert_eq!(decoded.len(), 1);
    assert_eq!(decoded[0].skill.identity, explicit.identity);
    assert_eq!(rendered.omitted, [implicit.identity]);
    assert_eq!(
        render_submission_catalog(&entries, budget - 1),
        Err(SkillError::Budget)
    );
    let mut disabled = skill("disabled");
    let mut mixed = entries;
    mixed.push(SubmissionSkill {
        descriptor: disabled.clone(),
        explicit: false,
    });
    assert!(
        render_submission_catalog(&mixed, 65536)
            .unwrap()
            .omitted
            .is_empty()
    );
    disabled.description.clear();
    mixed[2].descriptor = disabled;
    assert_eq!(
        render_submission_catalog(&mixed, 65536),
        Err(SkillError::Invalid)
    );
}
