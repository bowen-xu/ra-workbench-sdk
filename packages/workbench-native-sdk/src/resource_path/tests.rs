use super::*;

#[test]
fn retains_original_component_normalization_and_character_policy() {
    for path in [
        "main.tex",
        "目录/稿件.tex",
        "a//b.tex",
        "a/./b.tex",
        ".git/config",
        "a\tb.tex",
        "com10.tex",
    ] {
        assert_eq!(validate_relative_path(path).unwrap().as_os_str(), path);
    }
    for path in [
        "",
        ".",
        "./main.tex",
        "../main.tex",
        "a/../b",
        "/main.tex",
        "a/",
        "a\\b",
        "a\0b",
        "a/CON.tex",
        "Lpt9.log",
        "a. ",
        "a.",
    ] {
        assert_eq!(
            validate_relative_path(path),
            Err(InvalidRelativePath),
            "{path:?}"
        );
    }
}

#[test]
fn byte_limit_and_recovery_name_policy_are_unchanged() {
    assert!(validate_relative_path(&"é".repeat(512)).is_ok());
    assert_eq!(
        validate_relative_path(&format!("{}a", "é".repeat(512))),
        Err(InvalidRelativePath)
    );
    for name in [".agent-before-original.bak", ".AGENT-CREATE-stage.tmp"] {
        assert!(is_recovery_file_name(name));
        assert_eq!(validate_relative_path(name), Err(InvalidRelativePath));
        assert_eq!(
            validate_relative_path(&format!("a/{name}")),
            Err(InvalidRelativePath)
        );
    }
    assert!(validate_relative_path("main.tex.bak").is_ok());
}
