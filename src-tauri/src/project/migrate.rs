//! Upgrades old project.json files to the current shape.
//!
//! To change the file format: bump `SCHEMA_VERSION`, write a function that turns a version-N
//! file into a version-N+1 file, and add it to the end of `STEPS`. Never edit an old step.

use serde_json::{Map, Value};

use super::model::SCHEMA_VERSION;

type Step = fn(&mut Map<String, Value>);

/// `STEPS[n]` upgrades a version-n file to version n+1.
const STEPS: &[Step] = &[v0_to_v1, v1_to_v2, v2_to_v3];

#[derive(Debug, PartialEq, Eq)]
pub enum MigrateError {
    NotAnObject,
    /// The file was written by a newer version of the app.
    TooNew(u64),
}

/// Version 0 files were written before `schemaVersion` existed. Every field they lack is
/// filled in with its default when the project is read, so nothing needs to change.
fn v0_to_v1(_project: &mut Map<String, Value>) {}

/// Version 2 gave every character and location an `id`, and renamed a character's
/// `description` to `appearance` (a fixed English description).
fn v1_to_v2(project: &mut Map<String, Value>) {
    for (key, prefix, rename) in [("characterBible", "c", true), ("locationBible", "l", false)] {
        let Some(Value::Array(entries)) = project.get_mut(key) else { continue };
        for (index, entry) in entries.iter_mut().enumerate() {
            let Value::Object(entry) = entry else { continue };
            entry.entry("id").or_insert_with(|| Value::from(format!("{prefix}{}", index + 1)));
            if rename {
                if let Some(description) = entry.remove("description") {
                    entry.entry("appearance").or_insert(description);
                }
            }
        }
    }
}

/// Version 3 renamed the style `pixar_inspired_3d` to `animated_film_3d` (no brand names in the app).
fn v2_to_v3(project: &mut Map<String, Value>) {
    if project.get("styleId").and_then(Value::as_str) == Some("pixar_inspired_3d") {
        project.insert("styleId".into(), Value::from("animated_film_3d"));
    }
}

/// Upgrades `value` to the current version. Returns it with the version it started at.
pub fn migrate(value: Value) -> Result<(Value, u32), MigrateError> {
    run(value, STEPS, SCHEMA_VERSION)
}

fn run(value: Value, steps: &[Step], current: u32) -> Result<(Value, u32), MigrateError> {
    let Value::Object(mut project) = value else {
        return Err(MigrateError::NotAnObject);
    };
    let found = project.get("schemaVersion").and_then(Value::as_u64).unwrap_or(0);
    if found > u64::from(current) {
        return Err(MigrateError::TooNew(found));
    }
    let started_at = u32::try_from(found).unwrap_or(current);
    for step in &steps[started_at as usize..current as usize] {
        step(&mut project);
    }
    project.insert("schemaVersion".to_string(), Value::from(current));
    Ok((Value::Object(project), started_at))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::model::Project;
    use serde_json::json;

    #[test]
    fn there_is_one_step_for_every_version() {
        assert_eq!(STEPS.len(), SCHEMA_VERSION as usize);
    }

    #[test]
    fn a_file_without_a_version_is_upgraded() {
        let (value, from) = migrate(json!({ "id": "prj_1", "name": "Old" })).unwrap();
        assert_eq!(from, 0);
        assert_eq!(value["schemaVersion"], SCHEMA_VERSION);
        let project: Project = serde_json::from_value(value).unwrap();
        assert_eq!(project.name, "Old");
    }

    #[test]
    fn version_one_bibles_get_ids_and_the_new_field_names() {
        let old = json!({
            "schemaVersion": 1,
            "characterBible": [{ "name": "Anna", "description": "a tall woman" }],
            "locationBible": [{ "name": "Farm", "description": "a red barn" }]
        });
        let (value, from) = migrate(old).unwrap();
        assert_eq!(from, 1);
        assert_eq!(value["schemaVersion"], SCHEMA_VERSION);
        assert_eq!(value["characterBible"][0], json!({ "id": "c1", "name": "Anna", "appearance": "a tall woman" }));
        assert_eq!(value["locationBible"][0], json!({ "id": "l1", "name": "Farm", "description": "a red barn" }));
        let project: Project = serde_json::from_value(value).unwrap();
        assert_eq!(project.character_bible[0].appearance, "a tall woman");
    }

    #[test]
    fn the_renamed_3d_style_is_mapped_to_its_new_id() {
        let (value, from) = migrate(json!({ "schemaVersion": 2, "styleId": "pixar_inspired_3d" })).unwrap();
        assert_eq!((from, value["styleId"].as_str()), (2, Some("animated_film_3d")));
        let (other, _) = migrate(json!({ "schemaVersion": 2, "styleId": "anime" })).unwrap();
        assert_eq!(other["styleId"], "anime");
    }

    #[test]
    fn a_current_file_is_left_alone() {
        let input = json!({ "schemaVersion": SCHEMA_VERSION, "name": "Now" });
        let (value, from) = migrate(input.clone()).unwrap();
        assert_eq!(from, SCHEMA_VERSION);
        assert_eq!(value, input);
    }

    #[test]
    fn a_file_from_a_newer_app_is_refused() {
        assert_eq!(migrate(json!({ "schemaVersion": SCHEMA_VERSION + 1 })), Err(MigrateError::TooNew(u64::from(SCHEMA_VERSION) + 1)));
    }

    #[test]
    fn something_that_is_not_a_project_is_refused() {
        assert_eq!(migrate(json!([1, 2])), Err(MigrateError::NotAnObject));
    }

    fn rename_title(project: &mut Map<String, Value>) {
        if let Some(title) = project.remove("title") {
            project.insert("name".into(), title);
        }
    }

    fn add_flag(project: &mut Map<String, Value>) {
        project.insert("flag".into(), Value::Bool(true));
    }

    #[test]
    fn steps_run_in_order_from_the_file_version() {
        let steps: &[Step] = &[v0_to_v1, rename_title, add_flag];
        let (value, from) = run(json!({ "title": "X" }), steps, 3).unwrap();
        assert_eq!(from, 0);
        assert_eq!(value, json!({ "name": "X", "flag": true, "schemaVersion": 3 }));

        let (value, from) = run(json!({ "schemaVersion": 2, "title": "X" }), steps, 3).unwrap();
        assert_eq!(from, 2);
        assert_eq!(value, json!({ "title": "X", "flag": true, "schemaVersion": 3 }));
    }
}
