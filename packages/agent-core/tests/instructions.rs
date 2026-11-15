use research_agent_core::instructions::*;
fn doc(environment: &str, scope: &str, text: &str) -> InstructionDocument {
    InstructionDocument {
        environment_id: environment.into(),
        scope_id: scope.into(),
        source_id: "AGENTS.md".into(),
        revision: "hash-v1".into(),
        text: text.into(),
    }
}
#[test]
fn candidates_preserve_override_and_fallback_priority_without_paths() {
    let fallback = vec![
        "".into(),
        "GUIDE.md".into(),
        "AGENTS.md".into(),
        "GUIDE.md".into(),
    ];
    assert_eq!(
        candidate_filenames(&fallback).unwrap(),
        vec!["AGENTS.override.md", "AGENTS.md", "GUIDE.md"]
    );
    for invalid in [
        "../AGENTS.md",
        "folder/guide",
        "C:guide",
        "..",
        "guide\n.md",
        "a\\b",
    ] {
        assert_eq!(
            candidate_filenames(&[invalid.into()]),
            Err(InstructionError::InvalidFilename)
        );
    }
}
#[test]
fn scopes_and_versions_survive_cross_environment_budget_exhaustion() {
    let result = assemble_instructions(
        vec![
            doc("paper", "root", "abc"),
            doc("paper", "section", "中文"),
            doc("notes", "profile", "later"),
        ],
        7,
    )
    .unwrap();
    assert_eq!(
        result
            .iter()
            .map(|part| part.text.as_str())
            .collect::<Vec<_>>(),
        vec!["abc", "中", ""]
    );
    assert_eq!(result[1].disposition, InstructionDisposition::Truncated);
    assert_eq!(result[1].original_bytes, 6);
    assert_eq!(result[1].scope_id, "section");
    assert_eq!(
        result[2].disposition,
        InstructionDisposition::BudgetExcluded
    );
    assert_eq!(result[2].environment_id, "notes");
    assert_eq!(result[2].revision, "hash-v1");
}
#[test]
fn empty_sources_do_not_spend_budget_and_invalid_provenance_is_rejected() {
    let result = assemble_instructions(
        vec![doc("paper", "root", "  "), doc("paper", "nested", "ok")],
        2,
    )
    .unwrap();
    assert_eq!(result[0].disposition, InstructionDisposition::Empty);
    assert_eq!(result[1].text, "ok");
    assert_eq!(
        assemble_instructions(vec![doc("", "root", "text")], 5),
        Err(InstructionError::InvalidSource)
    );
    let result = assemble_instructions(vec![doc("paper", "root", "中")], 1).unwrap();
    assert!(result[0].text.is_empty());
    assert_eq!(result[0].disposition, InstructionDisposition::Truncated);
}
