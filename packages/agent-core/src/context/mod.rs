//! Context assembly policies shared by every Agent host.
pub mod accounting;
pub mod checkpoint;
pub mod checkpoint_store;
pub mod compaction;
pub mod compaction_hooks;
pub mod compaction_strategy;
pub mod remote_compaction_input;
pub mod retained_text;
pub mod text_compaction;
pub mod token_budget;

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Stable identity for a context assembly request.
///
/// This is deliberately smaller than an application session. Writing, reading,
/// notes, and review hosts can each map their own document/version identifiers
/// into this contract without making the core depend on a database or UI type.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextIdentity {
    pub scope: String,
    pub document_id: String,
    pub version: String,
}

impl ContextIdentity {
    pub fn new(
        scope: impl Into<String>,
        document_id: impl Into<String>,
        version: impl Into<String>,
    ) -> Result<Self, ContextError> {
        let identity = Self {
            scope: scope.into(),
            document_id: document_id.into(),
            version: version.into(),
        };
        identity.validate()?;
        Ok(identity)
    }

    fn validate(&self) -> Result<(), ContextError> {
        for value in [&self.scope, &self.document_id, &self.version] {
            if value.trim().is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
                return Err(ContextError::InvalidIdentity);
            }
        }
        Ok(())
    }
}

/// A model-visible fragment contributed by one host or extension.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextFragment {
    pub source: String,
    pub key: String,
    pub priority: i32,
    pub content: String,
}

impl ContextFragment {
    pub fn new(
        source: impl Into<String>,
        key: impl Into<String>,
        priority: i32,
        content: impl Into<String>,
    ) -> Result<Self, ContextError> {
        let fragment = Self {
            source: source.into(),
            key: key.into(),
            priority,
            content: content.into(),
        };
        if fragment.source.trim().is_empty()
            || fragment.key.trim().is_empty()
            || fragment.source.len() > 128
            || fragment.key.len() > 256
            || fragment.content.is_empty()
            || fragment.content.len() > 8 * 1024 * 1024
            || fragment.source.chars().any(char::is_control)
            || fragment.key.chars().any(char::is_control)
        {
            return Err(ContextError::InvalidFragment);
        }
        Ok(fragment)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContextContributionInput<'a> {
    pub identity: &'a ContextIdentity,
    pub turn_id: &'a str,
}

/// Host/extension boundary adapted from Codex's ContextContributor API.
/// Contributors remain synchronous at this layer; adapters may perform I/O
/// before calling the assembler and keep async/runtime concerns out of core.
pub trait ContextContributor: Send + Sync {
    fn id(&self) -> &'static str;
    fn contribute(
        &self,
        input: &ContextContributionInput<'_>,
    ) -> Result<Vec<ContextFragment>, ContextError>;
}

/// Adapt already-materialized submission sources into the shared contributor
/// contract. Native hosts remain responsible for reading and authorizing the
/// bytes; this helper only applies the common identity/key/ordering checks.
pub fn assemble_context_text(
    identity: ContextIdentity,
    turn_id: impl Into<String>,
    sources: &[crate::submission::ContextText],
) -> Result<ContextSnapshot, ContextError> {
    struct Materialized<'a> {
        sources: &'a [crate::submission::ContextText],
    }
    impl ContextContributor for Materialized<'_> {
        fn id(&self) -> &'static str {
            "materialized-submission"
        }

        fn contribute(
            &self,
            _input: &ContextContributionInput<'_>,
        ) -> Result<Vec<ContextFragment>, ContextError> {
            self.sources
                .iter()
                .map(|source| {
                    ContextFragment::new(
                        match &source.kind {
                            crate::submission::ContextSourceKind::Manuscript => "manuscript",
                            crate::submission::ContextSourceKind::Paper => "paper",
                            crate::submission::ContextSourceKind::Note => "note",
                            crate::submission::ContextSourceKind::Retrieval => "retrieval",
                            crate::submission::ContextSourceKind::UserResource => "user-resource",
                        },
                        &source.source_id,
                        0,
                        &source.text,
                    )
                })
                .collect()
        }
    }

    assemble_context(identity, turn_id, &[&Materialized { sources }])
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextSnapshot {
    pub identity: ContextIdentity,
    pub turn_id: String,
    pub fragments: Vec<ContextFragment>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ContextError {
    #[error("context identity is invalid")]
    InvalidIdentity,
    #[error("context fragment is invalid")]
    InvalidFragment,
    #[error("context contributor id is duplicated: {0}")]
    DuplicateContributor(String),
    #[error("context contributor failed: {0}")]
    Contributor(String),
}

/// Deterministic assembly shared by writing, literature, notes and review.
/// Duplicate fragment keys are rejected instead of silently allowing one
/// surface to shadow another. Ordering is priority descending, then source/key.
pub fn assemble_context(
    identity: ContextIdentity,
    turn_id: impl Into<String>,
    contributors: &[&dyn ContextContributor],
) -> Result<ContextSnapshot, ContextError> {
    identity.validate()?;
    let turn_id = turn_id.into();
    if turn_id.trim().is_empty() || turn_id.len() > 256 || turn_id.chars().any(char::is_control) {
        return Err(ContextError::InvalidIdentity);
    }
    let input = ContextContributionInput {
        identity: &identity,
        turn_id: &turn_id,
    };
    let mut contributor_ids = HashSet::new();
    let mut fragments = Vec::new();
    for contributor in contributors {
        if !contributor_ids.insert(contributor.id()) {
            return Err(ContextError::DuplicateContributor(
                contributor.id().to_string(),
            ));
        }
        fragments.extend(contributor.contribute(&input)?);
    }
    fragments.sort_by(|left, right| {
        right
            .priority
            .cmp(&left.priority)
            .then_with(|| left.source.cmp(&right.source))
            .then_with(|| left.key.cmp(&right.key))
    });
    let mut keys = HashSet::new();
    if fragments.iter().any(|fragment| !keys.insert(&fragment.key)) {
        return Err(ContextError::InvalidFragment);
    }
    Ok(ContextSnapshot {
        identity,
        turn_id,
        fragments,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct StaticContributor {
        id: &'static str,
        fragments: Vec<ContextFragment>,
    }

    impl ContextContributor for StaticContributor {
        fn id(&self) -> &'static str {
            self.id
        }

        fn contribute(
            &self,
            input: &ContextContributionInput<'_>,
        ) -> Result<Vec<ContextFragment>, ContextError> {
            assert!(!input.identity.scope.is_empty());
            assert!(!input.turn_id.is_empty());
            Ok(self.fragments.clone())
        }
    }

    #[test]
    fn assembles_deterministically_by_priority_and_key() {
        let high = ContextFragment::new("manuscript", "selection", 10, "selected text").unwrap();
        let low = ContextFragment::new("project", "instructions", 1, "rules").unwrap();
        let identity = ContextIdentity::new("writing", "paper-1", "compile-2").unwrap();
        let first = StaticContributor {
            id: "a",
            fragments: vec![low.clone()],
        };
        let second = StaticContributor {
            id: "b",
            fragments: vec![high.clone()],
        };
        let snapshot = assemble_context(identity, "turn-1", &[&first, &second]).unwrap();
        assert_eq!(snapshot.fragments, vec![high, low]);
    }

    #[test]
    fn rejects_duplicate_contributors_and_fragment_keys() {
        let fragment = ContextFragment::new("source", "same", 0, "text").unwrap();
        let one = StaticContributor {
            id: "same",
            fragments: vec![fragment.clone()],
        };
        let two = StaticContributor {
            id: "same",
            fragments: vec![fragment],
        };
        let identity = ContextIdentity::new("reading", "paper", "v1").unwrap();
        assert_eq!(
            assemble_context(identity.clone(), "turn", &[&one, &two]),
            Err(ContextError::DuplicateContributor("same".into()))
        );
        let other = StaticContributor {
            id: "other",
            fragments: vec![ContextFragment::new("other", "same", 0, "text").unwrap()],
        };
        assert_eq!(
            assemble_context(identity, "turn", &[&one, &other]),
            Err(ContextError::InvalidFragment)
        );
    }

    #[test]
    fn adapts_materialized_sources_without_replacing_source_identity() {
        let sources = vec![crate::submission::ContextText {
            source_id: "paper:abc".into(),
            kind: crate::submission::ContextSourceKind::Paper,
            resource_id: "paper-1".into(),
            revision: "hash-1".into(),
            anchor: Some("page:2".into()),
            text: "evidence".into(),
        }];
        let snapshot = assemble_context_text(
            ContextIdentity::new("reading", "paper-1", "hash-1").unwrap(),
            "turn-1",
            &sources,
        )
        .unwrap();
        assert_eq!(snapshot.fragments[0].key, "paper:abc");
        assert_eq!(snapshot.fragments[0].content, "evidence");
    }

    #[test]
    fn keeps_the_existing_eight_megabyte_materialization_budget() {
        let content = "x".repeat(2 * 1024 * 1024);
        assert!(ContextFragment::new("paper", "large", 0, content).is_ok());
    }
}
