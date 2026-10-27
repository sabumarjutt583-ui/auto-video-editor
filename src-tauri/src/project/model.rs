//! The project data model (mirrors src/types/project.ts).
//!
//! Paths such as `voicePath`, `matchedFile` and `mediaMap` values are either relative to the
//! project folder (a copy kept inside it, e.g. `audio/voice.wav`) or absolute (a file elsewhere
//! on the computer). Relative paths keep a project working when it is duplicated or moved.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::settings::{AspectRatio, Quality, Settings};

/// Bump this when the shape of project.json changes, and add a step in migrate.rs.
pub const SCHEMA_VERSION: u32 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TimingSource {
    Srt,
    Json,
    Groq,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaType {
    #[default]
    Image,
    Video,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SceneStatus {
    /// Scene exists but has no prompt yet.
    #[default]
    Pending,
    PromptReady,
    Matched,
}

/// One spoken word with its time in seconds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Word {
    pub text: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Scene {
    /// `S01`, `S02`, ...
    pub id: String,
    pub index: u32,
    pub start: f64,
    pub end: f64,
    pub duration: f64,
    /// Exact wording from the user's script.
    pub text: String,
    pub media_type: MediaType,
    pub prompt: String,
    pub motion_prompt: String,
    pub matched_file: Option<String>,
    pub status: SceneStatus,
    /// Which spoken sentences the scene covers (0-based, inclusive).
    pub first_sentence: u32,
    pub last_sentence: u32,
    /// Which words (indexes in `words`, inclusive) the scene covers.
    pub first_word: u32,
    pub last_word: u32,
    /// The English scene description written by the AI (before the app adds the rest).
    pub description: String,
    /// True once the user has edited the final prompt by hand.
    pub edited: bool,
    /// The negative prompt text that goes with `prompt` for the chosen tool.
    pub negative: String,
    /// Characters (ids from `characterBible`) and the location that appear in this scene.
    pub character_ids: Vec<String>,
    pub location_id: Option<String>,
    /// What the app repaired in a prompt from the web chat, and things to check.
    pub fix_notes: Vec<String>,
}

/// A person who must look the same in every prompt.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Character {
    pub id: String,
    pub name: String,
    pub role: String,
    /// ONE fixed English description of how the person looks.
    pub appearance: String,
}

/// A place that must look the same in every prompt.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Location {
    pub id: String,
    pub name: String,
    pub description: String,
    /// Optional sound mood ("calm", "tense", "nature"...). Picks the ambience bed of the sound effects.
    pub mood: String,
}

/// A stretch of the voice-over in seconds.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct TimeRange {
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CleanupMode {
    /// Nothing done yet.
    #[default]
    None,
    /// Silences were cut out.
    Cut,
    /// The user chose to keep the original as it is.
    Skipped,
}

/// Silence-removal choices and what was done (step 1 of the Prompt Generator).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VoiceCleanup {
    pub mode: CleanupMode,
    pub threshold_db: f64,
    /// Silences at least this long (seconds) are cut.
    pub min_silence: f64,
    /// Seconds of silence kept around speech.
    pub padding: f64,
    pub normalize: bool,
}

impl Default for VoiceCleanup {
    fn default() -> Self {
        Self { mode: CleanupMode::None, threshold_db: -40.0, min_silence: 0.6, padding: 0.15, normalize: false }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SceneMode {
    #[default]
    Sentence,
    Seconds,
    Ai,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SceneSettings {
    pub mode: SceneMode,
    /// Used by the per-sentence mode: 1 to 4.
    pub sentences_per_scene: u32,
    /// Used by the per-seconds mode.
    pub target_seconds: f64,
    /// Video scenes longer than this are split into a/b parts.
    pub max_video_seconds: f64,
    /// Scenes shorter than this are joined to a neighbour (seconds).
    pub min_seconds: f64,
}

impl Default for SceneSettings {
    fn default() -> Self {
        Self { mode: SceneMode::Sentence, sentences_per_scene: 1, target_seconds: 5.0, max_video_seconds: 8.0, min_seconds: 2.0 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputType {
    #[default]
    Image,
    Video,
    ImageMotion,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DetailLevel {
    Short,
    #[default]
    Medium,
    Detailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetTool {
    #[default]
    Generic,
    Midjourney,
    StableDiffusion,
    Flux,
    DalleGemini,
    Video,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PromptSettings {
    pub output_type: OutputType,
    pub detail: DetailLevel,
    pub tool: TargetTool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectSettings {
    pub aspect_ratio: AspectRatio,
    pub quality: Quality,
}

impl Default for ProjectSettings {
    fn default() -> Self {
        Self {
            aspect_ratio: AspectRatio::Landscape,
            quality: Quality::P1080,
        }
    }
}

impl ProjectSettings {
    /// New projects start with the defaults chosen in Settings.
    pub fn from_app_settings(settings: &Settings) -> Self {
        Self {
            aspect_ratio: settings.default_aspect_ratio,
            quality: settings.default_quality,
        }
    }
}

/// A voice-over part that is not the one being worked on. `snapshot` holds the part's own fields
/// (voice, timing, scenes, editor...) exactly as the app stores them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct VoicePart {
    pub id: String,
    pub name: String,
    pub snapshot: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Project {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub created_at: String,
    /// Set by the app every time the project is saved.
    pub updated_at: String,
    pub voice_path: Option<String>,
    pub voice_locked: bool,
    /// Seconds.
    pub voice_duration: f64,
    /// Language of the narration, e.g. "ko". Empty until chosen.
    pub language: String,
    pub timing_source: Option<TimingSource>,
    pub words: Vec<Word>,
    pub scenes: Vec<Scene>,
    pub settings: ProjectSettings,
    pub character_bible: Vec<Character>,
    pub location_bible: Vec<Location>,
    /// When true, prompt generation must use the bible texts exactly as they are.
    pub bible_locked: bool,
    pub style_id: Option<String>,
    /// The original voice file inside the project folder (e.g. `audio/original.mp3`).
    /// `voicePath` is the cleaned file the rest of the app uses (`audio/processed.wav`).
    pub voice_original_path: Option<String>,
    pub voice_original_duration: f64,
    pub voice_sample_rate: u32,
    pub voice_channels: u32,
    pub voice_cleanup: VoiceCleanup,
    /// Ranges removed from the original voice, in original time.
    pub cut_map: Vec<TimeRange>,
    /// The exact script the user pasted (may be empty).
    pub script: String,
    /// Step 0 audit record for the script. Empty/zero on older projects, which
    /// predate Step 0 records; their script source is unknown, not guessed.
    /// Where the script came from: "claude" or "typed".
    pub script_source: String,
    /// The title/topic given to Claude, or "" for a typed script.
    pub script_topic: String,
    /// The word count asked for, or 0 when none was asked.
    pub script_words_requested: u32,
    /// The fingerprint of the master prompt used (see src/lib/script/step0.ts).
    pub script_master_prompt_version: String,
    /// True when word times were estimated from line-level times (SRT/VTT).
    pub timing_estimated: bool,
    /// How well the script matched the timed words, 0 to 100.
    pub alignment_quality: Option<f64>,
    /// Indexes of script words that were not found in the speech (shown orange in the preview).
    pub unmatched_words: Vec<u32>,
    pub scene_settings: SceneSettings,
    pub prompt_settings: PromptSettings,
    /// Scene id (`S01`) to media file.
    pub media_map: BTreeMap<String, String>,
    /// When the final video was last rendered. Empty until the first render.
    pub rendered_at: Option<String>,
    /// Everything the Auto Editor adds (imported media, per-scene overrides, captions, audio mix).
    /// The shape is owned by src/types/editor.ts; it is kept as JSON here so nothing is lost on save.
    pub editor: serde_json::Value,
    /// Id of the part being worked on ("" = the only part, called "Part 1").
    pub active_part_id: String,
    /// Name of the part being worked on ("" = "Part 1").
    pub part_name: String,
    /// The other parts of a voice-over that comes in several parts.
    pub parts: Vec<VoicePart>,
    /// The channel profile this video was made for ("" = none). Used by the Channels dashboard.
    pub channel_id: String,
}

impl Default for Project {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            id: String::new(),
            name: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
            voice_path: None,
            voice_locked: false,
            voice_duration: 0.0,
            language: String::new(),
            timing_source: None,
            words: Vec::new(),
            scenes: Vec::new(),
            settings: ProjectSettings::default(),
            character_bible: Vec::new(),
            location_bible: Vec::new(),
            bible_locked: false,
            style_id: None,
            voice_original_path: None,
            voice_original_duration: 0.0,
            voice_sample_rate: 0,
            voice_channels: 0,
            voice_cleanup: VoiceCleanup::default(),
            cut_map: Vec::new(),
            script: String::new(),
            script_source: String::new(),
            script_topic: String::new(),
            script_words_requested: 0,
            script_master_prompt_version: String::new(),
            timing_estimated: false,
            alignment_quality: None,
            unmatched_words: Vec::new(),
            scene_settings: SceneSettings::default(),
            prompt_settings: PromptSettings::default(),
            media_map: BTreeMap::new(),
            rendered_at: None,
            editor: serde_json::Value::Null,
            active_part_id: String::new(),
            part_name: String::new(),
            parts: Vec::new(),
            channel_id: String::new(),
        }
    }
}

impl Project {
    pub fn new(id: String, name: String, now: String, settings: ProjectSettings) -> Self {
        Self {
            id,
            name,
            created_at: now.clone(),
            updated_at: now,
            settings,
            ..Self::default()
        }
    }
}

/// How far a project has got. `None` means it is still being set up.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectStatus {
    PromptsReady,
    MediaMatched,
    Rendered,
}

pub fn derive_status(project: &Project) -> Option<ProjectStatus> {
    if project.rendered_at.is_some() {
        return Some(ProjectStatus::Rendered);
    }
    if project.scenes.is_empty() {
        return None;
    }
    if project.scenes.iter().all(|scene| scene.matched_file.is_some()) {
        return Some(ProjectStatus::MediaMatched);
    }
    if project.scenes.iter().all(|scene| !scene.prompt.trim().is_empty()) {
        return Some(ProjectStatus::PromptsReady);
    }
    None
}

/// The small version of a project shown on a card (no words or scenes).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub voice_duration: f64,
    pub scene_count: usize,
    pub status: Option<ProjectStatus>,
    /// The channel this video belongs to ("" = none).
    pub channel_id: String,
    /// What is finished so far, for the Channels dashboard (the steps of "Make video").
    /// True when the project has a saved script (Step 0).
    pub has_script: bool,
    pub voice_locked: bool,
    pub has_words: bool,
    pub bible_locked: bool,
    pub prompts_written: usize,
    /// Image scenes that have a prompt, and how many of them already have a picture.
    pub picture_scenes: usize,
    pub pictures: usize,
    pub audio_mixed: bool,
    pub rendered: bool,
}

impl From<&Project> for ProjectSummary {
    fn from(project: &Project) -> Self {
        Self {
            id: project.id.clone(),
            name: project.name.clone(),
            created_at: project.created_at.clone(),
            updated_at: project.updated_at.clone(),
            voice_duration: project.voice_duration,
            scene_count: project.scenes.len(),
            status: derive_status(project),
            channel_id: project.channel_id.clone(),
            has_script: !project.script.trim().is_empty(),
            voice_locked: project.voice_locked && project.voice_path.is_some() && project.voice_duration > 0.0,
            has_words: !project.words.is_empty(),
            bible_locked: project.bible_locked,
            prompts_written: project.scenes.iter().filter(|scene| !scene.prompt.trim().is_empty()).count(),
            picture_scenes: project.scenes.iter().filter(|scene| scene.media_type == MediaType::Image && !scene.prompt.trim().is_empty()).count(),
            pictures: project
                .scenes
                .iter()
                .filter(|scene| scene.media_type == MediaType::Image && !scene.prompt.trim().is_empty())
                .filter(|scene| project.media_map.get(&scene.id).is_some_and(|file| !file.is_empty()))
                .count(),
            audio_mixed: project.editor.pointer("/audio/mix").is_some_and(|mix| mix.is_object()),
            rendered: project.rendered_at.is_some(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project_with_scenes(prompts: &[&str], matched: &[bool]) -> Project {
        let mut project = Project::default();
        for (index, (prompt, matched)) in prompts.iter().zip(matched).enumerate() {
            project.scenes.push(Scene {
                id: format!("S{:02}", index + 1),
                prompt: (*prompt).to_string(),
                matched_file: matched.then(|| "a.png".to_string()),
                ..Scene::default()
            });
        }
        project
    }

    #[test]
    fn a_new_project_has_the_current_schema_and_chosen_defaults() {
        let settings = ProjectSettings { aspect_ratio: AspectRatio::Portrait, quality: Quality::K4 };
        let project = Project::new("prj_1".into(), "My video".into(), "2026-01-01T00:00:00.000Z".into(), settings);
        assert_eq!(project.schema_version, SCHEMA_VERSION);
        assert_eq!(project.created_at, project.updated_at);
        assert_eq!(project.settings, settings);
        assert!(project.scenes.is_empty() && project.words.is_empty());
    }

    #[test]
    fn uses_the_json_shape_the_frontend_expects() {
        let mut project = Project::default();
        project.timing_source = Some(TimingSource::Groq);
        project.scenes.push(Scene { media_type: MediaType::Video, status: SceneStatus::PromptReady, ..Scene::default() });
        let json = serde_json::to_value(&project).unwrap();
        assert_eq!(json["schemaVersion"], SCHEMA_VERSION);
        assert_eq!(json["timingSource"], "groq");
        assert_eq!(json["voiceLocked"], false);
        assert_eq!(json["settings"]["aspectRatio"], "16:9");
        assert_eq!(json["scenes"][0]["mediaType"], "video");
        assert_eq!(json["scenes"][0]["status"], "prompt_ready");
        assert!(json["voicePath"].is_null());
    }

    #[test]
    fn a_partial_file_is_filled_up_with_defaults() {
        let project: Project = serde_json::from_str(r#"{"name":"Old","scenes":[{"id":"S01"}]}"#).unwrap();
        assert_eq!(project.name, "Old");
        assert_eq!(project.scenes[0].media_type, MediaType::Image);
        assert_eq!(project.settings, ProjectSettings::default());
    }

    #[test]
    fn status_follows_the_work_done() {
        assert_eq!(derive_status(&Project::default()), None);
        assert_eq!(derive_status(&project_with_scenes(&["a", ""], &[false, false])), None);
        assert_eq!(derive_status(&project_with_scenes(&["a", "b"], &[false, false])), Some(ProjectStatus::PromptsReady));
        assert_eq!(derive_status(&project_with_scenes(&["a", "b"], &[true, false])), Some(ProjectStatus::PromptsReady));
        assert_eq!(derive_status(&project_with_scenes(&["a", "b"], &[true, true])), Some(ProjectStatus::MediaMatched));
        let mut rendered = project_with_scenes(&["a"], &[true]);
        rendered.rendered_at = Some("2026-01-01T00:00:00.000Z".into());
        assert_eq!(derive_status(&rendered), Some(ProjectStatus::Rendered));
    }

    #[test]
    fn summary_reports_the_channel_and_the_steps_that_are_finished() {
        let mut project = project_with_scenes(&["a", "b", "c"], &[true, true, true]);
        project.channel_id = "korean-senior".into();
        project.words = vec![Word { text: "hi".into(), start: 0.0, end: 1.0 }];
        project.voice_path = Some("audio/processed.wav".into());
        project.voice_duration = 10.0;
        project.voice_locked = true;
        project.scenes[2].prompt = String::new();
        project.media_map.insert(project.scenes[0].id.clone(), "media/a.png".into());
        project.editor = serde_json::json!({ "audio": { "mix": { "path": "exports/audio_mix.wav" } } });
        let summary = ProjectSummary::from(&project);
        assert_eq!(summary.channel_id, "korean-senior");
        assert!(!summary.has_script, "no script text yet, so Step 0 is not done");
        project.script = "Hello world.".into();
        assert!(ProjectSummary::from(&project).has_script, "a saved script finishes Step 0");
        assert!(summary.voice_locked && summary.has_words && summary.audio_mixed && !summary.rendered);
        assert_eq!((summary.prompts_written, summary.picture_scenes, summary.pictures), (2, 2, 1));
        let json = serde_json::to_value(&summary).unwrap();
        assert_eq!(json["channelId"], "korean-senior");
        assert_eq!(json["pictureScenes"], 2);
    }

    #[test]
    fn an_old_project_without_a_channel_loads_with_none() {
        let project: Project = serde_json::from_str("{\"id\": \"x\", \"name\": \"old\"}").unwrap();
        assert_eq!(project.channel_id, "");
    }

    #[test]
    fn summary_counts_scenes_and_serializes_status() {
        let project = project_with_scenes(&["a", "b"], &[true, true]);
        let summary = ProjectSummary::from(&project);
        assert_eq!(summary.scene_count, 2);
        let json = serde_json::to_value(&summary).unwrap();
        assert_eq!(json["status"], "media_matched");
        assert_eq!(json["sceneCount"], 2);
    }
}
