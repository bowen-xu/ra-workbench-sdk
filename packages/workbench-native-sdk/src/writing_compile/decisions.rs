//! Finite pure compilation inputs. Paths and execution remain with the caller.
use super::{CompileDiagnostic, CompileOptions, CompileRun, LatexTool, LatexToolchainInfo};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
pub enum Rejection {
    #[error("稿件路径无效")]
    InvalidPath,
    #[error("SyncTeX 没有找到对应位置")]
    SynctexNoResult,
    #[error("LaTeX engine 只允许 pdflatex、xelatex 或 lualatex")]
    InvalidEngine,
    #[error("本机没有可用的 latexmk 与 LaTeX engine")]
    ToolchainUnavailable,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(
    tag = "phase",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Input {
    ValidateForward {
        run_id: Option<String>,
        relative_path: String,
        line: u32,
    },
    ValidateInverse {
        run_id: Option<String>,
        page: u32,
        x_bits: u64,
        y_bits: u64,
    },
    ForwardOutput {
        raw_output: String,
    },
    InverseCandidates {
        raw_output: String,
    },
    InverseResolved {
        locations: Vec<super::SynctexSourceLocation>,
        invalid_input: bool,
        generated_input: bool,
    },
    Completion {
        state: ProcessState,
        successful: bool,
        raw_output: String,
    },
    ProjectRun {
        run: CompileRun,
    },
    ValidateEngine {
        engine: String,
    },
    EngineArgument {
        engine: String,
    },
    ValidateToolchain {
        engine: String,
        toolchain: LatexToolchainInfo,
    },
    ProjectToolchain {
        tools: Vec<LatexTool>,
        checked_at: String,
    },
    Flags {
        options: CompileOptions,
    },
    Diagnostics {
        raw_output: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EngineArgument {
    Pdf,
    Xelatex,
    Lualatex,
}

impl EngineArgument {
    pub fn argument(self) -> &'static str {
        match self {
            Self::Pdf => "-pdf",
            Self::Xelatex => "-xelatex",
            Self::Lualatex => "-lualatex",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Flag {
    HaltOnError,
    Force,
    DraftGraphics,
    FromScratch,
}

impl Flag {
    pub fn argument(self) -> &'static str {
        match self {
            Self::HaltOnError => "-halt-on-error",
            Self::Force => "-f",
            Self::DraftGraphics => {
                "-usepretex=\\PassOptionsToPackage{draft}{graphics}\\PassOptionsToPackage{draft}{graphicx}"
            }
            Self::FromScratch => "-gg",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Decision {
    ForwardLocations {
        locations: Vec<super::synctex::PdfLocationBits>,
    },
    InverseCandidates {
        candidates: super::synctex::InverseCandidates,
    },
    InverseLocations {
        locations: Vec<super::SynctexSourceLocation>,
    },
    Completion {
        status: RunStatus,
        diagnostics: Vec<CompileDiagnostic>,
    },
    Run {
        run: CompileRun,
    },
    Accepted,
    EngineArgument {
        argument: EngineArgument,
    },
    Toolchain {
        toolchain: LatexToolchainInfo,
    },
    Flags {
        flags: Vec<Flag>,
    },
    Diagnostics {
        items: Vec<CompileDiagnostic>,
    },
    Rejected {
        reason: Rejection,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProcessState {
    Completed,
    Cancelled,
    TimedOut,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RunStatus {
    Succeeded,
    Failed,
    Cancelled,
    TimedOut,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Completion {
    pub status: RunStatus,
    pub diagnostics: Vec<CompileDiagnostic>,
}

impl RunStatus {
    pub fn stored_value(self) -> &'static str {
        match self {
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::TimedOut => "timed_out",
        }
    }
}
