//! Image Generator: makes the scene pictures. The engine drives the user's own
//! browser, signed in to their Google account.

//! See docs/IMAGE_ENGINE_NOTES.md and docs/IMAGE_ENGINE_DESIGN.md.

pub mod accounts;
pub mod browser;
pub mod chat;
pub mod config;
pub mod delete;
pub mod engine;
#[cfg(test)]
mod engine_tests;
pub mod errors;
pub mod mapping;
pub mod ops;
pub mod queue;
pub mod real;
pub mod recovery;
pub mod save;
pub mod script_chat;
pub mod settings;
pub mod tool_page;
pub mod video;
pub mod flow;
pub mod worker;
#[cfg(test)]
mod browser_tests;
#[cfg(test)]
pub mod testserver;
pub mod store;
