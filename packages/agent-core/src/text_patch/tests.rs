use super::*;

fn update(text: &str, body: &str) -> Result<String, PatchConflict> {
    let patch = format!("*** Begin Patch\n*** Update File: notes/root/a.md\n{body}\n*** End Patch");
    let hunks = parse(&patch).unwrap();
    let Hunk::UpdateFile { chunks, .. } = &hunks[0] else {
        panic!("update");
    };
    replace_chunks(text, chunks)
}

#[test]
fn parses_codex_add_delete_move_and_multiple_files() {
    let hunks = parse("*** Begin Patch\n*** Add File: workspace/w/new.md\n+hello\n*** Delete File: workspace/w/old.md\n*** Update File: notes/root/a.md\n*** Move to: notes/p/a.md\n@@\n-old\n+new\n*** End Patch").unwrap();
    assert_eq!(hunks.len(), 3);
    assert!(matches!(&hunks[0], Hunk::AddFile { contents, .. } if contents == "hello\n"));
    assert!(matches!(
        &hunks[2],
        Hunk::UpdateFile {
            move_path: Some(_),
            ..
        }
    ));
}

#[test]
fn applies_multiple_chunks_without_position_drift() {
    assert_eq!(
        update("a\nb\nc\nd\n", "@@\n-b\n+B\n+extra\n@@\n-d\n+D").unwrap(),
        "a\nB\nextra\nc\nD\n"
    );
}

#[test]
fn rejects_duplicate_matches_and_whitespace_or_punctuation_fuzz() {
    assert_eq!(
        update("same\nsame\n", "@@\n-same\n+new"),
        Err(PatchConflict::Ambiguous)
    );
    assert!(matches!(
        update(" same\n", "@@\n-same\n+new"),
        Err(PatchConflict::MissingContext { chunk: 1, .. })
    ));
    assert!(matches!(
        update("“词语”\n", "@@\n-\"词语\"\n+新词"),
        Err(PatchConflict::MissingContext { chunk: 1, .. })
    ));
}

#[test]
fn missing_context_diagnostic_is_bounded_and_suggests_prefix_check_before_reread() {
    let error = update("", "@@\n+{\n        }\n+}").unwrap_err().to_string();
    assert!(error.contains("补丁块 1"));
    assert!(error.contains("       }"));
    assert!(error.find("漏写前缀").unwrap() < error.find("重新读取").unwrap());
    let long = "x".repeat(10000);
    let error = update("", &format!("@@\n {long}\n {long}\n {long}"))
        .unwrap_err()
        .to_string();
    assert!(error.contains("原行 10000 字符"));
    assert!(error.chars().count() <= 1000);
    assert!(!error.contains(&long));
}

#[test]
fn resolves_duplicate_anchor_only_when_entire_context_is_unique() {
    assert_eq!(
        update(
            "section\nwrong\nsection\nright\n",
            "@@ section\n-right\n+correct"
        )
        .unwrap(),
        "section\nwrong\nsection\ncorrect\n"
    );
    assert_eq!(
        update("section\nsame\nsection\nsame\n", "@@ section\n-same\n+new"),
        Err(PatchConflict::Ambiguous)
    );
}

#[test]
fn keeps_unicode_and_normalizes_crlf_only() {
    assert_eq!(
        update("标题\r\n原文 🧪\r\n", "@@ 标题\n-原文 🧪\n+新文 🧪").unwrap(),
        "标题\n新文 🧪\n"
    );
}

#[test]
fn rejects_entire_patch_before_any_backend_when_grammar_or_paths_are_invalid() {
    for patch in [
        "*** Begin Patch\n*** Add File: ../outside\n+x\n*** End Patch",
        "*** Begin Patch\n*** Add File: x\n+x",
        "*** Begin Patch\n*** Update File: x\n@@\n*** End Patch",
        "*** Begin Patch\n*** Add File: x\n+x\n*** Delete File: x\n*** End Patch",
    ] {
        assert!(parse(patch).is_err(), "{patch}");
    }
}

#[test]
fn handles_eof_and_chained_contexts() {
    assert_eq!(
        update("A\nx\nB\nx\n", "@@ B\n@@\n-x\n+y\n*** End of File").unwrap(),
        "A\nx\nB\ny\n"
    );
}
