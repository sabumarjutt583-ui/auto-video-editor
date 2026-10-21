//! What the AI is asked to write, and what is done with the answer.
//!
//! The animation is a time-driven picture: the app sets a time `t` (seconds) and takes a screenshot.
//! The AI may use CSS animations (the app freezes them at `t`) or a `renderFrame(t)` function.
//! Nothing may load from the internet, so a graphic can never leak anything or change between runs.

use crate::imagegen::chat::ChatReply;

/// The longest graphic (seconds): longer ones would take too long to draw.
pub const MAX_SECONDS: f64 = 12.0;
pub const MIN_SECONDS: f64 = 0.8;

#[derive(Debug, Clone, PartialEq)]
pub struct Brief {
    /// What the narrator says during this graphic (any language).
    pub narration: String,
    /// Language name of the narration and of any text in the graphic, e.g. "Korean".
    pub language: String,
    pub seconds: f64,
    pub width: u32,
    pub height: u32,
    /// The look of the whole video (style name, colours, mood). May be empty.
    pub look: String,
    /// What the person wants, in their own words. Empty = the AI decides what fits best.
    pub idea: String,
}

/// Clamps the length to what can be drawn.
pub fn clamp_seconds(seconds: f64) -> f64 {
    if seconds.is_finite() { seconds.clamp(MIN_SECONDS, MAX_SECONDS) } else { 3.0 }
}

fn or_default<'a>(text: &'a str, default: &'a str) -> &'a str {
    if text.trim().is_empty() { default } else { text.trim() }
}

/// The question sent to the chat.
pub fn build_prompt(brief: &Brief, previous_problem: Option<&str>) -> String {
    let seconds = clamp_seconds(brief.seconds);
    let (w, h) = (brief.width, brief.height);
    let orientation = if h > w { "vertical (9:16)" } else if w == h { "square" } else { "wide (16:9)" };
    let idea = if brief.idea.trim().is_empty() {
        "You decide. Read the narration and pick the motion graphic a professional YouTube editor would add here: for example a key word or number appearing, a callout, a counter, a chart, a map pointer, an arrow or circle, a lower third, a timeline, a quote, an icon burst. Choose what explains the narration best; do not decorate for its own sake.".to_string()
    } else {
        format!("The person wants: {}", brief.idea.trim())
    };
    let mut prompt = format!(
        "You are a senior motion designer for YouTube videos. Write ONE self-contained HTML file that shows an animated motion graphic on a TRANSPARENT background. It will be laid over a video.\n\n\
NARRATION during this graphic ({language}):\n\"{narration}\"\n\n\
WHAT TO MAKE:\n{idea}\n\n\
LOOK OF THE VIDEO: {look}\n\n\
TECHNICAL RULES (the file is rejected if any is broken):\n\
1. The canvas is exactly {w}x{h} px ({orientation}). Use `html,body{{margin:0;width:{w}px;height:{h}px;overflow:hidden;background:transparent}}`.\n\
2. Transparent background: draw only the graphic itself. Never fill the whole screen. A soft dark dimmer must stay under 40% opacity. Do not draw a full-screen frame or video-like background.\n\
3. Keep everything inside the central safe area (5% margin). Keep the bottom 20% of the screen EMPTY: captions are shown there.\n\
4. The animation lasts exactly {seconds:.1} seconds: animate in during the first 0.5 s, hold, and animate out during the last 0.5 s so nothing is left on screen at the end.\n\
5. The animation must be a function of time, because the app takes a screenshot for each frame. Use ONE of these two ways:\n\
   a) CSS @keyframes animations that run once (`animation-fill-mode: both`, finite duration, no `infinite`), or SVG animation; or\n\
   b) define `window.renderFrame = function (t) {{ ... }}` that draws the exact state at time `t` seconds (0 to {seconds:.1}) with no timers, no requestAnimationFrame, no Date, no Math.random (use a fixed seed), and no state carried between calls. Canvas or DOM both work.\n\
   You may combine both.\n\
6. Everything is inline: no network, no external fonts, images, scripts or CDN links. Draw icons and shapes with SVG or CSS.\n\
7. Any text must be in {language}, short and large enough to read on a phone (at least {min_font}px), with a strong contrast against any video (use a text shadow, a solid plate or an outline). Use `font-family: 'Noto Sans', 'Noto Sans CJK KR', 'Noto Sans CJK JP', 'Noto Sans CJK SC', 'Noto Sans Devanagari', 'Noto Sans Arabic', sans-serif`.\n\
8. Make it look professional: good easing, staggered entrances, a little overshoot, consistent spacing, a limited colour palette that suits the look of the video. No placeholder text.\n\n\
ANSWER FORMAT: reply with the complete HTML file in a single ```html code block and nothing else.",
        language = or_default(&brief.language, "English"),
        narration = brief.narration.trim().replace('"', "'"),
        look = or_default(&brief.look, "clean, modern, high contrast"),
        min_font = (h.min(w) / 24).max(28),
    );
    if let Some(problem) = previous_problem {
        prompt.push_str(&format!("\n\nYOUR PREVIOUS ANSWER WAS REJECTED: {problem}\nFix this and send the complete corrected HTML file again."));
    }
    prompt
}

/// The HTML file out of the answer, or `None` when the answer holds no HTML.
pub fn extract_html(reply: &ChatReply) -> Option<String> {
    let looks_like_html = |text: &str| {
        let lower = text.to_lowercase();
        lower.contains("<html") || lower.contains("<!doctype") || lower.contains("<body") || (lower.contains("<style") && lower.contains('<'))
    };
    let trimmed = |text: &str| {
        // A code block may start with its language name on its own line (`html`).
        let text = text.trim();
        let text = text.strip_prefix("html").map(str::trim_start).filter(|rest| rest.starts_with('<')).unwrap_or(text);
        text.to_string()
    };
    if let Some(block) = reply.code.iter().map(|c| trimmed(c)).find(|c| looks_like_html(c)) {
        return Some(block);
    }
    let text = &reply.text;
    let start = text.to_lowercase().find("<!doctype").or_else(|| text.to_lowercase().find("<html"))?;
    let end = text.to_lowercase().rfind("</html>").map(|i| i + "</html>".len()).unwrap_or(text.len());
    (end > start).then(|| text[start..end].to_string())
}

fn find_ci(haystack: &str, needle: &str) -> Option<usize> {
    haystack.to_lowercase().find(needle)
}

/// The security wrapper: the page may run its own inline script and style, and nothing else. Also
/// collects script errors in `window.__errors` so a broken graphic can be sent back to the AI.
pub fn wrap_html(ai_html: &str, width: u32, height: u32) -> String {
    let guard = format!(
        "<meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: file:; media-src data:; connect-src 'none'\">\
<script>window.__errors=[];window.addEventListener('error',function(e){{window.__errors.push(String(e.message||e.error||'error'))}});</script>\
<style>html,body{{margin:0;padding:0;width:{width}px;height:{height}px;overflow:hidden;background:transparent !important}}</style>"
    );
    if let Some(head) = find_ci(ai_html, "<head>") {
        let at = head + "<head>".len();
        return format!("{}{}{}", &ai_html[..at], guard, &ai_html[at..]);
    }
    if let Some(html) = find_ci(ai_html, "<html") {
        if let Some(close) = ai_html[html..].find('>') {
            let at = html + close + 1;
            return format!("{}<head>{}</head>{}", &ai_html[..at], guard, &ai_html[at..]);
        }
    }
    format!("<!doctype html><html><head>{guard}</head><body>{ai_html}</body></html>")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn brief() -> Brief {
        Brief { narration: "In 2008 the market lost \"half\" its value".into(), language: "English".into(), seconds: 4.0, width: 1920, height: 1080, look: "dark cinematic, gold accent".into(), idea: String::new() }
    }

    #[test]
    fn the_prompt_carries_the_scene_size_time_and_look() {
        let prompt = build_prompt(&brief(), None);
        for needle in ["1920x1080", "4.0 seconds", "dark cinematic, gold accent", "In 2008 the market lost 'half' its value", "TRANSPARENT", "bottom 20%", "renderFrame", "```html"] {
            assert!(prompt.contains(needle), "missing {needle:?}");
        }
        assert!(prompt.contains("You decide"), "without an idea the AI chooses");
        assert!(!prompt.contains("PREVIOUS ANSWER"));
    }

    #[test]
    fn an_idea_replaces_the_free_choice_and_a_problem_is_sent_back() {
        let mut b = brief();
        b.idea = "a bar chart of three banks".into();
        b.width = 1080;
        b.height = 1920;
        let prompt = build_prompt(&b, Some("It was empty."));
        assert!(prompt.contains("The person wants: a bar chart of three banks"));
        assert!(!prompt.contains("You decide"));
        assert!(prompt.contains("vertical (9:16)"));
        assert!(prompt.contains("REJECTED: It was empty."));
    }

    #[test]
    fn lengths_are_limited() {
        assert_eq!(clamp_seconds(100.0), MAX_SECONDS);
        assert_eq!(clamp_seconds(0.1), MIN_SECONDS);
        assert_eq!(clamp_seconds(f64::NAN), 3.0);
    }

    #[test]
    fn html_is_taken_from_a_code_block_or_from_the_text() {
        let in_block = ChatReply { text: "Here".into(), code: vec!["html\n<!DOCTYPE html><html><body>x</body></html>".into()] };
        assert_eq!(extract_html(&in_block).as_deref(), Some("<!DOCTYPE html><html><body>x</body></html>"));
        let skips_non_html = ChatReply { text: String::new(), code: vec!["console.log(1)".into(), "<html><body>y</body></html>".into()] };
        assert_eq!(extract_html(&skips_non_html).as_deref(), Some("<html><body>y</body></html>"));
        let in_text = ChatReply { text: "Sure:\n<!doctype html><html><body>z</body></html>\nbye".into(), code: vec![] };
        assert_eq!(extract_html(&in_text).as_deref(), Some("<!doctype html><html><body>z</body></html>"));
        assert_eq!(extract_html(&ChatReply { text: "no html here".into(), code: vec![] }), None);
    }

    #[test]
    fn the_wrapper_goes_first_in_the_head_in_every_shape_of_page() {
        let with_head = wrap_html("<html><head><title>a</title></head><body></body></html>", 1920, 1080);
        assert!(with_head.contains("<head><meta charset"));
        assert!(with_head.find("Content-Security-Policy").unwrap() < with_head.find("<title>").unwrap());
        let no_head = wrap_html("<html lang=\"en\"><body>b</body></html>", 640, 360);
        assert!(no_head.contains("<head><meta charset") && no_head.contains("width:640px"));
        let fragment = wrap_html("<div>only a fragment</div>", 640, 360);
        assert!(fragment.starts_with("<!doctype html>") && fragment.contains("<div>only a fragment</div>"));
        assert!(fragment.contains("connect-src 'none'"), "no network of any kind");
    }
}
