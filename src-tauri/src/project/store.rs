//! Reading and writing project folders.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::migrate::{migrate, MigrateError};
use super::model::{Project, ProjectSettings, ProjectSummary, SCHEMA_VERSION};
use super::stamp::{is_valid_id, new_id, now_iso};
use crate::commands::error::AppError;

const PROJECT_FILE: &str = "project.json";
const SUB_FOLDERS: [&str; 3] = ["audio", "media", "exports"];
const MAX_NAME_LENGTH: usize = 100;
const COPY_SUFFIX: &str = " (copy)";

/// A project folder that could not be read (damaged file, newer app version, ...).
#[derive(Debug, Serialize)]
pub struct UnreadableProject {
    pub id: String,
    pub message: String,
    pub details: String,
}

#[derive(Debug, Serialize)]
pub struct ProjectList {
    pub projects: Vec<ProjectSummary>,
    pub unreadable: Vec<UnreadableProject>,
}

pub struct ProjectStore {
    root: PathBuf,
}

fn io_error(message: &str, error: &std::io::Error, path: &Path) -> AppError {
    AppError::new(message, format!("{error} ({})", path.display()))
}

/// Trims the name and checks it is something we can show and store.
fn clean_name(raw: &str) -> Result<String, AppError> {
    let name = raw.trim();
    if name.is_empty() {
        return Err(AppError::new("Please type a name for the project.", "The project name was empty."));
    }
    if name.chars().count() > MAX_NAME_LENGTH {
        return Err(AppError::new(
            format!("Please use a shorter name (up to {MAX_NAME_LENGTH} letters)."),
            "The project name was too long.",
        ));
    }
    if name.chars().any(char::is_control) {
        return Err(AppError::new(
            "The project name has a character that is not allowed.",
            "The project name contained a control character.",
        ));
    }
    Ok(name.to_string())
}

/// Writes JSON safely: to a temporary file first, then renamed into place.
fn write_json(path: &Path, project: &Project) -> Result<(), AppError> {
    let json = serde_json::to_string_pretty(project)
        .map_err(|e| AppError::new("The project could not be prepared for saving.", e.to_string()))?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, json).map_err(|e| io_error("The project could not be saved.", &e, &temporary))?;
    fs::rename(&temporary, path).map_err(|e| io_error("The project could not be saved.", &e, path))
}

/// Reads and upgrades one project folder. An old file is backed up, then rewritten as the
/// current version. If that rewrite fails the project still opens.
fn read_project(folder: &Path) -> Result<Project, AppError> {
    let file = folder.join(PROJECT_FILE);
    let text = fs::read_to_string(&file).map_err(|e| {
        if e.kind() == ErrorKind::NotFound {
            AppError::new("This project could not be found. It may have been deleted.", format!("{} is missing", file.display()))
        } else {
            io_error("The project file could not be read.", &e, &file)
        }
    })?;

    let damaged = |details: String| {
        AppError::new("This project file looks damaged and could not be opened.", format!("{details} ({})", file.display()))
    };
    let value = serde_json::from_str(&text).map_err(|e| damaged(e.to_string()))?;
    let (value, from_version) = migrate(value).map_err(|e| match e {
        MigrateError::TooNew(found) => AppError::new(
            "This project was made with a newer version of Auto Video Editor. Please update the app to open it.",
            format!("Project file version is {found}, this app understands up to {SCHEMA_VERSION}."),
        ),
        MigrateError::NotAnObject => damaged("The file is not a project.".to_string()),
    })?;
    let mut project: Project = serde_json::from_value(value).map_err(|e| damaged(e.to_string()))?;

    // The folder name is the real id; a copied-in file with a different id must not confuse the app.
    if let Some(folder_id) = folder.file_name().and_then(|name| name.to_str()) {
        project.id = folder_id.to_string();
    }

    if from_version < SCHEMA_VERSION {
        let backup = folder.join(format!("project.backup-v{from_version}.json"));
        if fs::copy(&file, &backup).is_ok() {
            let _ = write_json(&file, &project);
        }
    }
    Ok(project)
}

fn copy_folder(from: &Path, to: &Path, skip_top_level: &[&str]) -> Result<(), AppError> {
    fs::create_dir_all(to).map_err(|e| io_error("The project could not be copied.", &e, to))?;
    let entries = fs::read_dir(from).map_err(|e| io_error("The project could not be copied.", &e, from))?;
    for entry in entries {
        let entry = entry.map_err(|e| io_error("The project could not be copied.", &e, from))?;
        let name = entry.file_name();
        if name.to_str().is_some_and(|n| skip_top_level.contains(&n)) {
            continue;
        }
        let target = to.join(&name);
        // `file_type` does not follow links, so links are skipped rather than followed.
        let kind = entry.file_type().map_err(|e| io_error("The project could not be copied.", &e, &entry.path()))?;
        if kind.is_dir() {
            copy_folder(&entry.path(), &target, &[])?;
        } else if kind.is_file() {
            fs::copy(entry.path(), &target).map_err(|e| io_error("The project could not be copied.", &e, &entry.path()))?;
        }
    }
    Ok(())
}

impl ProjectStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn folder(&self, id: &str) -> Result<PathBuf, AppError> {
        if !is_valid_id(id) {
            return Err(AppError::new("That project could not be found.", format!("Not a valid project id: {id:?}")));
        }
        Ok(self.root.join(id))
    }

    /// Makes a new, empty project folder. Removes it again if anything goes wrong.
    fn make_folder(&self) -> Result<(String, PathBuf), AppError> {
        fs::create_dir_all(&self.root)
            .map_err(|e| io_error("The projects folder could not be created.", &e, &self.root))?;
        for _ in 0..5 {
            let id = new_id();
            let folder = self.root.join(&id);
            match fs::create_dir(&folder) {
                Ok(()) => return Ok((id, folder)),
                Err(e) if e.kind() == ErrorKind::AlreadyExists => {}
                Err(e) => return Err(io_error("The project folder could not be created.", &e, &folder)),
            }
        }
        Err(AppError::new("A new project could not be created. Please try again.", "Could not find a free project id."))
    }

    pub fn create(&self, name: &str, settings: ProjectSettings) -> Result<Project, AppError> {
        let name = clean_name(name)?;
        let (id, folder) = self.make_folder()?;
        let project = Project::new(id, name, now_iso(), settings);
        let result = SUB_FOLDERS
            .iter()
            .try_for_each(|sub| {
                let path = folder.join(sub);
                fs::create_dir(&path).map_err(|e| io_error("The project folder could not be set up.", &e, &path))
            })
            .and_then(|()| write_json(&folder.join(PROJECT_FILE), &project));
        if let Err(error) = result {
            let _ = fs::remove_dir_all(&folder);
            return Err(error);
        }
        Ok(project)
    }

    /// Every project, newest first. A damaged project does not hide the others.
    pub fn list(&self) -> Result<ProjectList, AppError> {
        let mut list = ProjectList { projects: Vec::new(), unreadable: Vec::new() };
        let entries = match fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(list),
            Err(e) => return Err(io_error("The projects could not be listed.", &e, &self.root)),
        };
        for entry in entries.flatten() {
            let Some(id) = entry.file_name().to_str().map(str::to_string) else { continue };
            if !is_valid_id(&id) || !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                continue;
            }
            match read_project(&entry.path()) {
                Ok(project) => list.projects.push(ProjectSummary::from(&project)),
                Err(error) => list.unreadable.push(UnreadableProject { id, message: error.message, details: error.details }),
            }
        }
        list.projects.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        list.unreadable.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(list)
    }

    pub fn open(&self, id: &str) -> Result<Project, AppError> {
        read_project(&self.folder(id)?)
    }

    /// Saves the project and returns the new `updatedAt`. A project that was deleted is not
    /// brought back by a late autosave.
    pub fn save(&self, mut project: Project) -> Result<String, AppError> {
        let folder = self.folder(&project.id)?;
        if !folder.is_dir() {
            return Err(AppError::new(
                "This project no longer exists, so it could not be saved.",
                format!("{} is missing", folder.display()),
            ));
        }
        project.name = clean_name(&project.name)?;
        project.schema_version = SCHEMA_VERSION;
        project.updated_at = now_iso();
        write_json(&folder.join(PROJECT_FILE), &project)?;
        Ok(project.updated_at)
    }

    pub fn rename(&self, id: &str, name: &str) -> Result<ProjectSummary, AppError> {
        let name = clean_name(name)?;
        let mut project = self.open(id)?;
        project.name = name;
        self.save(project.clone())?;
        // Re-read so the summary has the new updatedAt.
        Ok(ProjectSummary::from(&self.open(id)?))
    }

    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let folder = self.folder(id)?;
        match fs::remove_dir_all(&folder) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
            Err(e) => Err(io_error("The project could not be deleted.", &e, &folder)),
        }
    }

    /// Copies a project (voice-over and media included, exported videos not) under a new id.
    pub fn duplicate(&self, id: &str) -> Result<ProjectSummary, AppError> {
        let source = self.open(id)?;
        let (new_id, folder) = self.make_folder()?;

        let kept = source.name.chars().take(MAX_NAME_LENGTH - COPY_SUFFIX.len()).collect::<String>();
        let now = now_iso();
        let mut copy = source;
        copy.id = new_id;
        copy.name = format!("{kept}{COPY_SUFFIX}");
        copy.created_at = now.clone();
        copy.updated_at = now;
        copy.rendered_at = None;

        let result = copy_folder(&self.folder(id)?, &folder, &["exports", PROJECT_FILE])
            .and_then(|()| {
                let exports = folder.join("exports");
                fs::create_dir_all(&exports).map_err(|e| io_error("The project could not be copied.", &e, &exports))
            })
            .and_then(|()| write_json(&folder.join(PROJECT_FILE), &copy));
        if let Err(error) = result {
            let _ = fs::remove_dir_all(&folder);
            return Err(error);
        }
        Ok(ProjectSummary::from(&copy))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::model::Scene;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn store(name: &str) -> ProjectStore {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("ave-projects-{name}-{}-{nanos}", std::process::id()));
        ProjectStore::new(root)
    }

    fn cleanup(store: &ProjectStore) {
        let _ = fs::remove_dir_all(&store.root);
    }

    #[test]
    fn creating_makes_the_folders_and_file() {
        let store = store("create");
        let project = store.create("  My first video ", ProjectSettings::default()).unwrap();
        assert_eq!(project.name, "My first video");
        let folder = store.root.join(&project.id);
        for sub in SUB_FOLDERS {
            assert!(folder.join(sub).is_dir(), "{sub} folder is missing");
        }
        let json: serde_json::Value = serde_json::from_str(&fs::read_to_string(folder.join(PROJECT_FILE)).unwrap()).unwrap();
        assert_eq!(json["schemaVersion"], SCHEMA_VERSION);
        assert_eq!(json["name"], "My first video");
        cleanup(&store);
    }

    #[test]
    fn names_are_checked() {
        let store = store("names");
        for bad in ["", "   ", "a\nb"] {
            assert!(store.create(bad, ProjectSettings::default()).is_err(), "{bad:?} should be refused");
        }
        assert!(store.create(&"x".repeat(101), ProjectSettings::default()).is_err());
        assert!(store.create("한국어 이야기 🎬", ProjectSettings::default()).is_ok());
        cleanup(&store);
    }

    #[test]
    fn listing_finds_every_project_newest_first() {
        let store = store("list");
        assert!(store.list().unwrap().projects.is_empty());
        let first = store.create("First", ProjectSettings::default()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let second = store.create("Second", ProjectSettings::default()).unwrap();
        let list = store.list().unwrap();
        let names: Vec<_> = list.projects.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["Second", "First"]);
        assert_ne!(first.id, second.id);
        assert!(list.unreadable.is_empty());
        cleanup(&store);
    }

    #[test]
    fn saving_keeps_the_data_and_moves_updated_at() {
        let store = store("save");
        let mut project = store.create("Story", ProjectSettings::default()).unwrap();
        let created = project.updated_at.clone();
        std::thread::sleep(std::time::Duration::from_millis(5));
        project.name = "Story (final)".into();
        project.language = "ko".into();
        project.scenes.push(Scene { id: "S01".into(), text: "안녕하세요".into(), ..Scene::default() });
        let updated_at = store.save(project.clone()).unwrap();
        assert!(updated_at > created);

        let reopened = store.open(&project.id).unwrap();
        assert_eq!(reopened.name, "Story (final)");
        assert_eq!(reopened.language, "ko");
        assert_eq!(reopened.scenes[0].text, "안녕하세요");
        assert_eq!(reopened.updated_at, updated_at);
        assert_eq!(reopened.created_at, created);
        cleanup(&store);
    }

    #[test]
    fn a_deleted_project_is_not_brought_back_by_a_late_save() {
        let store = store("late-save");
        let project = store.create("Gone", ProjectSettings::default()).unwrap();
        store.delete(&project.id).unwrap();
        assert!(store.save(project.clone()).is_err());
        assert!(!store.root.join(&project.id).exists());
        assert!(store.delete(&project.id).is_ok(), "deleting twice is fine");
        cleanup(&store);
    }

    #[test]
    fn renaming_changes_only_the_name() {
        let store = store("rename");
        let project = store.create("Old name", ProjectSettings::default()).unwrap();
        let summary = store.rename(&project.id, " New name ").unwrap();
        assert_eq!(summary.name, "New name");
        assert!(store.rename(&project.id, "  ").is_err());
        assert_eq!(store.open(&project.id).unwrap().name, "New name");
        cleanup(&store);
    }

    #[test]
    fn duplicating_copies_media_but_not_exports() {
        let store = store("duplicate");
        let mut project = store.create("Original", ProjectSettings::default()).unwrap();
        project.voice_path = Some("audio/voice.wav".into());
        project.rendered_at = Some("2026-01-01T00:00:00.000Z".into());
        store.save(project.clone()).unwrap();
        let folder = store.root.join(&project.id);
        fs::write(folder.join("audio/voice.wav"), b"voice").unwrap();
        fs::write(folder.join("media/S01_000.0-005.0.png"), b"image").unwrap();
        fs::write(folder.join("exports/final.mp4"), b"video").unwrap();

        let copy = store.duplicate(&project.id).unwrap();
        assert_eq!(copy.name, "Original (copy)");
        assert_ne!(copy.id, project.id);
        assert_eq!(copy.status, None, "a copy has not been rendered");

        let copy_folder = store.root.join(&copy.id);
        assert_eq!(fs::read(copy_folder.join("audio/voice.wav")).unwrap(), b"voice");
        assert!(copy_folder.join("media/S01_000.0-005.0.png").is_file());
        assert!(copy_folder.join("exports").is_dir());
        assert!(!copy_folder.join("exports/final.mp4").exists());
        assert_eq!(store.open(&copy.id).unwrap().voice_path.as_deref(), Some("audio/voice.wav"));
        assert!(folder.join("exports/final.mp4").is_file(), "the original is untouched");
        assert_eq!(store.list().unwrap().projects.len(), 2);
        cleanup(&store);
    }

    #[test]
    fn a_long_name_still_fits_after_duplicating() {
        let store = store("long-copy");
        let project = store.create(&"n".repeat(100), ProjectSettings::default()).unwrap();
        let copy = store.duplicate(&project.id).unwrap();
        assert!(copy.name.chars().count() <= MAX_NAME_LENGTH);
        assert!(copy.name.ends_with(COPY_SUFFIX));
        cleanup(&store);
    }

    #[test]
    fn bad_ids_never_touch_the_disk() {
        let store = store("ids");
        for id in ["..", "../outside", "a/b", ""] {
            assert!(store.open(id).is_err());
            assert!(store.delete(id).is_err());
            assert!(store.duplicate(id).is_err());
        }
        cleanup(&store);
    }

    #[test]
    fn an_old_file_is_upgraded_and_backed_up() {
        let store = store("migrate");
        let project = store.create("Old", ProjectSettings::default()).unwrap();
        let file = store.root.join(&project.id).join(PROJECT_FILE);
        fs::write(&file, r#"{"id":"prj_wrong","name":"Old"}"#).unwrap();

        let opened = store.open(&project.id).unwrap();
        assert_eq!(opened.id, project.id, "the folder name wins over the id in the file");
        assert!(store.root.join(&project.id).join("project.backup-v0.json").is_file());
        let json: serde_json::Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(json["schemaVersion"], SCHEMA_VERSION);
        cleanup(&store);
    }

    #[test]
    fn a_damaged_or_newer_project_is_reported_without_hiding_the_rest() {
        let store = store("damaged");
        let good = store.create("Good", ProjectSettings::default()).unwrap();
        let broken = store.create("Broken", ProjectSettings::default()).unwrap();
        let newer = store.create("Newer", ProjectSettings::default()).unwrap();
        fs::write(store.root.join(&broken.id).join(PROJECT_FILE), "{ not json").unwrap();
        fs::write(store.root.join(&newer.id).join(PROJECT_FILE), format!(r#"{{"schemaVersion":{}}}"#, SCHEMA_VERSION + 1)).unwrap();

        let list = store.list().unwrap();
        assert_eq!(list.projects.len(), 1);
        assert_eq!(list.projects[0].id, good.id);
        assert_eq!(list.unreadable.len(), 2);
        let newer_entry = list.unreadable.iter().find(|u| u.id == newer.id).unwrap();
        assert!(newer_entry.message.contains("newer version"));
        // The damaged file is left exactly as it was, and the project can still be deleted.
        assert_eq!(fs::read_to_string(store.root.join(&broken.id).join(PROJECT_FILE)).unwrap(), "{ not json");
        store.delete(&broken.id).unwrap();
        assert_eq!(store.list().unwrap().unreadable.len(), 1);
        cleanup(&store);
    }
}
