//! Original compile transport values shared without a platform or process owner.
use serde::{Deserialize, Serialize};

mod decisions;
pub use decisions::*;
pub mod synctex;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LatexTool {
    pub name: String,
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LatexToolchainInfo {
    pub available: bool,
    pub tools: Vec<LatexTool>,
    pub supported_engines: Vec<String>,
    pub checked_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompileDiagnostic {
    pub severity: String,
    pub message: String,
    pub file: Option<String>,
    pub line: Option<i64>,
    pub column: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompileArtifact {
    pub kind: String,
    pub byte_size: i64,
    pub content_hash: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompileRun {
    pub id: String,
    pub manuscript_id: String,
    pub engine: String,
    pub status: String,
    pub diagnostics: Vec<CompileDiagnostic>,
    pub artifacts: Vec<CompileArtifact>,
    pub raw_output: String,
    pub exit_code: Option<i32>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SynctexPdfLocation {
    pub page: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SynctexSourceLocation {
    pub relative_path: String,
    pub line: u32,
    pub column: Option<u32>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CompileOptions {
    pub draft: bool,
    pub stop_on_first_error: bool,
    pub from_scratch: bool,
}
