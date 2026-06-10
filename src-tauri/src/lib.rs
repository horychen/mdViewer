use serde::Serialize;
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{DragDropEvent, Emitter, Manager};

type PendingOpenedFiles = Mutex<Vec<String>>;
const MENU_OPEN_FILE_ID: &str = "open-file";
const MENU_RELOAD_FILE_ID: &str = "reload-file";
const MENU_CLOSE_TAB_ID: &str = "close-tab";

#[derive(Debug, Serialize)]
struct MarkdownFile {
    path: String,
    name: String,
    dir: String,
    content: String,
}

#[tauri::command]
fn read_markdown_file(path: String) -> Result<MarkdownFile, String> {
    let requested_path = PathBuf::from(path);
    let content = fs::read_to_string(&requested_path)
        .map_err(|error| format!("Could not read Markdown file: {error}"))?;

    let resolved_path = requested_path
        .canonicalize()
        .unwrap_or_else(|_| requested_path.clone());

    let name = resolved_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Untitled.md")
        .to_string();

    let dir = resolved_path
        .parent()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_string();

    Ok(MarkdownFile {
        path: resolved_path.to_string_lossy().into_owned(),
        name,
        dir,
        content,
    })
}

#[tauri::command]
fn take_pending_opened_files(state: tauri::State<'_, PendingOpenedFiles>) -> Vec<String> {
    let mut pending = state.lock().expect("pending opened files lock poisoned");
    std::mem::take(&mut *pending)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(Vec::<String>::new()))
        .menu(|app_handle| {
            let pkg_info = app_handle.package_info();
            let config = app_handle.config();
            let about_metadata = AboutMetadata {
                name: Some(pkg_info.name.clone()),
                version: Some(pkg_info.version.to_string()),
                copyright: config.bundle.copyright.clone(),
                authors: config.bundle.publisher.clone().map(|publisher| vec![publisher]),
                ..Default::default()
            };

            Menu::with_items(
                app_handle,
                &[
                    #[cfg(target_os = "macos")]
                    &Submenu::with_items(
                        app_handle,
                        pkg_info.name.clone(),
                        true,
                        &[
                            &PredefinedMenuItem::about(
                                app_handle,
                                None,
                                Some(about_metadata),
                            )?,
                            &PredefinedMenuItem::separator(app_handle)?,
                            &PredefinedMenuItem::services(app_handle, None)?,
                            &PredefinedMenuItem::separator(app_handle)?,
                            &PredefinedMenuItem::hide(app_handle, None)?,
                            &PredefinedMenuItem::hide_others(app_handle, None)?,
                            &PredefinedMenuItem::separator(app_handle)?,
                            &PredefinedMenuItem::quit(app_handle, None)?,
                        ],
                    )?,
                    &Submenu::with_items(
                        app_handle,
                        "File",
                        true,
                        &[
                            &MenuItem::with_id(
                                app_handle,
                                MENU_OPEN_FILE_ID,
                                "Open...",
                                true,
                                Some("CmdOrCtrl+O"),
                            )?,
                            &MenuItem::with_id(
                                app_handle,
                                MENU_RELOAD_FILE_ID,
                                "Reload",
                                true,
                                Some("CmdOrCtrl+R"),
                            )?,
                            &MenuItem::with_id(
                                app_handle,
                                MENU_CLOSE_TAB_ID,
                                "Close Tab",
                                true,
                                Some("CmdOrCtrl+W"),
                            )?,
                            &PredefinedMenuItem::separator(app_handle)?,
                            #[cfg(not(target_os = "macos"))]
                            &PredefinedMenuItem::quit(app_handle, None)?,
                        ],
                    )?,
                    &Submenu::with_items(
                        app_handle,
                        "Edit",
                        true,
                        &[
                            &PredefinedMenuItem::undo(app_handle, None)?,
                            &PredefinedMenuItem::redo(app_handle, None)?,
                            &PredefinedMenuItem::separator(app_handle)?,
                            &PredefinedMenuItem::cut(app_handle, None)?,
                            &PredefinedMenuItem::copy(app_handle, None)?,
                            &PredefinedMenuItem::paste(app_handle, None)?,
                            &PredefinedMenuItem::select_all(app_handle, None)?,
                        ],
                    )?,
                    #[cfg(target_os = "macos")]
                    &Submenu::with_items(
                        app_handle,
                        "View",
                        true,
                        &[&PredefinedMenuItem::fullscreen(app_handle, None)?],
                    )?,
                    &Submenu::with_items(
                        app_handle,
                        "Window",
                        true,
                        &[
                            &PredefinedMenuItem::minimize(app_handle, None)?,
                            &PredefinedMenuItem::maximize(app_handle, None)?,
                        ],
                    )?,
                    &Submenu::with_items(app_handle, "Help", true, &[])?,
                ],
            )
        })
        .on_menu_event(|app_handle, event| {
            if event.id() == MENU_OPEN_FILE_ID {
                let _ = app_handle.emit("menu-open-file", ());
            }

            if event.id() == MENU_RELOAD_FILE_ID {
                let _ = app_handle.emit("menu-reload-file", ());
            }

            if event.id() == MENU_CLOSE_TAB_ID {
                let _ = app_handle.emit("menu-close-tab", ());
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(drag_event) = event {
                if let DragDropEvent::Drop { paths, .. } = drag_event {
                    let markdown_paths: Vec<String> = paths
                        .into_iter()
                        .filter_map(|p| p.to_str().map(|s| s.to_string()))
                        .filter(|s| {
                            let lower = s.to_lowercase();
                            lower.ends_with(".md")
                                || lower.ends_with(".markdown")
                                || lower.ends_with(".mdown")
                                || lower.ends_with(".mkd")
                                || lower.ends_with(".txt")
                        })
                        .collect();

                    if !markdown_paths.is_empty() {
                        if let Ok(mut pending) = window.state::<PendingOpenedFiles>().lock() {
                            pending.extend(markdown_paths.clone());
                        }
                        let _ = window.emit("open-markdown-files", markdown_paths);
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            read_markdown_file,
            take_pending_opened_files
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        if let tauri::RunEvent::Opened { urls } = event {
            let paths = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .map(|path| path.to_string_lossy().into_owned())
                .collect::<Vec<_>>();

            if !paths.is_empty() {
                if let Ok(mut pending) = app_handle.state::<PendingOpenedFiles>().lock() {
                    pending.extend(paths.clone());
                }

                let _ = app_handle.emit("open-markdown-files", paths);
            }
        }
    });
}
