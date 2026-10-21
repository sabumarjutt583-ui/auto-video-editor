//! Motion graphics written by the AI. The chat engine asks Gemini for a small self-contained HTML
//! animation; a separate, offline, signed-out browser draws it frame by frame into transparent PNGs,
//! and the renderer lays those frames over the video.
//!
//! * `contract`: the prompt, and cutting the HTML out of the answer;
//! * `png`: reading the transparency of a screenshot (to reject empty or screen-covering graphics);
//! * `capture`: the offline browser that draws the frames;
//! * `generate`: asks, checks, retries.

pub mod capture;
pub mod contract;
pub mod generate;
pub mod png;
