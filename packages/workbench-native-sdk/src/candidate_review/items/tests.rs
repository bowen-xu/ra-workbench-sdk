use super::*;
use serde_json::json;
#[test]
fn selected_item_binding_rejects_wrong_family_text_and_unselected_anchor() {
    let payload = json!({"kind":"concept_suggestion_v1","schemaVersion":1,"suggestions":[{"id":"s","term":"Term","explanation":"Original","epistemicRole":"source_paraphrase","evidenceItemIds":["selected"]}]});
    let request = ItemReviewInputV1::Select {
        payload: payload.clone(),
        suggestion_id: "s".into(),
    };
    let selected: ConceptSuggestion =
        serde_json::from_value(payload["suggestions"][0].clone()).unwrap();
    let mut response = ItemReviewDecisionV1::Selected {
        result: Ok(Box::new(SuggestionV1::Concept(selected))),
    };
    assert!(request.matches_decision(&response));
    let bytes = serde_json::to_vec(&request).unwrap();
    assert_eq!(
        serde_json::from_slice::<ItemReviewInputV1>(&bytes).unwrap(),
        request
    );
    let ItemReviewDecisionV1::Selected {
        result: Ok(suggestion),
    } = &mut response
    else {
        unreachable!();
    };
    let SuggestionV1::Concept(value) = suggestion.as_mut() else {
        unreachable!();
    };
    value.explanation = "Changed".into();
    assert!(!request.matches_decision(&response));
    let anchors = ItemReviewInputV1::Anchors {
        evidence_ids: vec!["selected".into()],
        sources: vec![
            ("selected".into(), "inside".into()),
            ("other".into(), "outside".into()),
        ],
    };
    assert!(!anchors.matches_decision(&ItemReviewDecisionV1::Anchors {
        result: Ok(vec!["outside".into()])
    }));
    assert!(!anchors.matches_decision(&ItemReviewDecisionV1::Checked { rejection: None }));
}
