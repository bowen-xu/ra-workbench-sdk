use crate::protocol::ReasoningSummaryPart;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReasoningSummary {
    pub item_id: String,
    pub text: String,
    pub parts: Vec<ReasoningSummaryPart>,
}
