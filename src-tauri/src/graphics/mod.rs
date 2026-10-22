//! Motion graphics (GraphicSpec). Phase 1: the typed copy of the spec. The TypeScript validator in
//! `src/lib/graphics/spec` is the single place with the rules; Rust only reads what it already approved.
pub mod export;
// The structs are first used by the director and the layer renderers of later phases.
#[allow(dead_code)]
pub mod spec;

#[cfg(test)]
mod golden_tests;
