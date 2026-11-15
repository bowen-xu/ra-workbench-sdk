use research_agent_core::{protocol::ModelIdentity, submission::*};

fn input() -> SubmissionInput {
    SubmissionInput {
        remote_compaction_v2: None,
        skill_instructions: vec![],
        user_input: vec![],
        instructions: vec![],
        instruction_configs: vec![],
        skills: vec![],
        text: "question".into(),
        model: ModelIdentity {
            provider_id: "fixture".into(),
            model_id: "test".into(),
            revision: None,
        },
        reasoning_effort: None,
        service_tier: None,
        context: vec![],
    }
}

#[test]
fn remote_compaction_choice_preserves_legacy_encoding_and_provider_scope() {
    let old = input();
    let old_json = serde_json::to_value(&old).unwrap();
    assert!(old_json.get("remoteCompactionV2").is_none());
    assert_eq!(
        serde_json::from_value::<SubmissionInput>(old_json).unwrap(),
        old
    );
    let mut new = old;
    new.remote_compaction_v2 = Some(false);
    assert_eq!(new.validate(), Err(SubmissionError::InvalidInput));
    new.model.provider_id = "openai".into();
    new.validate().unwrap();
    let json = serde_json::to_value(&new).unwrap();
    assert_eq!(json["remoteCompactionV2"], false);
    assert_eq!(
        serde_json::from_value::<SubmissionInput>(json).unwrap(),
        new
    );
}

#[test]
fn context_materials_have_no_arbitrary_item_count_cap_but_still_require_unique_sources() {
    let mut draft = input();
    draft.context = (0..1024)
        .map(|index| ContextText {
            source_id: format!("source-{index}"),
            kind: ContextSourceKind::Paper,
            resource_id: "paper".into(),
            revision: "version".into(),
            anchor: None,
            text: "evidence".into(),
        })
        .collect();
    draft.validate().unwrap();
    draft.context[1023].source_id = draft.context[0].source_id.clone();
    assert_eq!(draft.validate(), Err(SubmissionError::InvalidInput));
}

#[test]
fn structured_anchors_have_their_own_bound_and_count_toward_the_submission_budget() {
    let mut draft = input();
    draft.context = vec![ContextText {
        source_id: "source".into(),
        kind: ContextSourceKind::Paper,
        resource_id: "paper".into(),
        revision: "grant".into(),
        anchor: Some("a".repeat(2048)),
        text: "directory".into(),
    }];
    draft.validate().unwrap();
    draft.context[0].anchor = Some("a".repeat(65537));
    assert!(draft.validate().is_err());
    draft.context[0].anchor = Some("a".repeat(65536));
    draft.context[0].text = "body".repeat(2_097_152);
    assert!(draft.validate().is_err());
    draft.context[0].source_id = "s".repeat(1025);
    assert!(draft.validate().is_err());
}

#[test]
fn empty_text_requires_a_valid_frozen_image_manifest_without_changing_legacy_shape() {
    let mut draft = input();
    draft.text.clear();
    assert!(draft.validate().is_err());
    let reference = SubmissionImageReference {
        source_id: "source-one".into(),
        content_sha256: "a".repeat(64),
        media_type: "image/png".into(),
        byte_size: 20,
        ordinal: 0,
    };
    draft
        .validate_with_image_references(std::slice::from_ref(&reference))
        .unwrap();
    let encoded = serde_json::to_value(&draft).unwrap();
    assert_eq!(encoded["text"], "");
    assert!(encoded.get("images").is_none());
    for invalid in [
        SubmissionImageReference {
            ordinal: 1,
            ..reference.clone()
        },
        SubmissionImageReference {
            byte_size: 0,
            ..reference.clone()
        },
        SubmissionImageReference {
            content_sha256: "A".repeat(64),
            ..reference.clone()
        },
        SubmissionImageReference {
            media_type: "audio/wav".into(),
            ..reference.clone()
        },
    ] {
        assert!(draft.validate_with_image_references(&[invalid]).is_err());
    }
    let duplicate = SubmissionImageReference {
        ordinal: 1,
        source_id: "second".into(),
        ..reference.clone()
    };
    assert!(
        draft
            .validate_with_image_references(&[reference, duplicate])
            .is_err()
    );
}
#[test]
fn input_bounds_and_unknown_fields_fail_without_truncation() {
    let mut draft = input();
    draft.validate().unwrap();
    draft.text = " ".into();
    assert_eq!(draft.validate(), Err(SubmissionError::InvalidInput));
    draft.text = "a".repeat(1_048_577);
    assert_eq!(draft.validate(), Err(SubmissionError::InvalidInput));
    let mut json = serde_json::to_value(input()).unwrap();
    json["images"] = serde_json::json!(["image.png"]);
    assert!(serde_json::from_value::<SubmissionInput>(json).is_err());
    let mut draft = input();
    draft.model.model_id = "x".repeat(257);
    assert_eq!(draft.validate(), Err(SubmissionError::InvalidInput));
}
#[test]
fn source_versions_and_total_materialization_budget_are_required() {
    let mut draft = input();
    draft.context.push(ContextText {
        source_id: "S1".into(),
        kind: ContextSourceKind::Note,
        resource_id: "note-1".into(),
        revision: "v4".into(),
        anchor: None,
        text: "note".into(),
    });
    let encoded = serde_json::to_string(&draft).unwrap();
    assert_eq!(
        serde_json::from_str::<SubmissionInput>(&encoded).unwrap(),
        draft
    );
    draft.context[0].revision.clear();
    assert_eq!(draft.validate(), Err(SubmissionError::InvalidInput));
    draft.context[0].revision = "v4".into();
    draft.context[0].text = "a".repeat(8_388_608);
    assert_eq!(draft.validate(), Err(SubmissionError::InvalidInput));
}

#[test]
fn frozen_instructions_round_trip_without_changing_legacy_records() {
    use research_agent_core::instructions::*;
    let mut draft = input();
    let legacy = serde_json::to_value(&draft).unwrap();
    assert!(legacy.get("instructions").is_none());
    assert_eq!(
        serde_json::from_value::<SubmissionInput>(legacy).unwrap(),
        draft
    );
    draft.instructions = assemble_instructions(
        vec![InstructionDocument {
            environment_id: "paper".into(),
            scope_id: ".".into(),
            source_id: "AGENTS.md".into(),
            revision: "sha256:fixture".into(),
            text: "Use local style.".into(),
        }],
        1024,
    )
    .unwrap();
    assert_eq!(draft.validate(), Ok(()));
    let encoded = serde_json::to_value(&draft).unwrap();
    assert_eq!(encoded["instructions"][0]["disposition"], "included");
    assert_eq!(
        serde_json::from_value::<SubmissionInput>(encoded.clone()).unwrap(),
        draft
    );
    let mut invalid = encoded;
    invalid["instructions"][0]["grant"] = true.into();
    assert!(serde_json::from_value::<SubmissionInput>(invalid).is_err());
    draft.instructions.push(draft.instructions[0].clone());
    assert_eq!(draft.validate(), Err(SubmissionError::InvalidInput));
    draft.instructions.pop();
    draft.instructions[0].original_bytes = 0;
    assert_eq!(draft.validate(), Err(SubmissionError::InvalidInput));
    draft.instructions[0].original_bytes = 1_048_577;
    draft.instructions[0].text = "a".repeat(1_048_577);
    assert_eq!(draft.validate(), Err(SubmissionError::InvalidInput));
}

#[test]
fn frozen_config_is_round_tripped_validated_and_omitted_for_legacy_inputs() {
    use research_agent_core::config::*;
    let mut submission = input();
    assert!(
        !serde_json::to_string(&submission)
            .unwrap()
            .contains("instructionConfigs")
    );
    submission
        .instruction_configs
        .push(InstructionConfigSnapshot {
            environment_id: "manuscript:fixture".into(),
            layers: vec![ConfigLayer {
                origin: ConfigOrigin {
                    tier: ConfigTier::Workspace,
                    source_id: "agent.toml".into(),
                    revision: "hash1".into(),
                },
                instructions: InstructionConfigPatch {
                    max_bytes: Some(0),
                    fallback_filenames: None,
                },
            }],
        });
    submission.validate().unwrap();
    let encoded = serde_json::to_string(&submission).unwrap();
    assert_eq!(
        serde_json::from_str::<SubmissionInput>(&encoded).unwrap(),
        submission
    );
    let original = submission.clone();
    submission.instruction_configs[0].layers[0].origin.revision = "hash2".into();
    assert_ne!(submission, original);
    submission
        .instruction_configs
        .push(submission.instruction_configs[0].clone());
    assert_eq!(submission.validate(), Err(SubmissionError::InvalidInput));
}

#[test]
fn skills_preserve_frozen_identity_and_invocation_without_native_paths() {
    use research_agent_core::skills::{SkillDescriptor, SkillIdentity, SubmissionSkill};
    let mut draft = input();
    assert!(
        serde_json::to_value(&draft)
            .unwrap()
            .get("skills")
            .is_none()
    );
    draft.skills.push(SubmissionSkill {
        descriptor: SkillDescriptor {
            identity: SkillIdentity {
                environment_id: "paper".into(),
                source_id: "review/SKILL.md".into(),
                revision: "version-1".into(),
            },
            name: "Review".into(),
            description: "Review the manuscript".into(),
            allow_implicit_invocation: false,
        },
        explicit: true,
    });
    draft.validate().unwrap();
    let json = serde_json::to_value(&draft).unwrap();
    assert_eq!(
        serde_json::from_value::<SubmissionInput>(json.clone()).unwrap(),
        draft
    );
    let mut invalid = json;
    invalid["skills"][0]["root"] = "/tmp/forged".into();
    assert!(serde_json::from_value::<SubmissionInput>(invalid).is_err());
    draft.skills.push(draft.skills[0].clone());
    draft.skills[1].descriptor.identity.revision = "version-2".into();
    assert_eq!(draft.validate(), Err(SubmissionError::InvalidInput));
}

#[test]
fn service_tier_is_frozen_without_reencoding_legacy_submissions() {
    let legacy = input();
    let encoded = serde_json::to_value(&legacy).unwrap();
    assert!(encoded.get("serviceTier").is_none());
    assert_eq!(
        serde_json::from_value::<SubmissionInput>(encoded).unwrap(),
        legacy
    );
    let mut fast = legacy;
    fast.model.provider_id = "openai".into();
    fast.service_tier = Some("fast".into());
    fast.validate().unwrap();
    let encoded = serde_json::to_value(&fast).unwrap();
    assert_eq!(encoded["serviceTier"], "fast");
    assert_eq!(
        serde_json::from_value::<SubmissionInput>(encoded).unwrap(),
        fast
    );
    fast.service_tier = Some("flex".into());
    assert_eq!(fast.validate(), Err(SubmissionError::InvalidInput));
    fast.service_tier = Some("fast".into());
    fast.model.provider_id = "deepseek".into();
    assert_eq!(fast.validate(), Err(SubmissionError::InvalidInput));
}
