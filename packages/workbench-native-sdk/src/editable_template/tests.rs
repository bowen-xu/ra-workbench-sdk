use super::*;
use crate::catalog::{CatalogInput, CatalogOperation, CatalogOutput};
use serde_json::json;

fn input() -> EditableTemplateInputV1 {
    EditableTemplateInputV1 {
        candidate_json: " {\"name\":\" 原模板 \",\"schemaVersion\":1.0} \n".into(),
    }
}

#[test]
fn catalog_input_preserves_the_exact_json_string_without_domain_coercion() {
    let input = input();
    let wire = CatalogInput::ValidateEditableTemplate {
        input: Box::new(input.clone()),
    };
    let value = serde_json::to_value(&wire).unwrap();
    assert_eq!(
        value,
        json!({"kind":"validateEditableTemplate","input":{"candidateJson":input.candidate_json}})
    );
    assert_eq!(serde_json::from_value::<CatalogInput>(value).unwrap(), wire);
    assert_eq!(wire.operation(), CatalogOperation::ValidateEditableTemplate);
    assert_ne!(
        input,
        EditableTemplateInputV1 {
            candidate_json: input.candidate_json.trim().into()
        }
    );
    // Inner JSON validity belongs to the host adapter, not wire deserialization.
    assert!(
        serde_json::from_value::<EditableTemplateInputV1>(json!({"candidateJson":"{invalid"}))
            .is_ok()
    );
}

#[test]
fn template_input_rejects_inline_bodies_extra_authority_and_wrong_field_types() {
    for bad in [
        json!({}),
        json!({"candidateJson":null}),
        json!({"candidateJson":{}}),
        json!({"candidateJson":"{}","target":"overview"}),
        json!({"candidateJson":"{}","evidence":[]}),
        json!({"candidateJson":"{}","sql":"private"}),
    ] {
        assert!(serde_json::from_value::<EditableTemplateInputV1>(bad).is_err());
    }
    assert!(
        serde_json::from_value::<CatalogInput>(json!({
            "kind":"validateEditableTemplate","input":{"candidateJson":"{}"},"writer":true
        }))
        .is_err()
    );
}

#[test]
fn both_decisions_are_closed_and_keep_the_full_actual_input_binding() {
    for bad in [
        json!({"status":"validated"}),
        json!({"status":"validated","canonicalJson":{}}),
        json!({"status":"rejected","message":null}),
    ] {
        assert!(serde_json::from_value::<EditableTemplateDecisionV1>(bad).is_err());
    }
    for decision in [
        EditableTemplateDecisionV1::Validated {
            canonical_json: "{\"name\":\" 原模板 \"}".into(),
        },
        EditableTemplateDecisionV1::Rejected {
            message: "fields[2].title无效".into(),
        },
    ] {
        let wire = CatalogOutput::EditableTemplate {
            outcome: Box::new(EditableTemplateOutcomeV1 {
                input: Box::new(input()),
                decision,
            }),
        };
        let value = serde_json::to_value(&wire).unwrap();
        assert_eq!(value["kind"], "editableTemplate");
        assert_eq!(
            value["outcome"]["input"],
            json!({"candidateJson":input().candidate_json})
        );
        assert_eq!(
            serde_json::from_value::<CatalogOutput>(value.clone()).unwrap(),
            wire
        );
        assert_eq!(wire.operation(), CatalogOperation::ValidateEditableTemplate);
        let mut bad = value.clone();
        bad["outcome"]["decision"]["writer"] = json!(true);
        assert!(serde_json::from_value::<CatalogOutput>(bad).is_err());
        let mut bad = value;
        bad["outcome"]["decision"]["status"] = json!("unknown");
        assert!(serde_json::from_value::<CatalogOutput>(bad).is_err());
    }
}
