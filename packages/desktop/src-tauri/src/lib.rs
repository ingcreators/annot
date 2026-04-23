mod commands;
mod db;
mod http_server;
pub mod jpeg_utils;

use db::Database;
use std::path::PathBuf;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Manager, WindowEvent,
};

pub fn portable_dir() -> PathBuf {
    std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}

fn get_db_path(_app: &tauri::App) -> PathBuf {
    let dir = portable_dir().join("data");
    std::fs::create_dir_all(&dir).ok();
    dir.join("annot.db")
}

#[tauri::command]
async fn minimize_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.minimize().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn restore_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.unminimize().map_err(|e| e.to_string())?;
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Database
            let db_path = get_db_path(app);
            let database = Database::new(&db_path).expect("failed to initialize database");
            app.manage(database);

            // Capture state for overlay communication
            app.manage(commands::screen_capture::CaptureState::new());

            // Start local HTTP server for Chrome extension
            http_server::start(app.handle().clone());

            // System tray
            let show = MenuItemBuilder::with_id("show", "Show SVGShot").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;

            let icon = app.default_window_icon().cloned().unwrap();

            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("SVGShot")
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { button, .. } = event {
                        if button == tauri::tray::MouseButton::Left {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                window.show().ok();
                                window.set_focus().ok();
                            }
                        }
                    }
                })
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                window.show().ok();
                                window.set_focus().ok();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Minimize to tray on close instead of quitting
            if let WindowEvent::CloseRequested { api, .. } = event {
                window.hide().ok();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::capture::save_screenshot,
            commands::capture::load_screenshot,
            commands::capture::check_incoming,
            commands::projects::list_projects,
            commands::projects::create_project,
            commands::projects::delete_project,
            commands::images::list_images,
            commands::images::update_image,
            commands::images::delete_image,
            commands::clipboard::copy_as_office,
            commands::screen_capture::capture_screen,
            commands::screen_capture::list_windows,
            commands::screen_capture::capture_window,
            commands::screen_capture::capture_region,
            commands::screen_capture::start_capture_overlay,
            commands::screen_capture::get_capture_params,
            commands::screen_capture::capture_overlay_result,
            commands::settings::load_tool_presets,
            commands::settings::save_tool_presets,
            commands::settings::get_portable_dir,
            commands::xmp::save_with_xmp,
            commands::xmp::read_xmp,
            minimize_main_window,
            restore_main_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
