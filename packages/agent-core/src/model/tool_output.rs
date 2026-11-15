//! Middle truncation adapted from OpenAI Codex
//! `codex-rs/utils/string/src/truncate.rs`, commit
//! e363b08c9175ac1cbe5893615dd2cb9ddf95043b, Apache-2.0.
//! Copyright 2025 OpenAI. The marker is additional to the byte budget.

/// Preserve the prefix and suffix without splitting UTF-8 characters.
/// The byte budget applies to retained input; the marker is extra, as in Codex.
pub fn truncate_middle_chars(input: &str, max_bytes: usize) -> String {
    if input.is_empty() || (max_bytes > 0 && input.len() <= max_bytes) {
        return input.to_owned();
    }
    let (left_end, right_begin, removed) = split_middle(input, max_bytes);
    format!(
        "{}…{removed} chars truncated…{}",
        &input[..left_end],
        &input[right_begin..]
    )
}

fn split_middle(input: &str, max_bytes: usize) -> (usize, usize, usize) {
    let left_budget = max_bytes / 2;
    let right_start = input.len().saturating_sub(max_bytes - left_budget);
    let mut left_end = 0;
    let mut right_begin = input.len();
    let mut removed = 0usize;
    let mut right_seen = false;
    for (index, ch) in input.char_indices() {
        if index + ch.len_utf8() <= left_budget {
            left_end = index + ch.len_utf8();
        } else if index >= right_start {
            if !right_seen {
                right_begin = index;
                right_seen = true;
            }
        } else {
            removed = removed.saturating_add(1);
        }
    }
    (left_end, right_begin.max(left_end), removed)
}

/// Codex's approximate-token policy counts four bytes per token. As upstream,
/// the truncation marker is additional to the retained-content budget.
pub fn truncate_middle_tokens(input: &str, max_tokens: usize) -> String {
    if input.is_empty() {
        return String::new();
    }
    let max_bytes = max_tokens.saturating_mul(4);
    if max_bytes > 0 && input.len() <= max_bytes {
        return input.to_owned();
    }
    let (left_end, right_begin, _) = split_middle(input, max_bytes);
    let removed_bytes = input.len().saturating_sub(max_bytes);
    let removed_tokens = removed_bytes.saturating_add(3) / 4;
    format!(
        "{}…{removed_tokens} tokens truncated…{}",
        &input[..left_end],
        &input[right_begin..]
    )
}

/// Check a token-policy view against its complete fact without guessing a
/// former model budget. Character boundaries can waste at most six bytes.
fn is_token_tool_output(input: &str, view: &str) -> bool {
    const END: &str = " tokens truncated…";
    let mut checked_lengths = 0_u32;
    view.match_indices('…').any(|(start, _)| {
        let digits = &view[start + '…'.len_utf8()..];
        let end = digits.bytes().take_while(u8::is_ascii_digit).count();
        if end == 0 || end > 20 || !digits[end..].starts_with(END) {
            return false;
        }
        let bit = 1_u32 << end;
        if checked_lengths & bit != 0 {
            return false;
        }
        checked_lengths |= bit;
        let marker_len = '…'.len_utf8() + end + END.len();
        let Some(retained) = view.len().checked_sub(marker_len) else {
            return false;
        };
        (0..=6).any(|slack| {
            retained.checked_add(slack).is_some_and(|bytes| {
                bytes % 4 == 0 && truncate_middle_tokens(input, bytes / 4) == view
            })
        })
    })
}

/// The trusted model catalog's policy before Codex's serialization allowance.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolOutputPolicy {
    Bytes(usize),
    Tokens(usize),
}

/// Produce the model view from the full fact. Codex applies a 1.2 multiplier
/// before history serialization; the local cap includes the extra marker.
/// Callers must not apply this to an already projected view as if it were the
/// full fact: upstream's marker is outside its retained-content budget.
pub fn project_tool_output(
    input: &str,
    policy: Option<ToolOutputPolicy>,
    hard_cap: usize,
) -> Option<String> {
    let Some(policy) = policy else {
        return bounded_tool_output(input, hard_cap);
    };
    let (limit, bytes_per_unit, tokens) = match policy {
        ToolOutputPolicy::Bytes(limit) => (limit, 1, false),
        ToolOutputPolicy::Tokens(limit) => (limit, 4, true),
    };
    // Match the pinned Codex TruncationPolicy * 1.2 conversion.
    let mut retained =
        (((limit as f64) * 1.2).ceil() as usize).min(input.len().div_ceil(bytes_per_unit));
    loop {
        let view = if tokens {
            truncate_middle_tokens(input, retained)
        } else {
            truncate_middle_chars(input, retained)
        };
        if view.len() <= hard_cap {
            return Some(view);
        }
        let excess = view.len() - hard_cap;
        let reduction = excess.div_ceil(bytes_per_unit);
        if retained < reduction {
            return None;
        }
        retained -= reduction;
    }
}

/// Build a model-facing view that fits the application's total byte cap,
/// including Codex's additional truncation marker.
pub fn bounded_tool_output(input: &str, max_bytes: usize) -> Option<String> {
    if input.len() <= max_bytes {
        return Some(input.to_owned());
    }
    let mut retained = max_bytes;
    loop {
        let output = truncate_middle_chars(input, retained);
        if output.len() <= max_bytes {
            return Some(output);
        }
        let excess = output.len() - max_bytes;
        if retained < excess {
            return None;
        }
        retained -= excess;
    }
}

/// Verify a recorded byte-bounded or Codex token-policy view without knowing
/// its former limit.
/// UTF-8 boundaries can leave at most three unused bytes at each end.
pub fn is_bounded_tool_output(input: &str, view: &str) -> bool {
    if input == view {
        return true;
    }
    is_token_tool_output(input, view)
        || (0..=8).any(|slack| {
            view.len()
                .checked_add(slack)
                .and_then(|limit| bounded_tool_output(input, limit))
                .as_deref()
                == Some(view)
        })
}

/// Apply the same view after loading durable history or a context checkpoint.
pub fn bound_tool_results(messages: &mut [super::ModelMessage], max_bytes: usize) -> bool {
    project_tool_results(messages, None, max_bytes)
}

/// Project complete tool facts once. Already-projected views must be handled by
/// an owner that can prove their original fact before calling this function.
pub fn project_tool_results(
    messages: &mut [super::ModelMessage],
    policy: Option<ToolOutputPolicy>,
    max_bytes: usize,
) -> bool {
    for message in messages {
        if let super::ModelMessage::ToolResult { content, .. } = message {
            let Some(view) = project_tool_output(content, policy, max_bytes) else {
                return false;
            };
            *content = view;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_small_and_empty_outputs() {
        assert_eq!(truncate_middle_chars("", 0), "");
        assert_eq!(truncate_middle_chars("hello", 5), "hello");
        assert_eq!(truncate_middle_chars("abcdef", 0), "…6 chars truncated…");
    }

    #[test]
    fn preserves_prefix_suffix_and_utf8_boundaries() {
        assert_eq!(
            truncate_middle_chars("hello world", 10),
            "hello…1 chars truncated…world"
        );
        assert_eq!(
            truncate_middle_chars("😀abc😀", 10),
            "😀a…1 chars truncated…c😀"
        );
        assert_eq!(
            truncate_middle_chars("😀😀😀😀😀", 2),
            "…5 chars truncated…"
        );
    }

    #[test]
    fn token_policy_matches_codex_estimation_and_utf8_boundaries() {
        assert_eq!(truncate_middle_tokens("", 0), "");
        assert_eq!(truncate_middle_tokens("abcdef", 0), "…2 tokens truncated…");
        assert_eq!(truncate_middle_tokens("short output", 100), "short output");
        assert_eq!(
            truncate_middle_tokens("😀😀😀😀😀😀😀😀😀😀\nsecond line with text\n", 8),
            "😀😀😀😀…8 tokens truncated… line with text\n"
        );
        assert_eq!(truncate_middle_tokens("hello", usize::MAX), "hello");
    }

    #[test]
    fn model_policy_applies_serialization_allowance_and_local_hard_cap() {
        let input = "🦀hello".repeat(100);
        assert_eq!(
            project_tool_output(&input, Some(ToolOutputPolicy::Tokens(10)), 1000),
            Some(truncate_middle_tokens(&input, 12))
        );
        assert_eq!(
            project_tool_output(&input, Some(ToolOutputPolicy::Bytes(10)), 1000),
            Some(truncate_middle_chars(&input, 12))
        );
        for policy in [
            ToolOutputPolicy::Bytes(usize::MAX),
            ToolOutputPolicy::Tokens(usize::MAX),
        ] {
            let view = project_tool_output(&input, Some(policy), 40).unwrap();
            assert!(view.len() <= 40);
            assert!(is_bounded_tool_output(&input, &view));
            assert_eq!(project_tool_output(&input, Some(policy), 5), None);
        }
        assert_eq!(
            project_tool_output("ok", Some(ToolOutputPolicy::Tokens(0)), 100),
            Some("…1 tokens truncated…".into())
        );
        assert_eq!(
            project_tool_output(&input, None, 40),
            bounded_tool_output(&input, 40)
        );
    }

    #[test]
    fn token_projection_must_not_be_reapplied_as_a_full_fact() {
        let input = "a".repeat(100);
        let policy = Some(ToolOutputPolicy::Tokens(5));
        let view = project_tool_output(&input, policy, 100).unwrap();
        assert_ne!(project_tool_output(&view, policy, 100).unwrap(), view);
    }

    #[test]
    fn recognizes_token_views_only_when_derived_from_the_same_fact() {
        for input in [
            "a".repeat(300),
            "😀ab🦀".repeat(60),
            "…12 tokens truncated…".repeat(30),
        ] {
            for budget in 0..=100 {
                let view = truncate_middle_tokens(&input, budget);
                assert!(
                    is_bounded_tool_output(&input, &view),
                    "budget {budget}: {view}"
                );
                if view != input {
                    assert!(!is_bounded_tool_output(&input, &format!("{view}x")));
                }
            }
        }
    }

    #[test]
    fn hard_cap_includes_the_marker_and_never_splits_utf8() {
        let input = "😀hello🌏 world".repeat(10);
        let output = bounded_tool_output(&input, 40).unwrap();
        assert!(output.len() <= 40);
        assert!(output.contains("chars truncated"));
        assert_eq!(bounded_tool_output(&input, 5), None);
        assert_eq!(bounded_tool_output("a", 1).as_deref(), Some("a"));
    }

    #[test]
    fn recognizes_only_views_generated_from_the_full_result() {
        for input in ["a".repeat(300), "😀ab🦀".repeat(60)] {
            for budget in 24..=150 {
                if let Some(view) = bounded_tool_output(&input, budget) {
                    assert!(is_bounded_tool_output(&input, &view), "budget {budget}");
                }
                let upstream = truncate_middle_chars(&input, budget);
                assert!(
                    is_bounded_tool_output(&input, &upstream),
                    "upstream budget {budget}"
                );
            }
            assert!(!is_bounded_tool_output(&input, "fabricated result"));
        }
    }

    #[test]
    fn recognizes_small_codex_byte_views_without_accepting_fabricated_history() {
        for input in ["a".repeat(300), "😀ab🦀".repeat(60)] {
            for budget in 0..24 {
                let view = truncate_middle_chars(&input, budget);
                assert!(
                    is_bounded_tool_output(&input, &view),
                    "budget {budget}: {view}"
                );
                assert!(!is_bounded_tool_output(&input, &format!("{view}x")));
            }
        }
    }
}
