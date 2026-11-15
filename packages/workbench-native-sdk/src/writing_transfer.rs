//! Owned observations for the original read-only inspection and transfer rules.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RejectionCode {
    InvalidInput,
    FileTooLarge,
    UnsafePath,
    StorageError,
}

impl RejectionCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidInput => "invalid_input",
            Self::FileTooLarge => "file_too_large",
            Self::UnsafePath => "unsafe_path",
            Self::StorageError => "storage_error",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceInspection {
    pub files: Vec<String>,
    pub byte_size: u64,
    pub root_candidates: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ZipEntry {
    pub archive_index: usize,
    pub relative_path: String,
    pub byte_size: u64,
}

/// The original archive headers, including skipped entries, bind Core's opened
/// archive to the exact input inspected by the existing read-only host.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ZipHeader {
    pub name: String,
    pub size: u64,
    pub compressed_size: u64,
    pub crc32: u32,
    pub is_dir: bool,
    pub is_file: bool,
    pub is_symlink: bool,
    pub encrypted: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Input {
    InspectImport {
        source_path: String,
    },
    InspectExport {
        directory: String,
    },
    DiscoverRoots {
        directory: String,
        files: Vec<String>,
    },
    SelectRoot {
        candidates: Vec<String>,
        requested: Option<String>,
    },
    DuplicateTitle {
        title: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Decision {
    Directory {
        inspection: SourceInspection,
    },
    Zip {
        entries: Vec<ZipEntry>,
        headers: Vec<ZipHeader>,
    },
    Files {
        files: Vec<String>,
    },
    Roots {
        candidates: Vec<String>,
    },
    Root {
        relative_path: String,
    },
    Title {
        title: String,
    },
    Rejected {
        code: RejectionCode,
        message: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transfer_uses_the_existing_project_envelope() {
        let input = crate::writing_project::Input::Transfer {
            input: Box::new(Input::InspectImport {
                source_path: "/synthetic/project.zip".into(),
            }),
        };
        assert_eq!(
            input.operation(),
            crate::writing_project::Operation::Transfer
        );
        let encoded = serde_json::to_vec(&input).unwrap();
        assert_eq!(
            serde_json::from_slice::<crate::writing_project::Input>(&encoded).unwrap(),
            input
        );
        assert!(
            serde_json::from_str::<Input>(
                r#"{"kind":"inspectImport","sourcePath":"/synthetic/project.zip","writer":true}"#
            )
            .is_err()
        );
        assert!(
            serde_json::from_str::<Decision>(
                r#"{"kind":"rejected","code":"arbitrary_sql","message":"invalid"}"#
            )
            .is_err()
        );
    }

    #[test]
    fn transfer_results_retain_the_original_ipc_field_names() {
        let result = crate::writing_project::ManuscriptExportResult {
            destination_path: "/synthetic/paper.pdf".into(),
            file_count: 1,
            byte_size: 7,
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"destinationPath":"/synthetic/paper.pdf","fileCount":1,"byteSize":7})
        );
        assert_eq!(
            serde_json::from_value::<crate::writing_project::ManuscriptExportResult>(json).unwrap(),
            result
        );
    }
}
