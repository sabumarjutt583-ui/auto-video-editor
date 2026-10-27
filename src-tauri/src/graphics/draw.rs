//! Turns the director plan into real FFmpeg filters, so a graphic spec can be drawn over
//! a finished video. Renderable subset only: text layers and lower-third layers, drawn
//! with drawtext/drawbox. Every other layer type (map, chart, timeline, particles, ...)
//! is reported in `skipped` and not drawn — those still need the frontend renderer and
//! its transparent clip export, which is a different path. Opacity is applied to text
//! (drawtext alpha); the lower-third bar is drawn at a fixed 0.6 alpha.

use serde::Serialize;

use super::director::plan_layers;
use super::spec::{GraphicSpec, Layer};

/// One planned layer, as the frontend sees it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedLayer {
    pub id: String,
    pub layer_type: String,
    pub start: f64,
    pub end: f64,
    pub opacity: f64,
    pub visible: bool,
}

/// The result of turning a spec into filters.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawResult {
    pub filters: Vec<String>,
    pub skipped: Vec<String>,
    pub plan: Vec<PlannedLayer>,
}

/// Escapes text for drawtext: backslash, quote, colon and percent are special there.
fn escape_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '\'' => out.push_str("\\'"),
            ':' => out.push_str("\\:"),
            '%' => out.push_str("\\%"),
            '\n' => out.push(' '),
            _ => out.push(ch),
        }
    }
    out
}

/// A colour name or #hex that FFmpeg understands; anything else becomes white.
fn safe_color(color: Option<&str>) -> String {
    let raw = color.unwrap_or("white").trim();
    if !raw.is_empty() && raw.chars().all(|c| c.is_ascii_alphanumeric() || c == '#') {
        raw.to_string()
    } else {
        "white".to_string()
    }
}

fn enable(start: f64, end: f64) -> String {
    format!("between(t,{:.3},{:.3})", start, end)
}

fn drawtext(fontfile: &str, text: &str, size_px: u32, x: f64, y: f64, color: &str, opacity: f64, start: f64, end: f64) -> String {
    format!(
        "drawtext=fontfile='{fontfile}':text='{text}':fontsize={size_px}:x={x:.0}:y={y:.0}:fontcolor={color}:alpha={opacity:.2}:enable='{enable}'",
        fontfile = fontfile,
        text = escape_text(text),
        size_px = size_px.max(10),
        x = x,
        y = y,
        color = color,
        opacity = opacity.clamp(0.0, 1.0),
        enable = enable(start, end),
    )
}

/// Builds the filters for a spec at a video size. Returns an error for an invalid spec.
pub fn draw_filters(spec_json: &str, width: u32, height: u32, fontfile: &str) -> Result<DrawResult, String> {
    let spec: GraphicSpec = serde_json::from_str(spec_json).map_err(|e| format!("The graphic spec could not be read: {e}"))?;
    let plan = plan_layers(&spec)?;
    let mut filters = Vec::new();
    let mut skipped = Vec::new();
    let mut planned = Vec::new();
    for entry in &plan {
        planned.push(PlannedLayer { id: entry.id.clone(), layer_type: entry.layer_type.clone(), start: entry.start, end: entry.end, opacity: entry.opacity, visible: entry.visible });
        if !entry.visible {
            continue;
        }
        let Some(layer) = spec.layers.iter().find(|l| l.common().id == entry.id) else { continue };
        let rect = layer.common().rect;
        let (x, y, w, h) = (rect.x * width as f64, rect.y * height as f64, rect.w * width as f64, rect.h * height as f64);
        match layer {
            Layer::Text { text, size, color, .. } => {
                filters.push(drawtext(fontfile, text, (*size * height as f64) as u32, x, y, &safe_color(color.as_deref()), entry.opacity, entry.start, entry.end));
            }
            Layer::LowerThird { title, subtitle, .. } => {
                filters.push(format!(
                    "drawbox=x={x:.0}:y={y:.0}:w={w:.0}:h={h:.0}:color=black@0.6:t=fill:enable='{enable}'",
                    x = x, y = y, w = w, h = h, enable = enable(entry.start, entry.end),
                ));
                let title_size = (h * 0.35) as u32;
                filters.push(drawtext(fontfile, title, title_size, x + 20.0, y + h * 0.12, "white", entry.opacity, entry.start, entry.end));
                if let Some(subtitle) = subtitle {
                    if !subtitle.trim().is_empty() {
                        filters.push(drawtext(fontfile, subtitle, (h * 0.24) as u32, x + 20.0, y + h * 0.55, "white", entry.opacity, entry.start, entry.end));
                    }
                }
            }
            _ => {
                if !skipped.contains(&entry.layer_type) {
                    skipped.push(entry.layer_type.clone());
                }
            }
        }
    }
    Ok(DrawResult { filters, skipped, plan: planned })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SPEC: &str = r#"{"schemaVersion":1,"id":"g1","duration":10,"layers":[
        {"type":"text","id":"t1","box":{"x":0.1,"y":0.1,"w":0.8,"h":0.1},"start":1,"duration":4,"text":"Hello world","size":0.06},
        {"type":"lowerThird","id":"lt1","box":{"x":0.06,"y":0.7,"w":0.5,"h":0.17},"start":2,"duration":5,"title":"Dr. Amina Khan","subtitle":"Climate scientist"},
        {"type":"map","id":"m1","box":{"x":0,"y":0,"w":1,"h":1},"start":0,"duration":10,"region":"world"}
    ]}"#;

    #[test]
    fn text_and_lower_third_become_filters_and_other_types_are_skipped() {
        let result = draw_filters(SPEC, 1920, 1080, "/fonts/DejaVuSans.ttf").expect("valid spec");
        assert!(result.filters.iter().any(|f| f.starts_with("drawtext") && f.contains("Hello world")));
        assert!(result.filters.iter().any(|f| f.starts_with("drawbox")));
        assert!(result.filters.iter().any(|f| f.contains("Amina Khan")));
        assert!(result.skipped.contains(&"map".to_string()));
        assert!(result.plan.len() == 3);
    }

    #[test]
    fn an_invalid_spec_is_an_error_not_filters() {
        assert!(draw_filters("not json", 1920, 1080, "/fonts/x.ttf").is_err());
    }
}
