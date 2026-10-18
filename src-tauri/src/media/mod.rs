//! Pictures and clips the user imports: kinds, safe names, probing and thumbnails.

pub mod expand;
pub mod matching;
pub mod names;
pub mod probe;
pub mod thumbs;

use std::path::Path;

use serde::{Deserialize, Serialize};

pub const IMAGE_EXTENSIONS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];
pub const VIDEO_EXTENSIONS: [&str; 3] = ["mp4", "mov", "webm"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Image,
    Video,
}

/// Image or video, going by the (case-insensitive) extension. `None` for anything else.
pub fn kind_of(path: &Path) -> Option<Kind> {
    let extension = path.extension()?.to_str()?.to_lowercase();
    if IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        Some(Kind::Image)
    } else if VIDEO_EXTENSIONS.contains(&extension.as_str()) {
        Some(Kind::Video)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_follow_the_extension_in_any_case() {
        assert_eq!(kind_of(Path::new("a/S01.PNG")), Some(Kind::Image));
        assert_eq!(kind_of(Path::new("x.jpeg")), Some(Kind::Image));
        assert_eq!(kind_of(Path::new("x.WebM")), Some(Kind::Video));
        assert_eq!(kind_of(Path::new("x.mov")), Some(Kind::Video));
        assert_eq!(kind_of(Path::new("x.gif")), None);
        assert_eq!(kind_of(Path::new("noext")), None);
    }
}
