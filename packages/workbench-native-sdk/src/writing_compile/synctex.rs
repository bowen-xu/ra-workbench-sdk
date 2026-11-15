//! Owned SyncTeX observations and bit-preserving location transport.
use super::SynctexPdfLocation;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PdfLocationBits {
    pub page: u32,
    pub x_bits: u64,
    pub y_bits: u64,
    pub width_bits: u64,
    pub height_bits: u64,
}

impl From<SynctexPdfLocation> for PdfLocationBits {
    fn from(value: SynctexPdfLocation) -> Self {
        Self {
            page: value.page,
            x_bits: value.x.to_bits(),
            y_bits: value.y.to_bits(),
            width_bits: value.width.to_bits(),
            height_bits: value.height.to_bits(),
        }
    }
}

impl From<PdfLocationBits> for SynctexPdfLocation {
    fn from(value: PdfLocationBits) -> Self {
        Self {
            page: value.page,
            x: f64::from_bits(value.x_bits),
            y: f64::from_bits(value.y_bits),
            width: f64::from_bits(value.width_bits),
            height: f64::from_bits(value.height_bits),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InverseCandidate {
    pub input: String,
    pub line: u32,
    pub column: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InverseCandidates {
    pub items: Vec<InverseCandidate>,
    pub generated_input: bool,
}
