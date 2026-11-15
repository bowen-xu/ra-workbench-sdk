//! Original PDF import inputs and two pure preparations; no file or job owner.
use crate::catalog_save::CatalogDraft;
use serde::{Deserialize, Serialize};

pub const CAPABILITY_ID: &str = "literature.pdf-import";
pub const CAPABILITY_VERSION: u32 = 1;

/// Keep the original Rust name, field order and tolerant input codec.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfImportCandidate {
    pub path: String,
    pub draft: CatalogDraft,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedPdfImportEntryV1 {
    pub candidate: PdfImportCandidate,
    pub input_label: String,
    pub raw_input: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PdfImportRejectionV1 {
    NoFilesSelected,
}

impl<'de> Deserialize<'de> for PdfImportRejectionV1 {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        match String::deserialize(deserializer)?.as_str() {
            "noFilesSelected" => Ok(Self::NoFilesSelected),
            value => Err(serde::de::Error::unknown_variant(
                value,
                &["noFilesSelected"],
            )),
        }
    }
}

impl PdfImportRejectionV1 {
    pub fn code(self) -> &'static str {
        "invalid_input"
    }

    pub fn detail(self) -> &'static str {
        "没有选择 PDF 文件"
    }

    pub fn message(self) -> &'static str {
        "不是有效的 PDF 文件：没有选择 PDF 文件"
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PdfImportHeaderPreparationV1 {
    Ready {
        entries: Vec<PreparedPdfImportEntryV1>,
    },
    Rejected {
        candidates: Vec<PdfImportCandidate>,
        reason: PdfImportRejectionV1,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DecodedPdfImportCandidateV1 {
    pub raw_input: String,
    pub candidate: PdfImportCandidate,
}

#[cfg(test)]
mod tests;
