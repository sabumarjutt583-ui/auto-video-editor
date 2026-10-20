// Hides the extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(feature = "admin")]
mod admin;
mod api;
mod audio;
mod captions;
mod clock;
mod commands;
mod ffmpeg;
mod ffmpeg_job;
mod jobs;
mod keys;
mod library;
mod logging;
mod media;
mod project;
mod render;
mod settings;
mod sfx;
mod styles;
mod thumbnails;
mod timing;

/// Every command of the app. The Admin Edition has the same list plus its own commands.
#[cfg(not(feature = "admin"))]
macro_rules! handler {
    () => {
        tauri::generate_handler![
            commands::engine::check_ffmpeg,
            commands::keys::save_key,
            commands::keys::get_key_status,
            commands::keys::delete_key,
            commands::keys::test_key,
            commands::settings::load_settings,
            commands::settings::save_settings,
            commands::links::open_external_link,
            commands::projects::create_project,
            commands::projects::list_projects,
            commands::projects::open_project,
            commands::projects::save_project,
            commands::projects::rename_project,
            commands::projects::delete_project,
            commands::projects::duplicate_project,
            commands::audio::import_voice,
            commands::audio::get_waveform,
            commands::audio::project_file_path,
            commands::audio::preview_silence,
            commands::ai::generate_text,
            commands::files::write_text_file,
            commands::captions::fonts_dir,
            commands::sfx::list_sfx,
            commands::logs::export_logs,
            commands::logs::log_frontend_error,
            commands::app_update::check_app_update,
            commands::app_update::install_app_update,
            commands::library::library_status,
            commands::library::update_libraries,
            commands::library::rollback_library,
            commands::music::import_music,
            commands::music::remove_music,
            commands::mix::build_audio_mix,
            commands::captions::generate_ass,
            commands::media::scan_media,
            commands::media::project_dir_path,
            commands::media::import_media,
            commands::media::make_thumbnails,
            commands::media::check_media,
            commands::media::remove_media,
            commands::media::match_media_with_gemini,
            commands::styles::list_styles,
            commands::styles::save_custom_style,
            commands::styles::delete_custom_style,
            commands::styles::set_custom_style_thumbnail,
            commands::timing::read_text_file,
            commands::timing::transcribe_voice,
            commands::audio::apply_silence_removal,
            commands::audio::skip_silence_removal,
            commands::audio::cancel_job,
            commands::render::list_encoders,
            commands::render::render_video,
            commands::render::show_in_folder,
        ]
    };
}

#[cfg(feature = "admin")]
macro_rules! handler {
    () => {
        tauri::generate_handler![
            commands::engine::check_ffmpeg,
            commands::keys::save_key,
            commands::keys::get_key_status,
            commands::keys::delete_key,
            commands::keys::test_key,
            commands::settings::load_settings,
            commands::settings::save_settings,
            commands::links::open_external_link,
            commands::projects::create_project,
            commands::projects::list_projects,
            commands::projects::open_project,
            commands::projects::save_project,
            commands::projects::rename_project,
            commands::projects::delete_project,
            commands::projects::duplicate_project,
            commands::audio::import_voice,
            commands::audio::get_waveform,
            commands::audio::project_file_path,
            commands::audio::preview_silence,
            commands::ai::generate_text,
            commands::files::write_text_file,
            commands::captions::fonts_dir,
            commands::sfx::list_sfx,
            commands::logs::export_logs,
            commands::logs::log_frontend_error,
            commands::app_update::check_app_update,
            commands::app_update::install_app_update,
            commands::library::library_status,
            commands::library::update_libraries,
            commands::library::rollback_library,
            commands::music::import_music,
            commands::music::remove_music,
            commands::mix::build_audio_mix,
            commands::captions::generate_ass,
            commands::media::scan_media,
            commands::media::project_dir_path,
            commands::media::import_media,
            commands::media::make_thumbnails,
            commands::media::check_media,
            commands::media::remove_media,
            commands::media::match_media_with_gemini,
            commands::styles::list_styles,
            commands::styles::save_custom_style,
            commands::styles::delete_custom_style,
            commands::styles::set_custom_style_thumbnail,
            commands::timing::read_text_file,
            commands::timing::transcribe_voice,
            commands::audio::apply_silence_removal,
            commands::audio::skip_silence_removal,
            commands::audio::cancel_job,
            commands::render::list_encoders,
            commands::render::render_video,
            commands::render::show_in_folder,
            admin::commands::admin_overview,
            admin::commands::admin_save_key,
            admin::commands::admin_delete_key,
            admin::commands::admin_search,
            admin::commands::admin_add_sound,
            admin::commands::admin_update_sound,
            admin::commands::admin_remove_sound,
            admin::commands::admin_import_current,
            admin::commands::admin_save_style,
            admin::commands::admin_read_style,
            admin::commands::admin_remove_style,
            admin::commands::admin_build_package,
            admin::commands::admin_import_thumbnails,
        ]
    };
}

/// Log files live in the app data folder. A crash (panic) is written there, too.
fn start_logging(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Ok(folder) = app.path().app_data_dir() {
        logging::init(folder.join("logs"));
    }
    if let Ok(saved) = settings::load(app) {
        logging::set_debug(saved.debug_logging);
    }
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        logging::error("panic", &info.to_string());
        previous(info);
    }));
}

fn main() {
    tauri::Builder::default()
        .manage(jobs::JobRegistry::default())
        .manage(commands::app_update::PendingUpdate::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            start_logging(app.handle());
            // Find out which encoders work while the app starts, so the first render does not wait.
            tauri::async_runtime::spawn(async {
                let _ = render::encoder::available().await;
            });
            Ok(())
        })
        .invoke_handler(handler!())
        .run(tauri::generate_context!())
        .expect("error while running Auto Video Editor");
}
