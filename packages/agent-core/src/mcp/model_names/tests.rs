use super::*;

fn raw(server: &str, name: &str) -> McpRawName {
    McpRawName {
        server: server.into(),
        namespace: server.into(),
        callable_name: name.into(),
        tool_name: name.into(),
        connector_id: None,
    }
}

#[test]
fn sanitized_names_keep_raw_server_and_tool_for_routing() {
    let actual = normalize_model_names([raw("music-studio", "get-strudel-guide")], true, &[]);
    assert_eq!(actual[0].namespace, "mcp__music_studio");
    assert_eq!(actual[0].name, "get_strudel_guide");
    assert_eq!(actual[0].raw.server, "music-studio");
    assert_eq!(actual[0].raw.tool_name, "get-strudel-guide");
    let without = normalize_model_names(
        [raw("music-studio", "get-strudel-guide")],
        true,
        &["music-studio".into()],
    );
    assert_eq!(without[0].namespace, "music_studio");
}

#[test]
fn collisions_and_long_names_are_unique_bounded_and_input_order_independent() {
    let input = vec![
        raw("basic-server", "tool-name"),
        raw("basic_server", "tool_name"),
        raw("basic-server", "tool_name"),
        raw("server", &"x".repeat(130)),
        raw(&"s".repeat(130), "query"),
    ];
    let output = normalize_model_names(input.clone(), true, &[]);
    assert_eq!(
        output,
        normalize_model_names(input.into_iter().rev(), true, &[])
    );
    let names: HashSet<_> = output
        .iter()
        .map(|item| format!("{}{}", item.namespace, item.name))
        .collect();
    assert_eq!(names.len(), 5);
    assert!(
        output
            .iter()
            .all(|item| item.namespace.len() + item.name.len() + DELIMITER.len() <= MAX_NAME)
    );
    let first = output
        .iter()
        .find(|item| item.raw.server == "basic-server")
        .unwrap();
    let second = output
        .iter()
        .find(|item| item.raw.server == "basic_server")
        .unwrap();
    assert_ne!(first.namespace, second.namespace);
    assert_eq!(first.namespace, "mcp__basic_server_756d1be7d674");
    let same_server: HashSet<_> = output
        .iter()
        .filter(|item| item.raw.server == "basic-server")
        .map(|item| &item.name)
        .collect();
    assert_eq!(same_server.len(), 2);
}

#[test]
fn duplicate_identity_is_skipped_and_connector_identity_participates_in_disambiguation() {
    let mut other = raw("server", "read");
    other.connector_id = Some("connector".into());
    let input = vec![raw("server", "read"), raw("server", "read"), other];
    let output = normalize_model_names(input, true, &[]);
    assert_eq!(output.len(), 2);
    assert_ne!(output[0].namespace, output[1].namespace);
}

#[test]
fn hash_suffix_matches_upstream_sha1_encoding() {
    assert_eq!(hash_suffix("abc"), "_a9993e364706");
    assert_eq!(sanitize("中.a-b"), "__a_b");
    assert_eq!(sanitize(""), "_");
}
