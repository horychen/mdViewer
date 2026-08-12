use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{DragDropEvent, Emitter, Manager};

type PendingOpenedFiles = Mutex<Vec<String>>;

/// Handle to the "Open Recent" submenu so its contents can be replaced while
/// the app runs. The frontend owns the actual list and pushes it down here.
type RecentFilesMenu = Mutex<Option<Submenu<tauri::Wry>>>;

const MENU_OPEN_FILE_ID: &str = "open-file";
const MENU_SAVE_FILE_ID: &str = "save-file";
const MENU_RELOAD_FILE_ID: &str = "reload-file";
const MENU_CLOSE_TAB_ID: &str = "close-tab";
const MENU_RECENT_EMPTY_ID: &str = "recent-files-empty";
const MENU_CLEAR_RECENT_ID: &str = "clear-recent-files";
/// Each recent entry carries its path in the menu id, so no side table is needed.
const MENU_RECENT_PREFIX: &str = "recent-file:";

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

/// Writes the editor's buffer back to the file it came from.
///
/// The write goes to a temporary file in the same directory and is then renamed
/// over the original. A rename within one filesystem is atomic, so an
/// interruption leaves the previous version intact rather than a half-written
/// file — this is somebody's document, and it may well be the only copy.
#[tauri::command]
fn write_markdown_file(path: String, content: String) -> Result<(), String> {
    let target = PathBuf::from(&path);

    let directory = target
        .parent()
        .ok_or_else(|| "Refusing to write a path with no parent directory".to_string())?;

    let file_name = target
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Refusing to write a path with no file name".to_string())?;

    let temporary = directory.join(format!(".{file_name}.mdview-tmp"));

    fs::write(&temporary, content.as_bytes())
        .map_err(|error| format!("Could not write the file: {error}"))?;

    fs::rename(&temporary, &target).map_err(|error| {
        // Leaving the temporary file behind would be its own small mess.
        let _ = fs::remove_file(&temporary);
        format!("Could not replace the file: {error}")
    })?;

    Ok(())
}

#[tauri::command]
fn take_pending_opened_files(state: tauri::State<'_, PendingOpenedFiles>) -> Vec<String> {
    let mut pending = state.lock().expect("pending opened files lock poisoned");
    std::mem::take(&mut *pending)
}

#[derive(Debug, Deserialize)]
struct RecentEntry {
    path: String,
    name: String,
}

fn rebuild_recent_menu(
    app_handle: &tauri::AppHandle,
    submenu: &Submenu<tauri::Wry>,
    entries: &[RecentEntry],
) {
    while matches!(submenu.remove_at(0), Ok(Some(_))) {}

    if entries.is_empty() {
        if let Ok(placeholder) = MenuItem::with_id(
            app_handle,
            MENU_RECENT_EMPTY_ID,
            "No Recent Files",
            false,
            None::<&str>,
        ) {
            let _ = submenu.append(&placeholder);
        }
        return;
    }

    for entry in entries {
        let id = format!("{MENU_RECENT_PREFIX}{}", entry.path);
        if let Ok(item) = MenuItem::with_id(app_handle, id, &entry.name, true, None::<&str>) {
            let _ = submenu.append(&item);
        }
    }

    if let (Ok(separator), Ok(clear)) = (
        PredefinedMenuItem::separator(app_handle),
        MenuItem::with_id(
            app_handle,
            MENU_CLEAR_RECENT_ID,
            "Clear Menu",
            true,
            None::<&str>,
        ),
    ) {
        let _ = submenu.append(&separator);
        let _ = submenu.append(&clear);
    }
}

/// Mirrors the frontend's recent-file list into the native menu. Menu mutation
/// has to happen on the main thread on macOS.
#[tauri::command]
fn set_recent_files(app_handle: tauri::AppHandle, entries: Vec<RecentEntry>) {
    let handle = app_handle.clone();

    let _ = app_handle.run_on_main_thread(move || {
        let state = handle.state::<RecentFilesMenu>();
        let guard = state.lock().expect("recent files menu lock poisoned");

        if let Some(submenu) = guard.as_ref() {
            rebuild_recent_menu(&handle, submenu, &entries);
        }
    });
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
                authors: config
                    .bundle
                    .publisher
                    .clone()
                    .map(|publisher| vec![publisher]),
                ..Default::default()
            };

            let recent_submenu = Submenu::with_items(
                app_handle,
                "Open Recent",
                true,
                &[&MenuItem::with_id(
                    app_handle,
                    MENU_RECENT_EMPTY_ID,
                    "No Recent Files",
                    false,
                    None::<&str>,
                )?],
            )?;
            app_handle.manage::<RecentFilesMenu>(Mutex::new(Some(recent_submenu.clone())));

            Menu::with_items(
                app_handle,
                &[
                    #[cfg(target_os = "macos")]
                    &Submenu::with_items(
                        app_handle,
                        pkg_info.name.clone(),
                        true,
                        &[
                            &PredefinedMenuItem::about(app_handle, None, Some(about_metadata))?,
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
                            &recent_submenu,
                            &PredefinedMenuItem::separator(app_handle)?,
                            &MenuItem::with_id(
                                app_handle,
                                MENU_SAVE_FILE_ID,
                                "Save",
                                true,
                                Some("CmdOrCtrl+S"),
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

            if event.id() == MENU_SAVE_FILE_ID {
                let _ = app_handle.emit("menu-save-file", ());
            }

            if event.id() == MENU_RELOAD_FILE_ID {
                let _ = app_handle.emit("menu-reload-file", ());
            }

            if event.id() == MENU_CLOSE_TAB_ID {
                let _ = app_handle.emit("menu-close-tab", ());
            }

            if event.id() == MENU_CLEAR_RECENT_ID {
                let _ = app_handle.emit("menu-clear-recent-files", ());
            }

            if let Some(path) = event.id().0.strip_prefix(MENU_RECENT_PREFIX) {
                let _ = app_handle.emit("open-markdown-files", vec![path.to_string()]);
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
                let markdown_paths: Vec<String> = paths
                    .iter()
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
        })
        .invoke_handler(tauri::generate_handler![
            read_markdown_file,
            write_markdown_file,
            take_pending_opened_files,
            set_recent_files
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
