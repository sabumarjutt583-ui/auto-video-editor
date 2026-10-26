//! The graphics director in Rust (Phase 3). Phase 1 only copied the spec types; this module is the
//! first Rust step that *uses* them: it checks a GraphicSpec the way the TypeScript validator does
//! (same limits: `LIMITS` in `src/lib/graphics/spec/limits.ts`) and turns it into a render plan —
//! one entry per layer with its real start, end and opacity, in the order the layers are drawn.
//! The layer renderers themselves (drawing text, charts, maps, ...) are still later phases; they
//! will take this plan, not the raw spec. Nothing here touches files, processes or Tauri state, so
//! it is testable exactly. This module is not yet called from a Tauri command: the frontend still
//! draws graphics, and the plan is the piece the Rust renderers will need first.

use crate::graphics::spec::{GraphicSpec, Layer, SCHEMA_VERSION};

/// The same limits as the TypeScript spec validator.
pub const MAX_DURATION: f64 = 20.0;
pub const MIN_DURATION: f64 = 0.3;
pub const MAX_LAYERS: usize = 16;

/// One layer, ready to be drawn: its time window inside the graphic, its opacity, and whether it
/// is on screen at all (a layer that starts after the graphic ends, or has no length, is not).
#[derive(Debug, Clone, PartialEq)]
pub struct LayerPlan {
    pub id: String,
    /// The layer type as written in the spec JSON ("text", "lowerThird", "map", ...).
    pub layer_type: String,
    /// Seconds from the start of the graphic.
    pub start: f64,
    /// Seconds from the start of the graphic; never past the graphic's duration.
    pub end: f64,
    /// 0 = invisible, 1 = fully visible.
    pub opacity: f64,
    pub visible: bool,
}

/// The JSON type name of a layer, as in `src/lib/graphics/spec/schema.ts`.
pub fn layer_type(layer: &Layer) -> &'static str {
    match layer {
        Layer::Text { .. } => "text",
        Layer::RichText { .. } => "richText",
        Layer::Image { .. } => "image",
        Layer::Icon { .. } => "icon",
        Layer::Shape { .. } => "shape",
        Layer::Counter { .. } => "counter",
        Layer::Chart { .. } => "chart",
        Layer::Timeline { .. } => "timeline",
        Layer::Map { .. } => "map",
        Layer::LowerThird { .. } => "lowerThird",
        Layer::QuoteCard { .. } => "quoteCard",
        Layer::List { .. } => "list",
        Layer::ProgressBar { .. } => "progressBar",
        Layer::Particles { .. } => "particles",
        Layer::KineticText { .. } => "kineticText",
        Layer::Flag { .. } => "flag",
    }
}

/// Checks a spec before it is planned. The TypeScript validator normally fixes small problems
/// first (repairSpec); a spec that reaches Rust with one of these problems is rejected, not fixed.
pub fn validate_spec(spec: &GraphicSpec) -> Result<(), String> {
    if spec.schema_version != SCHEMA_VERSION {
        return Err(format!("wrong schema version: {} (expected {SCHEMA_VERSION})", spec.schema_version));
    }
    if !spec.duration.is_finite() || spec.duration < MIN_DURATION || spec.duration > MAX_DURATION {
        return Err(format!("wrong duration: {} ({} to {MAX_DURATION})", spec.duration, MIN_DURATION));
    }
    if spec.layers.is_empty() || spec.layers.len() > MAX_LAYERS {
        return Err(format!("wrong layer count: {} (1 to {MAX_LAYERS})", spec.layers.len()));
    }
    let mut ids: Vec<&str> = Vec::with_capacity(spec.layers.len());
    for layer in &spec.layers {
        let common = layer.common();
        if common.id.is_empty() {
            return Err("a layer has no id".to_string());
        }
        if ids.contains(&common.id.as_str()) {
            return Err(format!("duplicate layer id: {}", common.id));
        }
        ids.push(common.id.as_str());
        if !common.start.is_finite() || common.start < 0.0 {
            return Err(format!("layer {} has a wrong start: {}", common.id, common.start));
        }
        if !common.opacity.is_finite() {
            return Err(format!("layer {} has a wrong opacity: {}", common.id, common.opacity));
        }
    }
    Ok(())
}

/// Turns a spec into its render plan. Layers with no own duration run to the end of the graphic.
/// Times are clamped to the graphic, opacity is clamped to 0..1, and the plan is sorted by start
/// time (then id), which is the order the layers are drawn in. An invalid spec gives an error
/// instead of a plan.
pub fn plan_layers(spec: &GraphicSpec) -> Result<Vec<LayerPlan>, String> {
    validate_spec(spec)?;
    let mut plan: Vec<LayerPlan> = spec
        .layers
        .iter()
        .map(|layer| {
            let common = layer.common();
            let start = common.start.clamp(0.0, spec.duration);
            let end = match common.duration {
                Some(d) => (start + d).clamp(start, spec.duration),
                None => spec.duration,
            };
            LayerPlan {
                id: common.id.clone(),
                layer_type: layer_type(layer).to_string(),
                start,
                end,
                opacity: common.opacity.clamp(0.0, 1.0),
                visible: end > start,
            }
        })
        .collect();
    plan.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.id.cmp(&b.id)));
    Ok(plan)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec_json(layers: &str) -> String {
        format!(r#"{{"schemaVersion":1,"id":"g1","duration":10,"layers":[{layers}]}}"#)
    }

    fn layer(id: &str, start: f64, duration: Option<f64>, opacity: f64) -> String {
        let d = match duration {
            Some(d) => format!(r#","duration":{d}"#),
            None => String::new(),
        };
        format!(r#"{{"type":"text","id":"{id}","box":{{"x":0,"y":0,"w":1,"h":1}},"start":{start}{d},"opacity":{opacity},"text":"hi"}}"#)
    }

    fn plan(json: &str) -> Vec<LayerPlan> {
        let spec: GraphicSpec = serde_json::from_str(json).unwrap();
        plan_layers(&spec).unwrap()
    }

    #[test]
    fn layers_are_planned_in_start_order_with_real_windows() {
        let json = spec_json(&format!("{},{},{}", layer("late", 5.0, Some(2.0), 1.0), layer("early", 0.0, None, 0.5), layer("mid", 2.0, Some(3.0), 1.0)));
        let plan = plan(&json);
        assert_eq!(plan.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), vec!["early", "mid", "late"]);
        assert_eq!((plan[0].start, plan[0].end, plan[0].opacity), (0.0, 10.0, 0.5), "no own duration runs to the end");
        assert_eq!((plan[1].start, plan[1].end), (2.0, 5.0));
        assert_eq!((plan[2].start, plan[2].end), (5.0, 7.0));
        assert!(plan.iter().all(|p| p.visible));
    }

    #[test]
    fn times_and_opacity_are_clamped_and_empty_layers_are_not_visible() {
        let json = spec_json(&format!("{},{}", layer("past", 9.0, Some(5.0), 2.0), layer("gone", 10.0, Some(1.0), -1.0)));
        let plan = plan(&json);
        assert_eq!((plan[0].start, plan[0].end, plan[0].opacity), (9.0, 10.0, 1.0));
        assert_eq!((plan[1].start, plan[1].end, plan[1].opacity, plan[1].visible), (10.0, 10.0, 0.0, false));
    }

    #[test]
    fn layer_types_match_the_spec_json_names() {
        let json = spec_json(r#"{"type":"lowerThird","id":"lt","box":{"x":0,"y":0,"w":1,"h":1},"title":"Name"}"#);
        assert_eq!(plan(&json)[0].layer_type, "lowerThird");
    }

    #[test]
    fn invalid_specs_are_rejected_not_fixed() {
        let bad_version = r#"{"schemaVersion":2,"id":"g1","duration":10,"layers":[{"type":"text","id":"a","box":{"x":0,"y":0,"w":1,"h":1},"text":"hi"}]}"#;
        let spec: GraphicSpec = serde_json::from_str(bad_version).unwrap();
        assert!(plan_layers(&spec).is_err(), "wrong schema version");
        let bad_duration = spec_json(r#"{"type":"text","id":"a","box":{"x":0,"y":0,"w":1,"h":1},"text":"hi"}"#).replace("\"duration\":10", "\"duration\":0");
        let spec: GraphicSpec = serde_json::from_str(&bad_duration).unwrap();
        assert!(plan_layers(&spec).is_err(), "zero duration");
        let no_layers = r#"{"schemaVersion":1,"id":"g1","duration":10,"layers":[]}"#;
        let spec: GraphicSpec = serde_json::from_str(no_layers).unwrap();
        assert!(plan_layers(&spec).is_err(), "no layers");
        let dup = spec_json(&format!("{},{}", layer("a", 0.0, None, 1.0), layer("a", 1.0, None, 1.0)));
        let spec: GraphicSpec = serde_json::from_str(&dup).unwrap();
        assert!(plan_layers(&spec).is_err(), "duplicate layer id");
    }
}
