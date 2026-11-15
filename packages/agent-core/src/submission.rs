//! Immutable, versioned submission input. Resource permission checks and model
//! resolution happen in the native host before constructing this record.
use crate::protocol::ModelIdentity;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, future::Future, pin::Pin, sync::Arc};
use uuid::Uuid;
mod history;
pub use history::HistoricalTurnInput;
mod image_references;
pub use image_references::{SubmissionImageReference, validate_image_references};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ContextSourceKind {
    Manuscript,
    Paper,
    Note,
    Retrieval,
    UserResource,
}

/// Version and anchor are opaque identifiers owned by the source adapter, not
/// filesystem access grants or instructions. Text is the frozen materialization.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextText {
    pub source_id: String,
    pub kind: ContextSourceKind,
    pub resource_id: String,
    pub revision: String,
    pub anchor: Option<String>,
    pub text: String,
}

impl ContextText {
    /// Build a frozen retrieval fragment with the stable source identity used
    /// by every Agent host. The host must validate the trace's scope, query,
    /// expiry and authorization before calling this constructor; this method
    /// only encodes the provider-neutral submission shape.
    pub fn retrieval(
        trace_id: &str,
        resource_id: &str,
        revision: &str,
        query: &str,
        text: String,
        anchor: Option<String>,
    ) -> Result<Self, SubmissionError> {
        if trace_id.trim().is_empty()
            || trace_id.len() > 160
            || trace_id.chars().any(char::is_control)
            || resource_id.trim().is_empty()
            || revision.trim().is_empty()
            || query.trim().is_empty()
            || query.len() > 16_384
            || query.chars().any(char::is_control)
        {
            return Err(SubmissionError::InvalidInput);
        }
        Ok(Self {
            source_id: format!("retrieval:{trace_id}"),
            kind: ContextSourceKind::Retrieval,
            resource_id: resource_id.to_owned(),
            revision: revision.to_owned(),
            anchor,
            text,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmissionInput {
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub user_input: Vec<crate::user_input::UserInput>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skill_instructions: Vec<crate::skills::instructions::SkillInstructions>,
    pub model: ModelIdentity,
    pub reasoning_effort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_tier: Option<String>,
    /// Native feature choice frozen with this submission; omission is the
    /// historical default (remote compaction V2).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_compaction_v2: Option<bool>,
    pub context: Vec<ContextText>,
    /// Trusted instruction materialization, separate from research evidence.
    /// Empty omission preserves the encoded form of existing submissions.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub instructions: Vec<crate::instructions::InstructionFragment>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub instruction_configs: Vec<crate::config::InstructionConfigSnapshot>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skills: Vec<crate::skills::SubmissionSkill>,
}
impl SubmissionInput {
    /// Bounds are storage admission limits, not token estimates or permission checks.
    /// Text-only admission requires text. Image-aware adapters validate the
    /// separately frozen manifest without converting images into placeholder text.
    pub fn validate(&self) -> Result<(), SubmissionError> {
        self.validate_with_image_references(&[])
    }

    /// A storage adapter supplies the immutable manifest for this exact receipt.
    /// These are shape checks, never content access grants or proof of readability.
    pub fn validate_with_image_references(
        &self,
        images: &[SubmissionImageReference],
    ) -> Result<(), SubmissionError> {
        validate_image_references(images)?;
        if self.remote_compaction_v2.is_some() && self.model.provider_id != "openai" {
            return Err(SubmissionError::InvalidInput);
        }
        if self.service_tier.as_deref().is_some_and(|tier| {
            self.model.provider_id != "openai" || !matches!(tier, "fast" | "default")
        }) {
            return Err(SubmissionError::InvalidInput);
        }
        crate::user_input::validate(&self.user_input, &self.text)?;
        // Unresolved tags remain display metadata, not executable skills.
        let mut injected = HashSet::new();
        let mut instruction_bytes = 0usize;
        for prompt in &self.skill_instructions {
            let Some(skill) = self
                .skills
                .iter()
                .find(|skill| skill.descriptor.identity == prompt.identity)
            else {
                return Err(SubmissionError::InvalidInput);
            };
            instruction_bytes += prompt.contents.len();
            if !skill.explicit
                || skill.descriptor.name != prompt.name
                || !injected.insert((&prompt.identity.environment_id, &prompt.identity.source_id))
                || prompt.contents.is_empty()
                || prompt.contents.contains('\0')
                || instruction_bytes > 1_048_576
            {
                return Err(SubmissionError::InvalidInput);
            }
        }
        let name =
            |value: &str| !value.trim().is_empty() && value.len() <= 1024 && !value.contains('\0');
        let model_name = |value: &str| name(value) && value.chars().count() <= 256;
        if (self.text.trim().is_empty() && images.is_empty())
            || self.text.len() > 1_048_576
            || !model_name(&self.model.provider_id)
            || !model_name(&self.model.model_id)
            || self
                .model
                .revision
                .as_ref()
                .is_some_and(|value| !model_name(value))
            || self
                .reasoning_effort
                .as_ref()
                .is_some_and(|value| !name(value))
        {
            return Err(SubmissionError::InvalidInput);
        }
        validate_instructions(&self.instructions)?;
        crate::config::validate_snapshots(&self.instruction_configs)
            .map_err(|_| SubmissionError::InvalidInput)?;
        let skill_size = crate::skills::validate_submission_skills(&self.skills)
            .map_err(|_| SubmissionError::InvalidInput)?;
        let mut source_ids = HashSet::new();
        let config_size = if self.instruction_configs.is_empty() {
            0
        } else {
            serde_json::to_vec(&self.instruction_configs)
                .map_err(|_| SubmissionError::InvalidInput)?
                .len()
        };
        let mut size = self.text.len()
            + if self.user_input.is_empty() {
                0
            } else {
                serde_json::to_vec(&self.user_input)
                    .map_err(|_| SubmissionError::InvalidInput)?
                    .len()
            }
            + instruction_bytes
            + config_size
            + skill_size
            + self
                .instructions
                .iter()
                .map(|entry| entry.text.len())
                .sum::<usize>();
        if size > 8_388_608 {
            return Err(SubmissionError::InvalidInput);
        }
        for source in &self.context {
            if !name(&source.source_id)
                || !name(&source.resource_id)
                || !name(&source.revision)
                || source.anchor.as_ref().is_some_and(|value| {
                    value.trim().is_empty() || value.len() > 65_536 || value.contains('\0')
                })
                || !source_ids.insert(&source.source_id)
            {
                return Err(SubmissionError::InvalidInput);
            }
            size = size
                .checked_add(source.text.len() + source.anchor.as_ref().map_or(0, String::len))
                .ok_or(SubmissionError::InvalidInput)?;
            if size > 8_388_608 {
                return Err(SubmissionError::InvalidInput);
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SubmissionRecord {
    pub conversation_id: Uuid,
    pub request_id: Uuid,
    pub turn_id: Uuid,
    pub context_snapshot_id: Uuid,
    pub input: SubmissionInput,
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum SubmissionError {
    #[error("invalid submission input")]
    InvalidInput,
    #[error("submission identity reused with different input")]
    Conflict,
    #[error("conversation or submission not found")]
    NotFound,
    #[error("submission storage unavailable")]
    Unavailable,
    #[error("submission is corrupt or unsupported")]
    Corrupt,
}
pub type SubmissionFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, SubmissionError>> + Send + 'a>>;

/// Acknowledges durable input only; it never starts or restarts model/tool work.
/// Losing a reply is recovered by resubmitting the exact input with the same ID.
pub trait SubmissionStore: Send + Sync {
    /// Frozen image handles are materialized by the host; source links never
    /// authorize I/O. Text-only adapters fail closed on image references.
    fn evidence_content<'a>(
        &'a self,
        input: &'a [crate::user_input::UserInput],
    ) -> SubmissionFuture<'a, Vec<crate::model::ContentPart>> {
        Box::pin(async move {
            crate::user_input::evidence::content(input, |_| Err(SubmissionError::Unavailable))
        })
    }
    /// Metadata bound by the storage owner to the exact immutable submission.
    /// Text-only adapters return no images and cannot admit an empty text record.
    fn get_image_references(
        &self,
        _conversation_id: Uuid,
        _request_id: Uuid,
    ) -> SubmissionFuture<'_, Vec<SubmissionImageReference>> {
        Box::pin(async { Ok(vec![]) })
    }
    /// Frozen same-turn additions, keyed by user item. The caller filters these
    /// against the visible journal, including when a fork cuts a turn short.
    fn get_history_steering(
        &self,
        _conversation_id: Uuid,
        _turn_id: Uuid,
    ) -> SubmissionFuture<'_, Vec<crate::steering::SteeringInput>> {
        Box::pin(async { Ok(vec![]) })
    }
    /// Read frozen prompt history without authorizing replay. Fork-aware adapters
    /// may resolve an inherited origin, while get/get_by_turn remain owner-local.
    fn get_history_input(
        &self,
        conversation_id: Uuid,
        turn_id: Uuid,
    ) -> SubmissionFuture<'_, HistoricalTurnInput> {
        Box::pin(async move {
            let record = self.get_by_turn(conversation_id, turn_id).await?;
            if record.conversation_id != conversation_id || record.turn_id != turn_id {
                return Err(SubmissionError::Corrupt);
            }
            Ok(HistoricalTurnInput::from_record(conversation_id, record))
        })
    }
    fn get_by_turn(
        &self,
        conversation_id: Uuid,
        turn_id: Uuid,
    ) -> SubmissionFuture<'_, SubmissionRecord>;
    fn put(
        &self,
        conversation_id: Uuid,
        request_id: Uuid,
        input: SubmissionInput,
    ) -> SubmissionFuture<'_, SubmissionRecord>;
    fn get(
        &self,
        conversation_id: Uuid,
        request_id: Uuid,
    ) -> SubmissionFuture<'_, SubmissionRecord>;
}

fn validate_instructions(
    entries: &[crate::instructions::InstructionFragment],
) -> Result<(), SubmissionError> {
    use crate::instructions::InstructionDisposition;
    if entries.len() > 256 {
        return Err(SubmissionError::InvalidInput);
    }
    let mut identities = HashSet::new();
    let mut bytes = 0usize;
    for entry in entries {
        if [
            &entry.environment_id,
            &entry.scope_id,
            &entry.source_id,
            &entry.revision,
        ]
        .iter()
        .any(|value| value.trim().is_empty() || value.len() > 1024 || value.contains('\0'))
            || !identities.insert((&entry.environment_id, &entry.scope_id, &entry.source_id))
        {
            return Err(SubmissionError::InvalidInput);
        }
        let valid = match entry.disposition {
            InstructionDisposition::Included => {
                entry.original_bytes == entry.text.len() && !entry.text.trim().is_empty()
            }
            InstructionDisposition::Truncated => entry.original_bytes > entry.text.len(),
            InstructionDisposition::Empty | InstructionDisposition::BudgetExcluded => {
                entry.text.is_empty()
            }
        };
        bytes = bytes
            .checked_add(entry.text.len())
            .ok_or(SubmissionError::InvalidInput)?;
        if !valid || bytes > 1_048_576 {
            return Err(SubmissionError::InvalidInput);
        }
    }
    Ok(())
}

/// Immutable image bytes prepared by a source contributor. The submission schema
/// remains backward compatible; hosts attach these parts only after validating
/// the referenced context snapshot and provider vision capability.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SubmissionImage {
    pub source_id: String,
    pub media_type: String,
    pub sha256: String,
    pub bytes: Vec<u8>,
}

impl SubmissionImage {
    pub fn validate(&self) -> Result<(), SubmissionError> {
        if self.source_id.trim().is_empty()
            || self.source_id.len() > 1024
            || self.media_type != "image/png"
            || self.sha256.len() != 64
            || !self
                .sha256
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            || self.bytes.is_empty()
            || self.bytes.len() > 20 * 1024 * 1024
            || !self.bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        {
            return Err(SubmissionError::InvalidInput);
        }
        Ok(())
    }
}

/// Validate a frozen multimodal extension without changing the wire shape of
/// existing text-only submissions. Duplicate source IDs and hashes are rejected
/// so a provider adapter cannot silently collapse distinct evidence.
/// Build one provider-neutral user content list from frozen text and images.
/// Validation happens before bytes are copied into model-owned `Arc`s.
pub fn build_user_content(
    text: &str,
    images: &[SubmissionImage],
) -> Result<Vec<crate::model::ContentPart>, SubmissionError> {
    if text.trim().is_empty() && images.is_empty() {
        return Err(SubmissionError::InvalidInput);
    }
    validate_submission_images(images)?;
    let mut parts = Vec::new();
    if !text.is_empty() {
        parts.push(crate::model::ContentPart::Text(text.to_owned()));
    }
    parts.extend(images.iter().map(|image| crate::model::ContentPart::Image {
        media_type: image.media_type.clone(),
        bytes: Arc::from(image.bytes.clone()),
    }));
    Ok(parts)
}

pub fn validate_submission_images(images: &[SubmissionImage]) -> Result<(), SubmissionError> {
    let mut ids = HashSet::new();
    let mut hashes = HashSet::new();
    if images.len() > 64 {
        return Err(SubmissionError::InvalidInput);
    }
    for image in images {
        image.validate()?;
        if !ids.insert(&image.source_id) || !hashes.insert(&image.sha256) {
            return Err(SubmissionError::InvalidInput);
        }
    }
    Ok(())
}

/// Platform adapter for recovering bytes referenced by an admitted submission.
/// Core receives identity-bound bytes and never resolves filesystem paths.
pub trait ImageMaterializer: Send + Sync {
    fn materialize(
        &self,
        conversation_id: Uuid,
        request_id: Uuid,
    ) -> SubmissionFuture<'_, Vec<SubmissionImage>>;

    /// Resolve a completed turn through the conversation's durable provenance.
    /// A fork may read only the ancestor input explicitly retained for that turn.
    fn materialize_history(
        &self,
        conversation_id: Uuid,
        turn_id: Uuid,
    ) -> SubmissionFuture<'_, Vec<SubmissionImage>>;

    /// Recover only checkpoint-referenced images through the same historical
    /// provenance. Hosts may filter manifests before reading content objects.
    /// The default preserves existing adapters' authorization and validation.
    fn materialize_history_images(
        &self,
        conversation_id: Uuid,
        turn_id: Uuid,
        required_sha256: Vec<String>,
    ) -> SubmissionFuture<'_, Vec<SubmissionImage>> {
        Box::pin(async move {
            let mut images = self.materialize_history(conversation_id, turn_id).await?;
            images.retain(|image| required_sha256.contains(&image.sha256));
            Ok(images)
        })
    }
}

#[cfg(test)]
mod image_tests {
    use super::*;
    fn image() -> SubmissionImage {
        let bytes = b"\x89PNG\r\n\x1a\nagent-image".to_vec();
        SubmissionImage {
            source_id: "paper-source:1".into(),
            media_type: "image/png".into(),
            sha256: "a".repeat(64),
            bytes,
        }
    }
    #[test]
    fn validates_immutable_image_and_rejects_mutation_or_duplicates() {
        let valid = image();
        assert!(validate_submission_images(std::slice::from_ref(&valid)).is_ok());
        assert!(validate_submission_images(&[valid.clone(), valid]).is_err());
        let content = build_user_content("question", &[image()]).unwrap();
        assert!(matches!(content[0], crate::model::ContentPart::Text(_)));
        assert!(matches!(
            content[1],
            crate::model::ContentPart::Image { .. }
        ));
    }

    #[test]
    fn pure_image_content_has_no_placeholder_text_and_empty_content_is_rejected() {
        let content = build_user_content("", &[image()]).unwrap();
        assert!(matches!(
            content.as_slice(),
            [crate::model::ContentPart::Image { .. }]
        ));
        assert!(build_user_content("", &[]).is_err());
    }

    #[tokio::test]
    async fn historical_subset_default_preserves_authorized_adapter_scope() {
        struct Images;
        impl ImageMaterializer for Images {
            fn materialize(&self, _: Uuid, _: Uuid) -> SubmissionFuture<'_, Vec<SubmissionImage>> {
                Box::pin(async { panic!("historical lookup must not use current request") })
            }
            fn materialize_history(
                &self,
                conversation: Uuid,
                turn: Uuid,
            ) -> SubmissionFuture<'_, Vec<SubmissionImage>> {
                Box::pin(async move {
                    if conversation != Uuid::from_u128(1) || turn != Uuid::from_u128(2) {
                        return Err(SubmissionError::NotFound);
                    }
                    let first = image();
                    let mut second = image();
                    second.source_id = "second".into();
                    second.sha256 = "b".repeat(64);
                    second.bytes.push(1);
                    Ok(vec![first, second])
                })
            }
        }
        let selected = Images
            .materialize_history_images(
                Uuid::from_u128(1),
                Uuid::from_u128(2),
                vec!["b".repeat(64)],
            )
            .await
            .unwrap();
        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].source_id, "second");
        assert_eq!(selected[0].bytes.last(), Some(&1));
        assert_eq!(
            Images
                .materialize_history_images(
                    Uuid::from_u128(3),
                    Uuid::from_u128(2),
                    vec!["b".repeat(64)]
                )
                .await,
            Err(SubmissionError::NotFound)
        );
    }
}

#[cfg(test)]
mod context_tests {
    use super::{ContextSourceKind, ContextText, SubmissionError};

    #[test]
    fn retrieval_constructor_uses_stable_source_identity() {
        let source = ContextText::retrieval(
            "trace-1",
            "paper-1",
            "trace:trace-1",
            "agent query",
            "retrieved context".to_owned(),
            Some("{\"traceId\":\"trace-1\"}".to_owned()),
        )
        .unwrap();
        assert_eq!(source.source_id, "retrieval:trace-1");
        assert_eq!(source.kind, ContextSourceKind::Retrieval);
        assert_eq!(source.resource_id, "paper-1");
        assert_eq!(source.revision, "trace:trace-1");
    }

    #[test]
    fn retrieval_constructor_rejects_invalid_query_identity() {
        assert_eq!(
            ContextText::retrieval(
                "trace-1",
                "paper-1",
                "trace:trace-1",
                "\n",
                "context".to_owned(),
                None,
            ),
            Err(SubmissionError::InvalidInput)
        );
        assert_eq!(
            ContextText::retrieval(
                &"t".repeat(161),
                "paper-1",
                "trace:trace-1",
                "query",
                "context".to_owned(),
                None,
            ),
            Err(SubmissionError::InvalidInput)
        );
    }
}
