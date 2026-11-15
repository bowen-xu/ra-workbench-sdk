//! Application-owned agent mechanisms. IO and platform behavior are supplied by ports.

pub mod config;
pub mod context;
pub mod extensions;
pub mod git;

pub mod conversation;
pub mod input_queue;
pub mod instructions;
pub mod mcp;
pub mod model;
pub mod prompt_template;
pub mod protocol;
pub mod resilience;
pub mod runner;
pub mod session;
pub mod skills;
pub mod steering;
pub mod subtasks;
pub mod text_patch;
pub mod tool_registry;

pub mod submission;
pub mod user_input;

pub mod workspace;
