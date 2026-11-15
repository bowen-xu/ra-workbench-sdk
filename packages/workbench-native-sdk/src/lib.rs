//! Native plugin wire contracts without application, persistence or runtime owners.

pub mod analysis_attempt;
pub mod analysis_history;
pub mod analysis_workflow;
pub mod attachments;
pub mod candidate_contracts;
pub mod candidate_review;
pub mod catalog;
pub mod catalog_save;
pub mod concepts;
pub mod context_metadata;
pub mod data;
pub mod derived_view;
pub mod doi_metadata;
pub mod duplicate_merge;
pub mod duplicate_merge_prepare;
pub mod duplicate_review;
pub mod duplicate_undo;
pub mod editable_template;
pub mod evidence;
pub mod evidence_matrix;
pub mod evidence_write;
pub mod generation;
pub mod import_jobs;
pub mod knowledge_promotion;
pub mod knowledge_snapshot;
pub mod literature_lifecycle;
pub mod literature_trace_protocol;
pub mod metadata;
pub mod nal_annotation;
pub mod nal_annotation_prepare;
pub mod nal_bootstrap;
pub mod nal_mutation;
pub mod nal_query;
pub mod nal_state;
pub mod native_snapshot;
pub mod note_catalog_query;
pub mod note_document;
pub mod paper_confirmation;
pub mod paper_context;
pub mod paper_context_prepare;
pub mod paper_context_preview;
pub mod paper_context_wire;
pub mod paper_retrieval;
pub mod pdf_import;
pub mod protocol;
pub mod reading_history;

pub mod reading_units;
pub mod reference_records;
pub mod resource_path;
pub mod retrieval_trace;
pub mod review_selection;
pub mod streaming_payload;
pub mod structured_validation;
pub mod trash_cleanup;
mod wire;
pub mod writing_bibliography;
pub mod writing_catalog;
pub mod writing_catalog_query;
pub mod writing_checkpoint;
pub mod writing_compile;
pub mod writing_context;
pub mod writing_directory;
pub mod writing_file;
pub mod writing_note_asset;
pub mod writing_project;
pub mod writing_projects_protocol;
pub mod writing_transfer;

pub mod concept_retrieval;

pub mod semantic_index;

pub mod research_export;

pub mod browser_capture;
