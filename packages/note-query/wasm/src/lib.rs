//! Browser ABI only. All algorithms live in research-note-query.
use research_note_query as query;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn note_collation_version() -> String {
    query::note_collation_version()
}
#[wasm_bindgen]
pub fn note_normalization_version() -> String {
    query::note_normalization_version()
}
#[wasm_bindgen]
pub fn note_sort_key(text: &str) -> Result<Vec<u8>, String> {
    query::note_sort_key(text)
}
#[wasm_bindgen]
pub fn note_reverse_key(key: &[u8]) -> Vec<u8> {
    query::note_reverse_key(key)
}
#[wasm_bindgen]
pub fn note_fold(text: &str) -> String {
    query::note_fold(text)
}
#[wasm_bindgen]
pub fn note_query_terms(text: &str) -> Result<Vec<String>, String> {
    query::note_query_terms(text)
}
#[wasm_bindgen]
pub fn note_display_title(body: &str, quote: &str, fallback: &str) -> String {
    query::note_display_title(body, quote, fallback)
}
