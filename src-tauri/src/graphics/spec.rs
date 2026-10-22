//! Rust mirror of `src/lib/graphics/spec/schema.ts` (GraphicSpec v1). Field names are camelCase as in the JSON.
//! Both sides are tested with the same fixture files in `src/lib/graphics/spec/fixtures`.

use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphicSpec {
    pub schema_version: u32,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub duration: f64,
    #[serde(default = "one")]
    pub seed: u32,
    #[serde(default = "default_brand")]
    pub brand: String,
    pub layers: Vec<Layer>,
}

fn one() -> u32 {
    1
}
fn default_brand() -> String {
    "default".to_string()
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Anim {
    pub preset: String,
    #[serde(default)]
    pub duration: f64,
    #[serde(default)]
    pub delay: f64,
    #[serde(default)]
    pub easing: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IconRef {
    pub set: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub lat: f64,
    pub lon: f64,
}

/// Fields every layer has.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Common {
    pub id: String,
    #[serde(rename = "box")]
    pub rect: Rect,
    #[serde(default)]
    pub start: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enter: Option<Anim>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit: Option<Anim>,
    #[serde(default = "full")]
    pub opacity: f64,
}

fn full() -> f64 {
    1.0
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Run {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChartRow {
    pub label: String,
    pub value: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TimelineEvent {
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MapCountry {
    pub code: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MapPin {
    pub name: String,
    pub lat: f64,
    pub lon: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MapRoute {
    pub from: Point,
    pub to: Point,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ListItem {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<IconRef>,
}


// Defaults: the same values as the TypeScript schema (the validator normally fills them before Rust sees a spec).
fn d_text_size() -> f64 { 0.06 }
fn d_bold() -> String { "bold".into() }
fn d_center() -> String { "center".into() }
fn d_two() -> u32 { 2 }
fn d_round_rect() -> String { "roundRect".into() }
fn d_radius() -> f64 { 0.2 }
fn d_grouped() -> String { "grouped".into() }
fn d_counter_size() -> f64 { 0.12 }
fn d_bar() -> String { "bar".into() }
fn d_horizontal() -> String { "horizontal".into() }
fn d_world() -> String { "world".into() }
fn d_natural_earth() -> String { "naturalEarth".into() }
fn d_bullets() -> String { "bullets".into() }
fn d_true() -> bool { true }
fn d_dust() -> String { "dust".into() }
fn d_count() -> u32 { 60 }
fn d_pop() -> String { "pop".into() }
fn d_kinetic_size() -> f64 { 0.09 }
fn d_contain() -> String { "contain".into() }
fn d_rect() -> String { "rect".into() }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Layer {
    Text {
        #[serde(flatten)]
        common: Common,
        text: String,
        #[serde(default = "d_text_size")]
        size: f64,
        #[serde(default = "d_bold")]
        weight: String,
        #[serde(default = "d_center")]
        align: String,
        #[serde(rename = "maxLines", default = "d_two")]
        max_lines: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        color: Option<String>,
    },
    RichText {
        #[serde(flatten)]
        common: Common,
        runs: Vec<Run>,
        #[serde(default = "d_text_size")]
        size: f64,
        #[serde(default = "d_center")]
        align: String,
        #[serde(rename = "maxLines", default = "d_two")]
        max_lines: u32,
    },
    Image {
        #[serde(flatten)]
        common: Common,
        src: String,
        #[serde(default = "d_contain")]
        fit: String,
        #[serde(default)]
        radius: f64,
    },
    Icon {
        #[serde(flatten)]
        common: Common,
        icon: IconRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        color: Option<String>,
    },
    Shape {
        #[serde(flatten)]
        common: Common,
        #[serde(default = "d_round_rect")]
        shape: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fill: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stroke: Option<String>,
        #[serde(rename = "strokeWidth", default)]
        stroke_width: f64,
        #[serde(default = "d_radius")]
        radius: f64,
    },
    Counter {
        #[serde(flatten)]
        common: Common,
        #[serde(default)]
        from: f64,
        to: f64,
        #[serde(default)]
        decimals: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prefix: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        suffix: Option<String>,
        #[serde(default = "d_grouped")]
        format: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        label: Option<String>,
        #[serde(default = "d_counter_size")]
        size: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        color: Option<String>,
    },
    Chart {
        #[serde(flatten)]
        common: Common,
        #[serde(default = "d_bar")]
        kind: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        unit: Option<String>,
        rows: Vec<ChartRow>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        highlight: Option<u32>,
    },
    Timeline {
        #[serde(flatten)]
        common: Common,
        #[serde(default = "d_horizontal")]
        orientation: String,
        events: Vec<TimelineEvent>,
    },
    Map {
        #[serde(flatten)]
        common: Common,
        #[serde(default = "d_world")]
        region: String,
        #[serde(default = "d_natural_earth")]
        projection: String,
        #[serde(default)]
        countries: Vec<MapCountry>,
        #[serde(default)]
        pins: Vec<MapPin>,
        #[serde(default)]
        routes: Vec<MapRoute>,
    },
    LowerThird {
        #[serde(flatten)]
        common: Common,
        title: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        subtitle: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        icon: Option<IconRef>,
    },
    QuoteCard {
        #[serde(flatten)]
        common: Common,
        quote: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        author: Option<String>,
    },
    List {
        #[serde(flatten)]
        common: Common,
        #[serde(default = "d_bullets")]
        style: String,
        items: Vec<ListItem>,
    },
    ProgressBar {
        #[serde(flatten)]
        common: Common,
        #[serde(default)]
        from: f64,
        to: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        label: Option<String>,
        #[serde(rename = "showPercent", default = "d_true")]
        show_percent: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        color: Option<String>,
    },
    Particles {
        #[serde(flatten)]
        common: Common,
        #[serde(default = "d_dust")]
        kind: String,
        #[serde(default = "d_count")]
        count: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        color: Option<String>,
    },
    KineticText {
        #[serde(flatten)]
        common: Common,
        words: Vec<String>,
        #[serde(default = "d_pop")]
        style: String,
        #[serde(default = "d_kinetic_size")]
        size: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        color: Option<String>,
    },
    Flag {
        #[serde(flatten)]
        common: Common,
        country: String,
        #[serde(default = "d_rect")]
        shape: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
}

impl Layer {
    pub fn common(&self) -> &Common {
        match self {
            Layer::Text { common, .. }
            | Layer::RichText { common, .. }
            | Layer::Image { common, .. }
            | Layer::Icon { common, .. }
            | Layer::Shape { common, .. }
            | Layer::Counter { common, .. }
            | Layer::Chart { common, .. }
            | Layer::Timeline { common, .. }
            | Layer::Map { common, .. }
            | Layer::LowerThird { common, .. }
            | Layer::QuoteCard { common, .. }
            | Layer::List { common, .. }
            | Layer::ProgressBar { common, .. }
            | Layer::Particles { common, .. }
            | Layer::KineticText { common, .. }
            | Layer::Flag { common, .. } => common,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const STAT: &str = include_str!("../../../src/lib/graphics/spec/fixtures/stat_callout.json");
    const ALL: &str = include_str!("../../../src/lib/graphics/spec/fixtures/all_layers.json");

    #[test]
    fn stat_callout_reads_and_round_trips() {
        let spec: GraphicSpec = serde_json::from_str(STAT).unwrap();
        assert_eq!(spec.schema_version, SCHEMA_VERSION);
        assert_eq!(spec.layers.len(), 3);
        assert_eq!(spec.layers[2].common().start, 0.3);
        let json = serde_json::to_string(&spec).unwrap();
        let again: GraphicSpec = serde_json::from_str(&json).unwrap();
        assert_eq!(spec, again);
    }

    #[test]
    fn all_sixteen_layer_types_read() {
        let spec: GraphicSpec = serde_json::from_str(ALL).unwrap();
        assert_eq!(spec.layers.len(), 16);
        assert_eq!(spec.brand, "news");
        assert!(matches!(spec.layers[8], Layer::Map { .. }));
        assert!(matches!(spec.layers[15], Layer::Flag { .. }));
        let json = serde_json::to_value(&spec).unwrap();
        assert_eq!(json["layers"][8]["type"], "map");
        assert_eq!(json["layers"][0]["box"]["w"], 0.8);
        let again: GraphicSpec = serde_json::from_value(json).unwrap();
        assert_eq!(spec, again);
    }

    #[test]
    fn unknown_layer_type_is_an_error() {
        let bad = r#"{"schemaVersion":1,"id":"x","duration":2,"layers":[{"type":"hologram","id":"a","box":{"x":0,"y":0,"w":1,"h":1}}]}"#;
        assert!(serde_json::from_str::<GraphicSpec>(bad).is_err());
    }
}
