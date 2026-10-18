//! The Admin Edition: tools for the person who builds the sound library and style packages.
//! This whole folder is compiled only with `--features admin`; the user installer never contains it.

pub mod commands;
pub mod freesound;
pub mod package;
pub mod process;
pub mod workspace;
