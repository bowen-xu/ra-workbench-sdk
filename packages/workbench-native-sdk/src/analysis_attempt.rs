//! Minimal observations for the original attempt eligibility decision.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisAttemptWorkflowObservation {
    pub status: String,
    pub turns: Vec<AnalysisAttemptTurnObservation>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisAttemptTurnObservation {
    pub id: String,
    pub kind: String,
    pub status: String,
    pub attempt_numbers: Vec<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisAttemptPlan {
    pub turn_id: String,
    pub next_attempt: i64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn observation_codec_preserves_raw_status_ids_order_and_signed_attempt_numbers() {
        let wire = json!({"status":"unknown status","turns":[
            {"id":"","kind":" raw-kind ","status":"","attemptNumbers":[9,-1,0,i64::MAX,i64::MIN]},
            {"id":" raw id ","kind":"paper_overview","status":"failed","attemptNumbers":[]}
        ]});
        let value: AnalysisAttemptWorkflowObservation =
            serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(serde_json::to_value(value).unwrap(), wire);
        let plan = json!({"turnId":" raw id ","nextAttempt":-1});
        assert_eq!(
            serde_json::to_value(
                serde_json::from_value::<AnalysisAttemptPlan>(plan.clone()).unwrap()
            )
            .unwrap(),
            plan
        );
    }

    #[test]
    fn observation_codec_does_not_accept_private_owners_or_coerce_field_types() {
        let original = json!({"status":"preparing","turns":[]});
        for (field, value) in [
            ("providerId", json!("no")),
            ("connection", json!("no")),
            ("turns", json!(null)),
            ("status", json!(1)),
        ] {
            let mut invalid = original.clone();
            invalid[field] = value;
            assert!(serde_json::from_value::<AnalysisAttemptWorkflowObservation>(invalid).is_err());
        }
        assert!(
            serde_json::from_value::<AnalysisAttemptTurnObservation>(
                json!({"id":"t","kind":"paper_overview","status":"failed","attemptNumbers":[1.5]})
            )
            .is_err()
        );
        assert!(
            serde_json::from_value::<AnalysisAttemptPlan>(
                json!({"turnId":"t","nextAttempt":1,"attemptId":"no"})
            )
            .is_err()
        );
    }
}
