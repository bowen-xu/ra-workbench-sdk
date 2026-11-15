use research_agent_core::workspace::*;
use uuid::Uuid;

fn file(path: &str, hash: char, byte_size: u64) -> WorkspaceFile {
    WorkspaceFile {
        path: path.into(),
        version: FileVersion {
            sha256: hash.to_string().repeat(64),
            byte_size,
            executable: false,
        },
    }
}
fn source() -> SourceVersion {
    SourceVersion {
        resource_id: "manuscript:one/main.tex".into(),
        revision: "disk:original".into(),
        editor: Some(EditorVersion {
            session_id: Uuid::from_u128(4),
            revision: Uuid::from_u128(5),
        }),
    }
}
fn baseline() -> WorkspaceManifest {
    WorkspaceManifest {
        schema_version: 1,
        identity: WorkspaceIdentity {
            lease_id: Uuid::from_u128(1),
            conversation_id: Uuid::from_u128(2),
            turn_id: Uuid::from_u128(3),
            environment_id: "manuscript:one".into(),
        },
        files: vec![
            BaselineFile {
                file: file("main.tex", 'a', 3),
                source: source(),
            },
            BaselineFile {
                file: file("old.tex", 'b', 4),
                source: SourceVersion {
                    resource_id: "manuscript:one/old.tex".into(),
                    revision: "disk:old".into(),
                    editor: None,
                },
            },
        ],
    }
}
#[test]
fn inventory_is_sorted_and_keeps_original_and_working_revisions_separate() {
    let manifest = baseline();
    let initial: Vec<_> = manifest
        .files
        .iter()
        .map(|entry| entry.file.clone())
        .collect();
    assert!(compare(&manifest, &initial).unwrap().is_empty());
    let changes = compare(
        &manifest,
        &[file("new.tex", 'c', 7), file("main.tex", 'd', 8)],
    )
    .unwrap();
    assert_eq!(
        changes
            .iter()
            .map(|change| change.path.as_str())
            .collect::<Vec<_>>(),
        ["main.tex", "new.tex", "old.tex"]
    );
    assert_eq!(
        changes.iter().map(|change| change.kind).collect::<Vec<_>>(),
        [
            FileChangeKind::Modified,
            FileChangeKind::Added,
            FileChangeKind::Deleted
        ]
    );
    assert_eq!(changes[0].before.as_ref().unwrap().sha256, "a".repeat(64));
    assert_eq!(
        changes[0].source.as_ref().unwrap().revision,
        "disk:original"
    );
    assert!(changes[0].source.as_ref().unwrap().editor.is_some());
    assert!(changes[1].before.is_none() && changes[1].source.is_none());
    assert!(changes[2].after.is_none());
    // Byte-identical executability changes are still inventory changes.
    let mut mode_only = initial;
    mode_only[0].version.executable = true;
    assert_eq!(compare(&manifest, &mode_only).unwrap().len(), 1);
}
#[test]
fn current_source_and_editor_identity_must_match_before_accepting() {
    let changes = compare(
        &baseline(),
        &[file("new.tex", 'c', 7), file("main.tex", 'd', 8)],
    )
    .unwrap();
    assert!(check_source(&changes[0], Some(&source())).is_ok());
    assert_eq!(
        check_source(&changes[0], None),
        Err(WorkspaceError::Conflict)
    );
    let mut changed = source();
    changed.revision = "disk:new".into();
    assert_eq!(
        check_source(&changes[0], Some(&changed)),
        Err(WorkspaceError::Conflict)
    );
    changed = source();
    changed.editor.as_mut().unwrap().revision = Uuid::from_u128(8);
    assert_eq!(
        check_source(&changes[0], Some(&changed)),
        Err(WorkspaceError::Conflict)
    );
    changed = source();
    changed.editor = None;
    assert_eq!(
        check_source(&changes[0], Some(&changed)),
        Err(WorkspaceError::Conflict)
    );
    assert!(check_source(&changes[1], None).is_ok());
    assert_eq!(
        check_source(&changes[1], Some(&source())),
        Err(WorkspaceError::Conflict)
    );
    assert_eq!(
        check_source(&changes[2], None),
        Err(WorkspaceError::Conflict)
    );
}
#[test]
fn manifest_wire_preserves_editor_baseline_and_rejects_unknown_or_ambiguous_input() {
    let manifest = baseline();
    let encoded = serde_json::to_value(&manifest).unwrap();
    let decoded: WorkspaceManifest = serde_json::from_value(encoded.clone()).unwrap();
    assert_eq!(decoded, manifest);
    decoded.validate().unwrap();
    let mut forged = encoded;
    forged["root"] = serde_json::json!("/tmp");
    assert!(serde_json::from_value::<WorkspaceManifest>(forged).is_err());
    let mut invalid = manifest.clone();
    invalid.files.push(invalid.files[0].clone());
    assert_eq!(invalid.validate(), Err(WorkspaceError::Invalid));
    let mut invalid = manifest.clone();
    invalid.schema_version = 2;
    assert_eq!(invalid.validate(), Err(WorkspaceError::Invalid));
    let mut invalid = manifest;
    invalid.files[0].source.editor.as_mut().unwrap().session_id = Uuid::nil();
    assert_eq!(invalid.validate(), Err(WorkspaceError::Invalid));
}
#[test]
fn portable_paths_reject_escapes_control_metadata_and_file_directory_collisions() {
    for path in ["main.tex", "sections/讨论.tex"] {
        validate_path(path).unwrap();
    }
    for path in [
        "",
        "/main.tex",
        "a//b",
        "a/./b",
        "../a",
        "a/../b",
        "a\\b",
        "C:/a",
        "a/",
        "a\0b",
        ".git/config",
        ".agents/skills/review/SKILL.md",
        "A/.Git/config",
        "aux.tex",
        "COM1",
        "a.",
        "a ",
        "a?b",
    ] {
        assert!(validate_path(path).is_err(), "accepted {path:?}");
    }
    assert_eq!(
        validate_files(&[
            file("a", 'a', 0),
            file("a-foo", 'a', 0),
            file("a/b", 'a', 0)
        ]),
        Err(WorkspaceError::Invalid)
    );
    assert_eq!(
        validate_files(&[file("one", 'a', 0), file("one", 'b', 0)]),
        Err(WorkspaceError::Invalid)
    );
}
#[test]
fn byte_and_file_limits_are_checked_without_loading_file_contents() {
    let mut one = file("a", 'a', MAX_FILE_BYTES);
    validate_files([&one]).unwrap();
    one.version.byte_size += 1;
    assert_eq!(validate_files([&one]), Err(WorkspaceError::Budget));
    let two = [
        file("a", 'a', MAX_FILE_BYTES),
        file("b", 'b', MAX_FILE_BYTES),
    ];
    validate_files(&two).unwrap();
    let three = [two[0].clone(), two[1].clone(), file("c", 'c', 1)];
    assert_eq!(validate_files(&three), Err(WorkspaceError::Budget));
    let many: Vec<_> = (0..MAX_FILES + 1)
        .map(|i| file(&format!("f{i}"), 'a', 0))
        .collect();
    assert_eq!(validate_files(&many), Err(WorkspaceError::Budget));
    assert!(validate_files(&many[..MAX_FILES]).is_ok());
    let invalid = file("a", 'z', 1);
    assert_eq!(validate_files([&invalid]), Err(WorkspaceError::Invalid));
}
