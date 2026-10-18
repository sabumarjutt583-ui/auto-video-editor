//! Sound-effect and style packages that can be updated without a new app version:
//! a small manifest says which version is current, a zip holds the files, and a SHA-256 proves
//! the download is whole. The previous version is kept so an update can be undone.

pub mod hash;
pub mod manifest;
pub mod store;
pub mod update;
pub mod zip;
