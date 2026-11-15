use super::*;
use crate::catalog::{CatalogInput, CatalogOperation, CatalogOutput};
use serde_json::{Value, json};

fn plan() -> CleanupPlanV1 {
    CleanupPlanV1 {
        soft_owners: vec!["soft".into()],
        relations: vec![
            CleanupRelationV1 {
                id: "left".into(),
                child: "child".into(),
                parent: "parent".into(),
            },
            CleanupRelationV1 {
                id: "right".into(),
                child: "child".into(),
                parent: "parent".into(),
            },
        ],
        delete_tables: vec!["child".into(), "parent".into()],
    }
}

#[test]
fn zero_data_request_and_ordered_plan_have_exact_finite_wire_shapes() {
    let input = CatalogInput::PrepareTrashCleanup {};
    assert_eq!(input.operation(), CatalogOperation::PrepareTrashCleanup);
    assert_eq!(
        serde_json::to_string(&input).unwrap(),
        r#"{"kind":"prepareTrashCleanup"}"#
    );
    assert_eq!(
        serde_json::from_str::<CatalogInput>(r#"{"kind":"prepareTrashCleanup"}"#).unwrap(),
        input
    );
    let output = CatalogOutput::TrashCleanupPreparation {
        outcome: TrashCleanupPreparationV1::Ready { plan: plan() },
    };
    assert_eq!(output.operation(), CatalogOperation::PrepareTrashCleanup);
    let value = serde_json::to_value(&output).unwrap();
    assert_eq!(
        value,
        json!({"kind":"trashCleanupPreparation","outcome":{"status":"ready","plan":{
            "softOwners":["soft"],"relations":[
                {"id":"left","child":"child","parent":"parent"},
                {"id":"right","child":"child","parent":"parent"}
            ],"deleteTables":["child","parent"]
        }}})
    );
    assert_eq!(
        serde_json::from_value::<CatalogOutput>(value).unwrap(),
        output
    );
    let rejected = TrashCleanupPreparationV1::Rejected {
        code: CleanupPlanRejectionCodeV1::PlanCycle,
    };
    assert_eq!(
        serde_json::to_value(&rejected).unwrap(),
        json!({"status":"rejected","code":"plan_cycle"})
    );
    assert_eq!(
        CleanupPlanRejectionCodeV1::PlanCycle.as_str(),
        "LITERATURE_CLEANUP_PLAN_CYCLE"
    );
}

#[test]
fn request_cannot_carry_data_scope_sql_or_execution_authority() {
    for field in ["itemId", "rowid", "table", "sql", "steps", "plan"] {
        let mut value = json!({"kind":"prepareTrashCleanup"});
        value[field] = json!("PRIVATE_SCOPE");
        assert!(serde_json::from_value::<CatalogInput>(value).is_err());
    }
    let mut output = serde_json::to_value(CatalogOutput::TrashCleanupPreparation {
        outcome: TrashCleanupPreparationV1::Ready { plan: plan() },
    })
    .unwrap();
    for mutate in [
        |v: &mut Value| v["outcome"]["itemId"] = json!("private"),
        |v: &mut Value| v["outcome"]["plan"]["sql"] = json!("private"),
        |v: &mut Value| v["outcome"]["plan"]["relations"][0]["columns"] = json!([]),
        |v: &mut Value| v["outcome"]["plan"]["deleteTables"] = json!([0]),
    ] {
        let mut invalid = output.clone();
        mutate(&mut invalid);
        assert!(serde_json::from_value::<CatalogOutput>(invalid).is_err());
    }
    output["outcome"] = json!({"status":"rejected","code":"unknown"});
    assert!(serde_json::from_value::<CatalogOutput>(output).is_err());
}
