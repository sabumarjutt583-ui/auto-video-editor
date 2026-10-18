use serde::Deserialize;

/// A spoken word of a caption line, in seconds.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionWord {
    pub text: String,
    pub start: f64,
    pub end: f64,
}

/// One caption: what is on screen from `start` to `end`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionLine {
    pub start: f64,
    pub end: f64,
    pub words: Vec<CaptionWord>,
    /// Index of the word that starts the second line, if the caption has two lines.
    #[serde(default)]
    pub break_at: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Preset {
    Clean,
    Highlight,
    Pop,
    Boxed,
    Documentary,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Position {
    Bottom,
    Middle,
    Top,
}

/// How the captions look. Sizes are in pixels of the finished video.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Look {
    pub preset: Preset,
    pub font: String,
    pub font_size: f64,
    /// "#RRGGBB"
    pub primary: String,
    pub highlight: String,
    pub outline: f64,
    pub shadow: f64,
    pub position: Position,
    pub uppercase: bool,
    pub bold: bool,
    pub margin_v: i32,
    pub margin_h: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssRequest {
    pub width: u32,
    pub height: u32,
    pub look: Look,
    pub lines: Vec<CaptionLine>,
}
