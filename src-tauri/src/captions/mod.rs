//! Captions: turns caption lines and a look into an ASS subtitle file (the format FFmpeg's `subtitles`
//! filter draws). Word highlight uses ASS karaoke tags, pop-in uses a short scale animation.

mod ass;
mod model;
mod text;

pub use ass::build_ass;
pub use model::AssRequest;
