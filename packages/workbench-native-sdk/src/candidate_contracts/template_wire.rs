//! Pure stored-template wire constraints, shared with new submission policy.
use super::PaperTemplateSnapshot;
use std::collections::HashSet;
pub fn valid_template_color(color: &Option<String>) -> bool {
    color.as_ref().is_none_or(|value| {
        value.len() == 7
            && value.starts_with('#')
            && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
    })
}

pub fn template_field_identity(value: &str) -> bool {
    !value.trim().is_empty()
        && value.trim() == value
        && value.chars().count() <= 64
        && value.starts_with(|c: char| c.is_ascii_lowercase())
        && value
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

pub fn valid_template_snapshot(template: &PaperTemplateSnapshot) -> bool {
    let mut seen = std::collections::HashSet::new();
    !template.reference.id().trim().is_empty()
        && template.reference.id().len() <= 200
        && template.reference.revision() >= 1
        && (1..=20).contains(&template.fields.len())
        && template.fields.iter().all(|field| {
            template_field_identity(&field.id)
                && seen.insert(&field.id)
                && !field.title.trim().is_empty()
                && field.title.chars().count() <= 120
                && !field.question.trim().is_empty()
                && field.question.chars().count() <= 1000
                && valid_template_color(&field.color)
                && field.claim_ids.len() <= 24
                && field.claim_ids.iter().all(|id| template_field_identity(id))
                && field.claim_ids.iter().collect::<HashSet<_>>().len() == field.claim_ids.len()
        })
}
