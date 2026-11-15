//! Resource addresses follow packages/core/src/sourceNavigation.ts, without locators.
//! Identity segments are decoded once; names and storage types belong to adapters.
pub const ROOTS: [&str; 5] = ["library", "notes", "writings", "agents", "assets"];
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SourceRoot {
    Library,
    Notes,
    Writings,
    Agents,
    Assets,
}
impl SourceRoot {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Library => "library",
            Self::Notes => "notes",
            Self::Writings => "writings",
            Self::Agents => "agents",
            Self::Assets => "assets",
        }
    }
}
pub fn object(root: SourceRoot, segments: &[String]) -> String {
    let mut parts = vec![root.as_str().to_owned()];
    parts.extend_from_slice(segments);
    format(&parts)
}
pub fn reference(kind: &str, id: &str) -> String {
    match kind {
        "paper" => object(SourceRoot::Library, &[id.into()]),
        "manuscript" => object(SourceRoot::Writings, &[id.into()]),
        "claim" => object(SourceRoot::Assets, &["claims".into(), id.into()]),
        _ => object(SourceRoot::Notes, &[id.into()]),
    }
}
pub fn parse(source: &str) -> Result<Vec<String>, String> {
    let path = source
        .strip_prefix("source://")
        .ok_or("use a source:// address")?;
    if source.len() > 8192
        || path.is_empty()
        || path.contains(['?', '#'])
        || path.starts_with('/')
        || path.contains("//")
    {
        return Err("invalid source address or unsupported locator".into());
    }
    let mut result = Vec::new();
    if !ROOTS.contains(&path.split('/').next().unwrap_or("")) {
        return Err("找不到文件对象".into());
    }
    for part in path.trim_end_matches('/').split('/') {
        let mut bytes = Vec::new();
        let raw = part.as_bytes();
        let mut index = 0;
        while index < raw.len() {
            if raw[index] == b'%' {
                let hex = part
                    .get(index + 1..index + 3)
                    .ok_or("invalid percent encoding")?;
                bytes.push(u8::from_str_radix(hex, 16).map_err(|_| "invalid percent encoding")?);
                index += 3;
            } else {
                bytes.push(raw[index]);
                index += 1;
            }
        }
        let id = String::from_utf8(bytes).map_err(|_| "invalid encoded UTF-8")?;
        if id.is_empty()
            || id.chars().count() > 1024
            || id.chars().any(|ch| ch.is_control() || ch == '\\')
        {
            return Err("invalid source identity".into());
        }
        match id.as_str() {
            "." => {}
            ".." => {
                if result.len() <= 1 {
                    return Err("source address escapes its namespace".into());
                }
                result
                    .pop()
                    .ok_or("source address escapes application root")?;
            }
            _ => result.push(id),
        }
    }
    if result.is_empty() || path.trim_end_matches('/').split('/').count() > 32 {
        return Err("invalid source address depth".into());
    }
    Ok(result)
}
pub fn format(parts: &[String]) -> String {
    format!(
        "source://{}",
        parts
            .iter()
            .map(|part| part
                .bytes()
                .map(|byte| match byte {
                    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' =>
                        char::from(byte).to_string(),
                    _ => format!("%{byte:02X}"),
                })
                .collect::<String>())
            .collect::<Vec<_>>()
            .join("/")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matches_the_frontend_namespace_and_encoding_contract() {
        let fixtures: serde_json::Value =
            serde_json::from_str(include_str!("../../tests/fixtures/source-addresses.json"))
                .unwrap();
        for entry in fixtures["valid"].as_array().unwrap() {
            let path = parse(entry["uri"].as_str().unwrap()).unwrap();
            assert_eq!(serde_json::json!(path), entry["path"]);
            assert_eq!(parse(&format(&path)).unwrap(), path);
        }
        for uri in fixtures["invalid"].as_array().unwrap() {
            assert!(parse(uri.as_str().unwrap()).is_err(), "{uri}");
        }
        assert!(parse("source://notes/id:#block{b}").is_err());
    }
}
