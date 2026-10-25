use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};

use crate::commands::blocking::run_blocking;
use crate::commands::captions::fonts_folder;
use crate::commands::error::AppError;
use crate::commands::projects::project_folder;
use crate::commands::sfx::sfx_folder;
use crate::jobs::{event_sink, JobRegistry};
use crate::render::encoder::{self, EncoderInfo};
use crate::render::model::{RenderRequest, RenderResult};
use crate::render::pipeline::{render, RenderEnv};
use crate::settings;

/// The video encoders that work on this computer, best first (checked once, at startup).
#[tauri::command]
pub async fn list_encoders() -> Result<Vec<EncoderInfo>, AppError> {
    Ok(encoder::available().await.to_vec())
}

/// Renders the finished MP4 into the project's exports folder (and the person's export folder, if set).
#[tauri::command]
pub async fn render_video(app: AppHandle, jobs: State<'_, JobRegistry>, project_id: String, request: RenderRequest, job_id: String) -> Result<RenderResult, AppError> {
    let project_dir = project_folder(&app, &project_id)?;
    let saved = settings::load(&app)?;
    let export_folder = Some(saved.export_folder.trim()).filter(|f| !f.is_empty()).map(PathBuf::from);
    let env = RenderEnv { project_dir, fonts_dir: fonts_folder(&app), sfx_dir: sfx_folder(&app), export_folder, force_cpu: saved.force_cpu_encoding };
    crate::logging::info("render", &format!("Render started: {} scenes, {}x{} at {} fps", request.scenes.len(), request.width, request.height, request.fps));
    crate::logging::debug("render", &format!("project {project_id}, {} captions lines", request.captions.as_ref().map_or(0, |c| c.lines.len())));
    let job = jobs.begin(&job_id, "render", event_sink(app))?;
    let result = render(&job, &env, &request).await;
    if let Ok(done) = &result {
        crate::logging::info("render", &format!("Render finished: {:.1} s of video, {} bytes, encoder {}, took {:.0} s", done.duration, done.size_bytes, done.encoder, done.seconds_taken));
        for warning in &done.warnings {
            crate::logging::warn("render", warning);
        }
    }
    result
}

/// Opens the folder that holds a finished video. Only the project's exports and the export folder can be opened.
#[tauri::command]
pub async fn show_in_folder(app: AppHandle, project_id: String, path: String) -> Result<(), AppError> {
    let project_dir = project_folder(&app, &project_id)?;
    let saved = settings::load(&app)?;
    run_blocking(move || {
        let target = Path::new(&path).canonicalize().map_err(|e| AppError::new("That file could not be found.", format!("{e} ({path})")))?;
        let allowed = [Some(project_dir), Some(saved.export_folder.trim()).filter(|f| !f.is_empty()).map(PathBuf::from)];
        let inside = allowed.iter().flatten().filter_map(|p| p.canonicalize().ok()).any(|root| target.starts_with(root));
        if !inside {
            return Err(AppError::new("Only your project and export folders can be opened here.", format!("Refused: {}", target.display())));
        }
        open_folder(&target).map_err(|e| AppError::new("The folder could not be opened.", format!("{e} ({})", target.display())))
    })
    .await
}

fn open_folder(file: &Path) -> std::io::Result<()> {
    let folder = file.parent().unwrap_or(file);
    #[cfg(target_os = "windows")]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("explorer");
        // `explorer /select,<file>` opens the folder with the video highlighted.
        c.arg(format!("/select,{}", file.display()));
        c.creation_flags(0x0800_0000);
        c
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = std::process::Command::new("open");
        c.arg(folder);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(folder);
        c
    };
    let _ = folder;
    command.spawn().map(|_| ())
}

/// The newest finished video in a project's exports folder, if there is one.
#[tauri::command]
pub async fn latest_video(app: AppHandle, project_id: String) -> Result<Option<String>, AppError> {
    let exports = project_folder(&app, &project_id)?.join("exports");
    run_blocking(move || Ok(newest_mp4(&exports).map(|p| p.display().to_string()))).await
}

fn newest_mp4(folder: &Path) -> Option<PathBuf> {
    std::fs::read_dir(folder)
        .ok()?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|e| e.eq_ignore_ascii_case("mp4")))
        .filter_map(|path| std::fs::metadata(&path).and_then(|m| m.modified()).ok().map(|time| (time, path)))
        .max_by_key(|(time, _)| *time)
        .map(|(_, path)| path)
}

/// Plays a finished video in the computer's own video player. Only files inside the project or export folder.
#[tauri::command]
pub async fn play_video(app: AppHandle, project_id: String, path: String) -> Result<(), AppError> {
    let project_dir = project_folder(&app, &project_id)?;
    let saved = settings::load(&app)?;
    run_blocking(move || {
        let target = Path::new(&path).canonicalize().map_err(|e| AppError::new("That file could not be found.", format!("{e} ({path})")))?;
        let allowed = [Some(project_dir), Some(saved.export_folder.trim()).filter(|f| !f.is_empty()).map(PathBuf::from)];
        if !allowed.iter().flatten().filter_map(|p| p.canonicalize().ok()).any(|root| target.starts_with(root)) {
            return Err(AppError::new("Only videos in your project and export folders can be played here.", format!("Refused: {}", target.display())));
        }
        open_with_default(&target).map_err(|e| AppError::new("The video could not be played.", format!("{e} ({})", target.display())))
    })
    .await
}

/// Opens the project's own folder.
#[tauri::command]
pub async fn open_project_folder(app: AppHandle, project_id: String) -> Result<(), AppError> {
    let folder = project_folder(&app, &project_id)?;
    run_blocking(move || open_with_default(&folder).map_err(|e| AppError::new("The folder could not be opened.", format!("{e} ({})", folder.display())))).await
}

fn open_with_default(target: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("explorer");
        c.arg(target);
        c.creation_flags(0x0800_0000);
        c
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = std::process::Command::new("open");
        c.arg(target);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(target);
        c
    };
    command.spawn().map(|_| ())
}

#[cfg(test)]
mod newest_tests {
    use super::newest_mp4;

    #[test]
    fn the_newest_mp4_is_found_and_other_files_are_ignored() {
        let dir = std::env::temp_dir().join(format!("av-newest-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(newest_mp4(&dir).is_none());
        std::fs::write(dir.join("a.mp4"), b"1").unwrap();
        std::fs::write(dir.join("notes.txt"), b"2").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(30));
        std::fs::write(dir.join("b.MP4"), b"3").unwrap();
        assert_eq!(newest_mp4(&dir).unwrap().file_name().unwrap(), "b.MP4");
        assert!(newest_mp4(&dir.join("missing")).is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
