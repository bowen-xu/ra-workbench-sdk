use super::*;
use std::sync::Arc;

fn user(text: &str) -> ModelMessage {
    ModelMessage::User {
        content: vec![ContentPart::Text(text.into())],
        source_item_id: None,
    }
}
fn texts(messages: &[ModelMessage]) -> Vec<&str> {
    messages
        .iter()
        .flat_map(|message| match message {
            ModelMessage::User { content: parts, .. } => parts.as_slice(),
            _ => &[],
        })
        .filter_map(|part| match part {
            ContentPart::Text(text) => Some(text.as_str()),
            _ => None,
        })
        .collect()
}
fn image() -> ContentPart {
    ContentPart::Image {
        media_type: "image/png".into(),
        bytes: Arc::from([1, 2, 3]),
    }
}

#[test]
fn newest_then_boundary_preserve_head_tail_and_chronology() {
    let policy = Utf8RetainedTextPolicy { max_tokens: 3 };
    let kept = retain_users(
        vec![user("older"), user("HEADmiddleTAIL"), user("last")],
        &policy,
    )
    .unwrap();
    assert_eq!(texts(&kept), ["HEAD…2 tokens truncated…TAIL", "last"]);
}

#[test]
fn truncates_parts_individually_and_keeps_boundary_attachments() {
    let policy = Utf8RetainedTextPolicy { max_tokens: 3 };
    let kept = retain_users(
        vec![ModelMessage::User {
            content: vec![
                image(),
                ContentPart::Text("first".into()),
                ContentPart::Text("abcdefgh".into()),
                ContentPart::Text("drop".into()),
                image(),
            ],
            source_item_id: None,
        }],
        &policy,
    )
    .unwrap();
    let ModelMessage::User { content: parts, .. } = &kept[0] else {
        panic!()
    };
    assert_eq!(parts.len(), 4);
    assert!(matches!(parts.first(), Some(ContentPart::Image { .. })));
    assert!(matches!(parts.last(), Some(ContentPart::Image { .. })));
    assert_eq!(texts(&kept), ["first", "ab…1 tokens truncated…gh"]);
}

#[test]
fn attachment_only_costs_one_and_invalid_policy_fails() {
    let kept = retain_users(
        vec![
            user("old"),
            ModelMessage::User {
                content: vec![image()],
                source_item_id: None,
            },
        ],
        &Utf8RetainedTextPolicy { max_tokens: 1 },
    )
    .unwrap();
    assert_eq!(kept.len(), 1);
    assert!(texts(&kept).is_empty());
    assert!(retain_users(vec![], &Utf8RetainedTextPolicy { max_tokens: 0 }).is_err());
}

#[test]
fn unicode_truncation_uses_valid_boundaries() {
    let policy = Utf8RetainedTextPolicy { max_tokens: 2 };
    assert_eq!(
        policy.truncate("开始长长长结束", 2),
        "开…4 tokens truncated…束"
    );
}

#[test]
fn supplier_can_replace_accounting_and_truncation() {
    struct Custom;
    impl RetainedTextPolicy for Custom {
        fn max_tokens(&self) -> u64 {
            1
        }
        fn tokens(&self, text: &str) -> u64 {
            text.chars().count() as u64
        }
        fn truncate(&self, _: &str, _: u64) -> String {
            "supplier summary".into()
        }
    }
    let kept = retain_users(vec![user("abcdef")], &Custom).unwrap();
    assert_eq!(texts(&kept), ["supplier summary"]);
}

fn content_bytes(messages: &[ModelMessage]) -> Option<usize> {
    messages.iter().try_fold(0usize, |sum, message| {
        let ModelMessage::User { content: parts, .. } = message else {
            return None;
        };
        parts.iter().try_fold(sum, |sum, part| {
            sum.checked_add(match part {
                ContentPart::Text(text) => text.len(),
                ContentPart::Image { bytes, .. } => bytes.len(),
            })
        })
    })
}

#[test]
fn byte_guard_truncates_original_newest_text_instead_of_dropping_it() {
    let original = format!("HEAD{}TAIL", "中文\n\"".repeat(100));
    let users = vec![user("older"), user(&original)];
    let kept = retain_users_with_byte_budget(
        users.clone(),
        &Utf8RetainedTextPolicy { max_tokens: 64_000 },
        64,
        content_bytes,
    )
    .unwrap();
    assert_eq!(kept.len(), 1);
    assert!(content_bytes(&kept).unwrap() <= 64);
    let retained = texts(&kept)[0];
    assert!(retained.starts_with("HEAD"));
    assert!(retained.ends_with("TAIL"));
    assert_eq!(retained.matches("tokens truncated").count(), 1);
    assert_eq!(texts(&users), ["older", original.as_str()]);
}

#[test]
fn byte_guard_preserves_boundary_attachments_and_rejects_unfittable_newest() {
    let users = vec![
        user("old"),
        ModelMessage::User {
            content: vec![image(), ContentPart::Text("abcdefgh".repeat(100)), image()],
            source_item_id: None,
        },
    ];
    let policy = Utf8RetainedTextPolicy { max_tokens: 64_000 };
    let kept = retain_users_with_byte_budget(users, &policy, 64, content_bytes).unwrap();
    let ModelMessage::User { content: parts, .. } = &kept[0] else {
        panic!()
    };
    assert_eq!(kept.len(), 1);
    assert!(matches!(parts.first(), Some(ContentPart::Image { bytes, .. }) if **bytes == [1,2,3]));
    assert!(matches!(parts.last(), Some(ContentPart::Image { bytes, .. }) if **bytes == [1,2,3]));
    assert!(content_bytes(&kept).unwrap() <= 64);
    assert!(matches!(
        retain_users_with_byte_budget(
            vec![
                user("old"),
                ModelMessage::User {
                    content: vec![image()],
                    source_item_id: None
                }
            ],
            &policy,
            2,
            content_bytes,
        ),
        Err(CompactionFailure::InvalidBudget)
    ));
}

#[test]
fn byte_guard_exact_boundary_and_measurement_failure() {
    let policy = Utf8RetainedTextPolicy { max_tokens: 64_000 };
    assert_eq!(
        texts(
            &retain_users_with_byte_budget(vec![user("abcd")], &policy, 4, content_bytes).unwrap()
        ),
        ["abcd"]
    );
    assert!(matches!(
        retain_users_with_byte_budget(vec![user("abcd")], &policy, 3, content_bytes),
        Err(CompactionFailure::InvalidBudget)
    ));
    assert!(retain_users_with_byte_budget(vec![], &policy, 0, content_bytes).is_err());
    assert!(retain_users_with_byte_budget(vec![user("abcd")], &policy, 4, |_| None).is_err());
}

#[test]
fn byte_guard_delegates_supplier_units_and_measures_its_marker() {
    struct Characters;
    impl RetainedTextPolicy for Characters {
        fn max_tokens(&self) -> u64 {
            100
        }
        fn tokens(&self, text: &str) -> u64 {
            text.chars().count() as u64
        }
        fn truncate(&self, text: &str, tokens: u64) -> String {
            format!(
                "{}[cut]",
                text.chars().take(tokens as usize).collect::<String>()
            )
        }
    }
    let kept =
        retain_users_with_byte_budget(vec![user(&"中".repeat(30))], &Characters, 11, content_bytes)
            .unwrap();
    assert_eq!(texts(&kept), ["中中[cut]"]);
    assert_eq!(content_bytes(&kept), Some(11));
}
