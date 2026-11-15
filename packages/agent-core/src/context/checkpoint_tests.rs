use super::*;
use crate::{context::compaction_strategy::CompactionKind, protocol::ModelIdentity};
use serde_json::json;

fn checkpoint() -> ContextCheckpoint {
    ContextCheckpoint {
        schema_version: 1,
        window_id: Uuid::from_u128(1),
        conversation_id: Uuid::from_u128(2),
        turn_id: Uuid::from_u128(3),
        source_watermark: 7,
        previous_window_id: None,
        binding: CompactionBinding {
            model: ModelIdentity {
                provider_id: "fixture".into(),
                model_id: "model".into(),
                revision: Some("v1".into()),
            },
            strategy_id: "fixture.text".into(),
            state_schema: 1,
            kind: CompactionKind::TextSummary,
        },
        credential_scope_id: None,
        phase: CompactionPhase::PreTurn,
        output: CompactionOutput::TextSummary("progress; evidence:paper/1/page/3".into()),
        retained: vec![],
        canonical_context: None,
    }
}

#[test]
fn roundtrip_retains_multimodal_input_and_tool_pairs_without_binary_copy() {
    let image: Arc<[u8]> = Arc::from(&b"original image bytes"[..]);
    let messages = vec![
        ModelMessage::User {
            content: vec![
                ContentPart::Text("evidence".into()),
                ContentPart::Image {
                    media_type: "image/png".into(),
                    bytes: image.clone(),
                },
            ],
            source_item_id: None,
        },
        ModelMessage::Assistant {
            phase: None,
            content: vec![],
            tool_calls: vec![ToolCall {
                namespace: None,
                raw_arguments_json: None,
                call_id: "call_1".into(),
                name: "read".into(),
                arguments: json!({"page":3}),
            }],
        },
        ModelMessage::ToolResult {
            call_id: "call_1".into(),
            content: "verified evidence".into(),
            is_error: false,
        },
    ];
    let mut checkpoint = checkpoint();
    checkpoint.retained = store_messages(&messages).unwrap();
    checkpoint.validate(8192).unwrap();
    let encoded = serde_json::to_string(&checkpoint).unwrap();
    assert!(!encoded.contains("original image bytes"));
    let saved: ContextCheckpoint = serde_json::from_str(&encoded).unwrap();
    assert!(saved == checkpoint);
    let hash = format!("{:x}", Sha256::digest(&image));
    let restored =
        restore_messages(&saved.retained, &|key| (key == hash).then(|| image.clone())).unwrap();
    assert!(store_messages(&restored).unwrap() == saved.retained);
    assert!(restore_messages(&saved.retained, &|_| None).is_err());
    assert!(restore_messages(&saved.retained, &|_| Some(Arc::from(&b"wrong"[..]))).is_err());
}

#[test]
fn native_message_phase_roundtrips_and_legacy_checkpoint_without_phase_stays_unknown() {
    let messages = vec![ModelMessage::Assistant {
        content: vec![ContentPart::Text("progress".into())],
        tool_calls: vec![],
        phase: Some(crate::protocol::AssistantMessagePhase::Commentary),
    }];
    let stored = store_messages(&messages).unwrap();
    let encoded = serde_json::to_value(&stored).unwrap();
    assert_eq!(encoded[0]["phase"], "commentary");
    assert!(restore_messages(&stored, &|_| None).unwrap() == messages);
    let legacy: Vec<StoredMessage> = serde_json::from_value(json!([
        {"role":"assistant","content":[{"type":"text","text":"old"}],"tool_calls":[]}
    ]))
    .unwrap();
    assert!(matches!(
        &restore_messages(&legacy, &|_| None).unwrap()[0],
        ModelMessage::Assistant { phase: None, .. }
    ));
}

#[test]
fn rejects_rules_as_history_and_incomplete_tool_pairs() {
    assert!(store_messages(&[ModelMessage::System("authoritative rules".into())]).is_err());
    let mut saved = checkpoint();
    saved.retained = store_messages(&[ModelMessage::Assistant {
        phase: None,
        content: vec![],
        tool_calls: vec![ToolCall {
            namespace: None,
            raw_arguments_json: None,
            call_id: "x".into(),
            name: "read".into(),
            arguments: json!({}),
        }],
    }])
    .unwrap();
    assert_eq!(saved.validate(8192), Err(CompactionFailure::InvalidOutput));
    saved.retained = vec![StoredMessage::ToolResult {
        call_id: "missing".into(),
        content: "result".into(),
        is_error: false,
    }];
    assert_eq!(saved.validate(8192), Err(CompactionFailure::InvalidOutput));
}

#[test]
fn remote_state_and_complete_window_remain_opaque_and_account_bound() {
    let mut saved = checkpoint();
    saved.binding.kind = CompactionKind::RemoteWindow;
    saved.binding.strategy_id = "fixture.remote".into();
    saved.output = CompactionOutput::RemoteWindow(vec![
        json!({"type":"message","role":"user","content":"original"}),
        json!({"type":"vendor_state","state":"opaque"}),
    ]);
    assert_eq!(saved.validate(8192), Err(CompactionFailure::InvalidOutput));
    saved.credential_scope_id = Some(Uuid::from_u128(4));
    saved.validate(8192).unwrap();
    let restored: ContextCheckpoint =
        serde_json::from_str(&serde_json::to_string(&saved).unwrap()).unwrap();
    assert!(restored == saved);
    restored
        .require_compatible(&saved.binding, saved.credential_scope_id)
        .unwrap();
    assert_eq!(
        restored.require_compatible(&saved.binding, Some(Uuid::from_u128(5))),
        Err(CompactionFailure::Incompatible)
    );
    let mut other = saved.binding.clone();
    other.model.revision = Some("v2".into());
    assert_eq!(
        restored.require_compatible(&other, saved.credential_scope_id),
        Err(CompactionFailure::Incompatible)
    );
}

#[test]
fn invalid_schema_identity_and_storage_budget_never_truncate_the_window() {
    let mut saved = checkpoint();
    assert_eq!(saved.validate(1), Err(CompactionFailure::OutputBudget));
    saved.schema_version = 2;
    assert_eq!(saved.validate(8192), Err(CompactionFailure::InvalidOutput));
    saved.schema_version = 1;
    saved.previous_window_id = Some(saved.window_id);
    assert_eq!(saved.validate(8192), Err(CompactionFailure::InvalidOutput));
}

#[test]
fn zero_watermark_only_represents_a_first_manual_window_without_retained_history() {
    let mut saved = checkpoint();
    saved.source_watermark = 0;
    saved.phase = CompactionPhase::Manual;
    saved.validate(8192).unwrap();
    for phase in [CompactionPhase::PreTurn, CompactionPhase::MidTurn] {
        saved.phase = phase;
        assert_eq!(saved.validate(8192), Err(CompactionFailure::InvalidOutput));
    }
    saved.phase = CompactionPhase::Manual;
    saved.previous_window_id = Some(Uuid::from_u128(90));
    assert_eq!(saved.validate(8192), Err(CompactionFailure::InvalidOutput));
    saved.previous_window_id = None;
    saved.retained = vec![StoredMessage::User {
        source_item_id: None,
        content: vec![StoredContent::Text {
            text: "not empty history".into(),
        }],
    }];
    assert_eq!(saved.validate(8192), Err(CompactionFailure::InvalidOutput));
}

fn mid_turn() -> ContextCheckpoint {
    let mut saved = checkpoint();
    saved.schema_version = 2;
    saved.phase = CompactionPhase::MidTurn;
    saved.retained = store_messages(&[
        ModelMessage::User {
            content: vec![ContentPart::Text("earlier user".into())],
            source_item_id: None,
        },
        ModelMessage::User {
            content: vec![ContentPart::Text("last real user".into())],
            source_item_id: None,
        },
    ])
    .unwrap();
    saved.canonical_context = Some(CanonicalContext {
        before_retained: 1,
        messages: store_messages(&[ModelMessage::User {
            content: vec![ContentPart::Text(
                "frozen project rules and exact loaded skill body".into(),
            )],
            source_item_id: None,
        }])
        .unwrap(),
    });
    saved
}

#[test]
fn canonical_context_roundtrips_before_last_real_user_without_becoming_retained_input() {
    let saved = mid_turn();
    let encoded = serde_json::to_vec(&saved).unwrap();
    let restored: ContextCheckpoint = serde_json::from_slice(&encoded).unwrap();
    let window = restored.restore_text_window(&|_| None).unwrap();
    let texts: Vec<_> = window
        .iter()
        .map(|message| match message {
            ModelMessage::User { content: parts, .. } => match &parts[0] {
                ContentPart::Text(text) => text.as_str(),
                _ => panic!(),
            },
            _ => panic!(),
        })
        .collect();
    assert_eq!(
        texts,
        vec![
            "earlier user",
            "frozen project rules and exact loaded skill body",
            "last real user",
            "progress; evidence:paper/1/page/3"
        ]
    );
    assert_eq!(restored.retained.len(), 2);
    let mut no_users = mid_turn();
    no_users.retained.clear();
    no_users.canonical_context.as_mut().unwrap().before_retained = 0;
    assert_eq!(no_users.restore_text_window(&|_| None).unwrap().len(), 2);
}

#[test]
fn opaque_mid_turn_restores_canonical_before_last_user_without_plaintext_state() {
    let mut saved = mid_turn();
    saved.binding.kind = CompactionKind::RemoteOpaque;
    saved.binding.strategy_id = "fixture.v2".into();
    saved.credential_scope_id = Some(Uuid::from_u128(4));
    saved.output = CompactionOutput::RemoteOpaque(
        json!({"type":"compaction", "encrypted_content":"opaque state", "unknown_field":42}),
    );
    saved.validate(8192).unwrap();
    let encoded = serde_json::to_vec(&saved).unwrap();
    let restored: ContextCheckpoint = serde_json::from_slice(&encoded).unwrap();
    let messages = restored.restore_opaque_messages(&|_| None).unwrap();
    assert!(
        store_messages(&messages).unwrap()
            == vec![
                saved.retained[0].clone(),
                saved.canonical_context.as_ref().unwrap().messages[0].clone(),
                saved.retained[1].clone()
            ]
    );
    assert!(restored.output == saved.output);
    assert!(restored.restore_text_window(&|_| None).is_err());
    restored
        .require_compatible(&saved.binding, Some(Uuid::from_u128(4)))
        .unwrap();
    assert!(
        restored
            .require_compatible(&saved.binding, Some(Uuid::from_u128(5)))
            .is_err()
    );
    saved.canonical_context.as_mut().unwrap().before_retained = 0;
    assert_eq!(
        saved.restore_opaque_messages(&|_| None).err(),
        Some(CompactionFailure::InvalidOutput)
    );
    assert!(checkpoint().restore_opaque_messages(&|_| None).is_err());
}

#[test]
fn canonical_context_rejects_wrong_placement_scope_and_tool_or_system_impersonation() {
    for change in 0..5 {
        let mut saved = mid_turn();
        match change {
            0 => saved.schema_version = 1,
            1 => saved.phase = CompactionPhase::PreTurn,
            2 => saved.canonical_context.as_mut().unwrap().before_retained = 0,
            3 => {
                saved.canonical_context.as_mut().unwrap().messages =
                    vec![StoredMessage::ToolResult {
                        call_id: "unauthorized".into(),
                        content: "tool result".into(),
                        is_error: false,
                    }]
            }
            4 => saved.binding.kind = CompactionKind::RemoteWindow,
            _ => unreachable!(),
        }
        assert!(saved.restore_text_window(&|_| None).is_err());
    }
}

#[test]
fn full_provider_window_restores_canonical_tail_without_projecting_protocol_objects() {
    let mut saved = mid_turn();
    saved.credential_scope_id = Some(Uuid::from_u128(4));
    saved.binding.kind = CompactionKind::RemoteWindow;
    saved.output = CompactionOutput::RemoteWindow(vec![
        serde_json::json!({"type":"future_item","opaque":"retained"}),
    ]);
    saved.retained.clear();
    saved.canonical_context.as_mut().unwrap().before_retained = 0;
    let restored = saved.restore_provider_window_tail(&|_| None).unwrap();
    assert!(
        restored
            == super::restore_messages(
                &saved.canonical_context.as_ref().unwrap().messages,
                &|_| { None }
            )
            .unwrap()
    );
    saved.retained.push(super::StoredMessage::User {
        source_item_id: None,
        content: vec![super::StoredContent::Text {
            text: "duplicate history".into(),
        }],
    });
    assert!(saved.restore_provider_window_tail(&|_| None).is_err());
}

#[test]
fn legacy_window_has_no_canonical_field_and_restores_without_schema_upgrade() {
    let legacy = checkpoint();
    let encoded = serde_json::to_string(&legacy).unwrap();
    assert!(!encoded.contains("canonical_context"));
    let saved: ContextCheckpoint = serde_json::from_str(&encoded).unwrap();
    assert_eq!(saved.schema_version, 1);
    assert_eq!(saved.restore_text_window(&|_| None).unwrap().len(), 1);
}

#[test]
fn empty_provider_window_roundtrips_without_losing_canonical_tail_or_credentials() {
    let mut saved = mid_turn();
    saved.credential_scope_id = Some(Uuid::from_u128(4));
    saved.binding.kind = CompactionKind::RemoteWindow;
    saved.output = CompactionOutput::RemoteWindow(vec![]);
    saved.retained.clear();
    saved.canonical_context.as_mut().unwrap().before_retained = 0;
    saved.validate(8192).unwrap();
    let decoded: ContextCheckpoint =
        serde_json::from_str(&serde_json::to_string(&saved).unwrap()).unwrap();
    assert!(decoded == saved);
    assert!(
        !decoded
            .restore_provider_window_tail(&|_| None)
            .unwrap()
            .is_empty()
    );
    saved.credential_scope_id = None;
    assert_eq!(saved.validate(8192), Err(CompactionFailure::InvalidOutput));
}

#[test]
fn reset_checkpoint_restores_canonical_only_in_every_phase() {
    for phase in [
        CompactionPhase::Manual,
        CompactionPhase::PreTurn,
        CompactionPhase::MidTurn,
    ] {
        let mut saved = checkpoint();
        saved.schema_version = 2;
        saved.binding.kind = CompactionKind::ResetWindow;
        saved.output = CompactionOutput::ResetWindow;
        saved.phase = phase;
        saved.canonical_context = Some(CanonicalContext {
            before_retained: 0,
            messages: vec![StoredMessage::User {
                source_item_id: None,
                content: vec![StoredContent::Text {
                    text: "current authoritative context".into(),
                }],
            }],
        });
        saved.validate(8192).unwrap();
        let bytes = serde_json::to_vec(&saved).unwrap();
        let restored: ContextCheckpoint = serde_json::from_slice(&bytes).unwrap();
        let messages = restored.restore_reset_window(&|_| None).unwrap();
        assert!(
            messages
                == vec![ModelMessage::User {
                    content: vec![ContentPart::Text("current authoritative context".into())],
                    source_item_id: None
                }]
        );
        assert!(restored.restore_text_window(&|_| None).is_err());
        assert!(restored.restore_opaque_messages(&|_| None).is_err());
        assert!(restored.restore_provider_window_tail(&|_| None).is_err());
        saved.canonical_context.as_mut().unwrap().messages.clear();
        assert!(saved.restore_reset_window(&|_| None).unwrap().is_empty());
    }
}

#[test]
fn reset_rejects_legacy_missing_context_old_history_and_credential_state() {
    let mut saved = checkpoint();
    saved.schema_version = 2;
    saved.binding.kind = CompactionKind::ResetWindow;
    saved.output = CompactionOutput::ResetWindow;
    saved.canonical_context = Some(CanonicalContext {
        before_retained: 0,
        messages: vec![],
    });
    for invalid in 0..6 {
        let mut corrupt = saved.clone();
        match invalid {
            0 => corrupt.schema_version = 1,
            1 => corrupt.canonical_context = None,
            2 => corrupt.retained.push(StoredMessage::User {
                source_item_id: None,
                content: vec![StoredContent::Text {
                    text: "old history".into(),
                }],
            }),
            3 => corrupt.credential_scope_id = Some(Uuid::from_u128(8)),
            4 => corrupt.canonical_context.as_mut().unwrap().before_retained = 1,
            5 => corrupt.canonical_context.as_mut().unwrap().messages.push(
                StoredMessage::ToolResult {
                    call_id: "old-call".into(),
                    content: "result".into(),
                    is_error: false,
                },
            ),
            _ => unreachable!(),
        }
        assert!(corrupt.validate(8192).is_err());
    }
    assert!(saved.validate(1).is_err());
}

#[test]
fn developer_context_roundtrips_only_in_schema_three_canonical_context() {
    let mut saved = checkpoint();
    saved.schema_version = 3;
    saved.binding.kind = CompactionKind::ResetWindow;
    saved.output = CompactionOutput::ResetWindow;
    let messages = vec![
        ModelMessage::Developer(
            "<context_window_guidance>\ntrusted\n</context_window_guidance>".into(),
        ),
        ModelMessage::User {
            content: vec![ContentPart::Text("frozen resource context".into())],
            source_item_id: None,
        },
    ];
    saved.canonical_context = Some(CanonicalContext {
        before_retained: 0,
        messages: store_messages(&messages).unwrap(),
    });
    saved.validate(8192).unwrap();
    let encoded = serde_json::to_value(&saved).unwrap();
    assert_eq!(
        encoded["canonical_context"]["messages"][0]["role"],
        "developer"
    );
    let restored: ContextCheckpoint = serde_json::from_value(encoded).unwrap();
    assert!(restored.restore_reset_window(&|_| None).unwrap() == messages);
    let mut old_schema = restored.clone();
    old_schema.schema_version = 2;
    assert_eq!(
        old_schema.validate(8192),
        Err(CompactionFailure::InvalidOutput)
    );
    let mut empty = restored.clone();
    empty.canonical_context.as_mut().unwrap().messages[0] = StoredMessage::Developer {
        text: String::new(),
    };
    assert_eq!(empty.validate(8192), Err(CompactionFailure::InvalidOutput));
    // Historical/model output is never promoted into developer authority.
    let mut historical = checkpoint();
    historical.retained = store_messages(&messages[..1]).unwrap();
    for version in [1, 2, 3] {
        historical.schema_version = version;
        assert!(historical.validate(8192).is_err());
    }
}

#[test]
fn schema_four_marks_only_mid_turn_provider_windows_and_survives_roundtrip() {
    let mut saved = checkpoint();
    saved.schema_version = 4;
    saved.phase = CompactionPhase::MidTurn;
    saved.binding.kind = CompactionKind::RemoteWindow;
    saved.credential_scope_id = Some(Uuid::from_u128(9));
    saved.output = CompactionOutput::RemoteWindow(vec![
        json!({"type":"compaction","encrypted_content":"synthetic"}),
    ]);
    saved.canonical_context = Some(CanonicalContext {
        before_retained: 0,
        messages: vec![StoredMessage::Developer {
            text: "current rules".into(),
        }],
    });
    saved.validate(16384).unwrap();
    let restored: ContextCheckpoint =
        serde_json::from_slice(&serde_json::to_vec(&saved).unwrap()).unwrap();
    assert_eq!(restored.schema_version, 4);
    assert!(
        restored.restore_provider_window_tail(&|_| None).unwrap()
            == vec![ModelMessage::Developer("current rules".into())]
    );
    for phase in [CompactionPhase::Manual, CompactionPhase::PreTurn] {
        let mut invalid = restored.clone();
        invalid.phase = phase;
        assert!(invalid.validate(16384).is_err());
    }
    saved.schema_version = 3;
    saved.validate(16384).unwrap();
}
