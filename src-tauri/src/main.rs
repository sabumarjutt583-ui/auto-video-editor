// Hides the extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(feature = "admin")]
mod admin;
mod api;
mod audio;
mod captions;
mod clock;
mod commands;
mod custom_style;
mod ffmpeg;
mod ffmpeg_job;
mod graphics;
mod imagegen;
mod jobs;
mod keys;
mod library;
mod logging;
mod media;
mod motion;
mod probe;
mod project;
mod render;
mod settings;
#[cfg(test)]
mod smoke_test;
mod sfx;
mod styles;
mod thumbnails;
mod timing;
mod tts;

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
            commands::quick::quick_open,
            commands::quick::quick_reset,
            commands::quick::quick_save_as_project,
            commands::audio::import_voice,
            commands::audio::swap_voice_files,
            commands::audio::get_waveform,
            commands::audio::project_file_path,
            commands::audio::preview_silence,
            commands::ai::generate_text,
            commands::tts::tts_options,
            commands::tts::tts_preview,
            commands::tts::tts_generate,
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
            commands::placement::placement_ask,
            commands::styles::list_styles,
            commands::styles::save_custom_style,
            commands::styles::delete_custom_style,
            commands::styles::set_custom_style_thumbnail,
            commands::custom_style::prepare_style_image,
            commands::custom_style::analyze_style,
            commands::custom_style::save_style_with_refs,
            commands::custom_style::load_style_refs,
            commands::custom_style::duplicate_custom_style,
            commands::custom_style::export_style_package,
            commands::custom_style::import_style_package,
            commands::timing::read_text_file,
            commands::timing::transcribe_voice,
            commands::audio::apply_silence_removal,
            commands::audio::skip_silence_removal,
            commands::audio::cancel_job,
            commands::render::list_encoders,
            commands::render::render_video,
            commands::render::show_in_folder,
            commands::render::latest_video,
            commands::render::play_video,
            commands::render::open_project_folder,
            commands::imagegen::imagegen_state,
            commands::imagegen::imagegen_set_settings,
            commands::imagegen::imagegen_accept_consent,
            commands::imagegen::imagegen_detect_browser,
            commands::imagegen::imagegen_add_account,
            commands::imagegen::imagegen_update_account,
            commands::imagegen::imagegen_remove_account,
            commands::imagegen::imagegen_sign_in,
            commands::imagegen::imagegen_finish_sign_in,
            commands::imagegen::imagegen_verify,
            commands::imagegen::imagegen_test_image,
            commands::imagegen::imagegen_chat_ask,
            commands::script::script_status,
            commands::script::script_accept_consent,
            commands::script::script_sign_in,
            commands::script::script_confirm_signed_in,
            commands::script::script_check,
            commands::script::script_disconnect,
            commands::script::script_ask,
            commands::imagegen::imagegen_chat_thread,
            commands::imagegen::imagegen_make_video,
            commands::imagegen::imagegen_video_status,
            commands::imagegen::imagegen_delete_images,
            commands::motion::motion_generate,
            commands::graphics::graphic_export_start,
            commands::graphics::graphic_export_frame,
            commands::graphics::graphic_export_finish,
            commands::graphics::graphic_export_abort,
            commands::graphics::graphic_cache_restore,
            commands::graphics::graphic_cache_store,
            commands::graphics::graphic_cache_info,
            commands::graphics::graphic_cache_clear,
            commands::imagegen::imagegen_background_snapshot,
            commands::imagegen::imagegen_show_browser,
            commands::imagegen::imagegen_start,
            commands::imagegen::imagegen_start_folder,
            commands::imagegen::imagegen_preview,
            commands::imagegen::imagegen_pause,
            commands::imagegen::imagegen_resume,
            commands::imagegen::imagegen_retry_failed,
            commands::imagegen::imagegen_remove_jobs,
            commands::imagegen::imagegen_reload_config,
            commands::imagegen::imagegen_media_info,
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
            commands::quick::quick_open,
            commands::quick::quick_reset,
            commands::quick::quick_save_as_project,
            commands::audio::import_voice,
            commands::audio::swap_voice_files,
            commands::audio::get_waveform,
            commands::audio::project_file_path,
            commands::audio::preview_silence,
            commands::ai::generate_text,
            commands::tts::tts_options,
            commands::tts::tts_preview,
            commands::tts::tts_generate,
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
            commands::placement::placement_ask,
            commands::styles::list_styles,
            commands::styles::save_custom_style,
            commands::styles::delete_custom_style,
            commands::styles::set_custom_style_thumbnail,
            commands::custom_style::prepare_style_image,
            commands::custom_style::analyze_style,
            commands::custom_style::save_style_with_refs,
            commands::custom_style::load_style_refs,
            commands::custom_style::duplicate_custom_style,
            commands::custom_style::export_style_package,
            commands::custom_style::import_style_package,
            commands::timing::read_text_file,
            commands::timing::transcribe_voice,
            commands::audio::apply_silence_removal,
            commands::audio::skip_silence_removal,
            commands::audio::cancel_job,
            commands::render::list_encoders,
            commands::render::render_video,
            commands::render::show_in_folder,
            commands::render::latest_video,
            commands::render::play_video,
            commands::render::open_project_folder,
            commands::imagegen::imagegen_state,
            commands::imagegen::imagegen_set_settings,
            commands::imagegen::imagegen_accept_consent,
            commands::imagegen::imagegen_detect_browser,
            commands::imagegen::imagegen_add_account,
            commands::imagegen::imagegen_update_account,
            commands::imagegen::imagegen_remove_account,
            commands::imagegen::imagegen_sign_in,
            commands::imagegen::imagegen_finish_sign_in,
            commands::imagegen::imagegen_verify,
            commands::imagegen::imagegen_test_image,
            commands::imagegen::imagegen_chat_ask,
            commands::script::script_status,
            commands::script::script_accept_consent,
            commands::script::script_sign_in,
            commands::script::script_confirm_signed_in,
            commands::script::script_check,
            commands::script::script_disconnect,
            commands::script::script_ask,
            commands::imagegen::imagegen_chat_thread,
            commands::imagegen::imagegen_make_video,
            commands::imagegen::imagegen_video_status,
            commands::imagegen::imagegen_delete_images,
            commands::motion::motion_generate,
            commands::graphics::graphic_export_start,
            commands::graphics::graphic_export_frame,
            commands::graphics::graphic_export_finish,
            commands::graphics::graphic_export_abort,
            commands::graphics::graphic_cache_restore,
            commands::graphics::graphic_cache_store,
            commands::graphics::graphic_cache_info,
            commands::graphics::graphic_cache_clear,
            commands::imagegen::imagegen_background_snapshot,
            commands::imagegen::imagegen_show_browser,
            commands::imagegen::imagegen_start,
            commands::imagegen::imagegen_start_folder,
            commands::imagegen::imagegen_preview,
            commands::imagegen::imagegen_pause,
            commands::imagegen::imagegen_resume,
            commands::imagegen::imagegen_retry_failed,
            commands::imagegen::imagegen_remove_jobs,
            commands::imagegen::imagegen_reload_config,
            commands::imagegen::imagegen_media_info,
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
            admin::commands::admin_read_engine_config,
            admin::commands::admin_save_engine_config,
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
        .manage(graphics::export::GraphicExports::default())
        .manage(commands::app_update::PendingUpdate::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            use tauri::Manager;
            start_logging(app.handle());
            // Find out which encoders work while the app starts, so the first render does not wait.
            tauri::async_runtime::spawn(async {
                let _ = render::encoder::available().await;
            });
            match commands::script::create(app.handle()) {
                Ok(script) => {
                    app.manage(script);
                }
                Err(error) => logging::error("script", &error.details),
            }
            match commands::imagegen::create(app.handle()) {
                Ok(engine) => {
                    engine.start_background();
                    app.manage(engine);
                }
                Err(error) => logging::error("imagegen", &error.details),
            }
            Ok(())
        })
        .invoke_handler(handler!())
        .run(tauri::generate_context!())
        .expect("error while running Auto Video Editor");
}
