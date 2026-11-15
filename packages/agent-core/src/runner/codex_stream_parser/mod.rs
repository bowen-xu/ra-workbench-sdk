//! Adapted from OpenAI Codex utils/stream-parser at
//! e363b08c9175ac1cbe5893615dd2cb9ddf95043b, Apache-2.0, Copyright 2025 OpenAI.
//! See third-party/codex/LICENSE and NOTICE. Imports and test assertion macros
//! were adapted to this crate; matching and streaming semantics are unchanged.
#![allow(
    dead_code,
    reason = "retain the upstream streaming parser and its regression tests"
)]
mod citation;
mod inline_hidden_tag;
mod stream_text;

pub(super) use citation::strip_citations;
use inline_hidden_tag::{InlineHiddenTagParser, InlineTagSpec};
use stream_text::{StreamTextChunk, StreamTextParser};
