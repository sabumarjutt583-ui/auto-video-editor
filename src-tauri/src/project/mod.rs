//! Projects: each one is a folder in the app data `projects` folder.
//!
//! ```text
//! projects/<id>/project.json   the project (see model.rs)
//!               audio/         processed voice-over
//!               media/         optional copies of images and videos
//!               exports/       rendered videos
//! ```

mod migrate;
mod model;
mod stamp;
mod store;

pub use model::{Project, ProjectSettings, ProjectSummary, TimeRange};
pub use store::{ProjectList, ProjectStore};
