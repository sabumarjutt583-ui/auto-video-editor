//! Motion graphics (GraphicSpec). Phase 1: the typed copy of the spec. The TypeScript validator in
//! `src/lib/graphics/spec` is the single place with the rules; Rust only reads what it already approved.
// The structs are first used by the transparent export (phase 3).
#[allow(dead_code)]
pub mod spec;

#[cfg(test)]
mod golden_tests;
