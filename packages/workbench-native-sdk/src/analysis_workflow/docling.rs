//! Original Docling evidence projection over owned structured source data.
use crate::paper_context::PaperAiReadingContextItem;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DoclingEvidenceRow {
    pub anchor_id: String,
    pub page_index: i64,
    pub page_label: String,
    pub rects_json: String,
    pub quote: String,
    pub context: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DoclingRowInputV1 {
    pub run_id: String,
    pub item: PaperAiReadingContextItem,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DoclingRowDecisionV1 {
    Ready { row: DoclingEvidenceRow },
    Skipped {},
    Unavailable {},
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DoclingPromptInputV1 {
    pub items: Vec<PaperAiReadingContextItem>,
    pub assets: std::collections::BTreeMap<String, crate::generation::provider::StoredImageAsset>,
    pub profile: Option<crate::candidate_contracts::AiOverviewProfileContext>,
    pub evidence: Vec<crate::candidate_contracts::EvidenceQuote>,
}

impl DoclingRowInputV1 {
    pub fn matches_decision(&self, decision: &DoclingRowDecisionV1) -> bool {
        let page = self
            .item
            .regions
            .first()
            .map(|region| region.page_index)
            .or(self.item.page_index);
        match decision {
            DoclingRowDecisionV1::Ready { row } => {
                row.anchor_id == format!("docling:{}:{}", self.run_id, self.item.id)
                    && page.is_some_and(|page| row.page_index == i64::from(page))
            }
            DoclingRowDecisionV1::Skipped {} => page.is_none(),
            DoclingRowDecisionV1::Unavailable {} => true,
        }
    }
}

impl DoclingPromptInputV1 {
    /// Image bytes remain bound to Core's supplied evidence and object assets.
    pub fn matches_result(
        &self,
        result: &Result<crate::generation::provider::ProviderInput, super::AnalysisWorkflowError>,
    ) -> bool {
        let Ok(result) = result else {
            return true;
        };
        result
            .messages
            .iter()
            .flat_map(|message| &message.images)
            .all(|image| {
                self.items.iter().any(|item| {
                    item.kind == "picture"
                        && self
                            .evidence
                            .iter()
                            .any(|evidence| evidence.citation_key == item.id)
                        && self.assets.get(&item.id).is_some_and(|asset| {
                            asset.context_item_id == image.context_item_id
                                && asset.data_url == image.data_url
                        })
                })
            })
    }
}
