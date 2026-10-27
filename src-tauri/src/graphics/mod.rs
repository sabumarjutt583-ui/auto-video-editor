//! Motion graphics (GraphicSpec). Phase 1: the typed copy of the spec. The TypeScript validator in
//! `src/lib/graphics/spec` is the single place with the rules; Rust only reads what it already approved.
//! Phase 3: the director plan (`director.rs`) checks a spec and turns it into layer windows. The
//! layer renderers that draw from that plan are still later phases.
pub mod cache;
pub mod director;
pub mod draw;
pub mod export;
pub mod spec;

#[cfg(test)]
mod golden_tests;
