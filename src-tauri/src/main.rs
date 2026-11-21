#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::ipc::{InvokeBody, Request};
use tauri::{
    AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct Desktop {
    pending: Mutex<Option<PathBuf>>,
    ready: AtomicBool,
    quitting: AtomicBool,
}

fn queue_files(app: &AppHandle, paths: impl Iterator<Item = PathBuf>) {
    let desktop = app.state::<Desktop>();
    let mut pending = desktop.pending.lock().unwrap();
    for path in paths {
        if path
            .extension()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.eq_ignore_ascii_case("cif") || s.eq_ignore_ascii_case("psv"))
        {
            *pending = Some(path);
        }
    }
    if pending.is_some() {
        drop(pending);
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.unminimize();
            let _ = main.set_focus();
            let _ = main.emit("open-document", ());
        }
    }
}

#[derive(serde::Serialize)]
struct Document {
    name: String,
    text: String,
}

#[tauri::command]
async fn take_document(app: AppHandle) -> Result<Option<Document>, String> {
    let path = app.state::<Desktop>().pending.lock().unwrap().take();
    let Some(path) = path else { return Ok(None) };
    let text =
        fs::read_to_string(&path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    Ok(Some(Document {
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
        text,
    }))
}

#[tauri::command]
async fn save_file(window: WebviewWindow, request: Request<'_>) -> Result<Option<String>, String> {
    let name = request
        .headers()
        .get("x-filename")
        .and_then(|s| s.to_str().ok())
        .ok_or("Missing filename")?;
    let decoded = percent_encoding::percent_decode_str(name)
        .decode_utf8()
        .map_err(|e| e.to_string())?;
    let name = Path::new(decoded.as_ref())
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("Invalid filename")?;
    let InvokeBody::Raw(data) = request.body() else {
        return Err("Missing file data".into());
    };
    save_bytes(&window, name, data)
}

fn save_bytes(window: &WebviewWindow, name: &str, data: &[u8]) -> Result<Option<String>, String> {
    let ext = Path::new(name)
        .extension()
        .and_then(|s| s.to_str())
        .ok_or("Missing file type")?;
    let dialog = window
        .dialog()
        .file()
        .set_parent(window)
        .set_file_name(name)
        .add_filter(&ext.to_uppercase(), &[ext]);
    let Some(file) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|e| e.to_string())?;
    let parent = path.parent().ok_or("Missing destination directory")?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    tmp.write_all(data)
        .and_then(|_| tmp.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    tmp.persist(&path).map_err(|e| e.to_string())?;
    Ok(Some(
        path.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
    ))
}

#[tauri::command]
async fn show_help(app: AppHandle) -> Result<(), String> {
    if let Some(help) = app.get_webview_window("help") {
        return help.set_focus().map_err(|e| e.to_string());
    }
    let main = app.get_webview_window("main").ok_or("Viewer is closed")?;
    let base = main.url().map_err(|e| e.to_string())?;
    WebviewWindowBuilder::new(&app, "help", WebviewUrl::App("docs/index.html".into()))
        .title("PhaseSmith Viewer Help")
        .inner_size(980., 760.)
        .on_new_window(move |url, _| {
            if url.scheme() == base.scheme() && url.host_str() == base.host_str() {
                if url.path() == "/" || url.path() == "/index.html" {
                    if url.query().is_some() {
                        let _ = main.navigate(url);
                    }
                    let _ = main.set_focus();
                } else if url.path() == "/example.cif" {
                    let main = main.clone();
                    tauri::async_runtime::spawn_blocking(move || {
                        let help = main.get_webview_window("help").unwrap_or(main);
                        if let Some(asset) =
                            help.app_handle().asset_resolver().get("example.cif".into())
                        {
                            if let Err(error) = save_bytes(&help, "example.cif", asset.bytes()) {
                                help.dialog().message(error).show(|_| {});
                            }
                        }
                    });
                }
            } else if matches!(url.scheme(), "http" | "https" | "mailto") {
                let _ = open::that_detached(url.as_str());
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn viewer_ready(app: AppHandle) {
    app.state::<Desktop>().ready.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn finish_quit(app: AppHandle, confirmed: bool) {
    if !confirmed {
        app.state::<Desktop>()
            .quitting
            .store(false, Ordering::SeqCst);
        return;
    }
    app.state::<Desktop>().ready.store(false, Ordering::SeqCst);
    app.exit(0);
}

fn request_quit(app: &AppHandle) -> bool {
    let desktop = app.state::<Desktop>();
    if !desktop.ready.load(Ordering::SeqCst) {
        return false;
    }
    if !desktop.quitting.swap(true, Ordering::SeqCst) {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.emit("save-before-quit", ());
        }
    }
    true
}

fn main() {
    let builder = tauri::Builder::default().manage(Desktop::default());
    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        queue_files(
            app,
            args.into_iter().skip(1).map(|s| Path::new(&cwd).join(s)),
        );
    }));
    builder
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            take_document,
            save_file,
            show_help,
            viewer_ready,
            finish_quit
        ])
        .setup(|app| {
            queue_files(app.handle(), std::env::args_os().skip(1).map(PathBuf::from));
            Ok(())
        })
        .on_window_event(|win, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if win.label() == "main" && request_quit(win.app_handle()) {
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("Could not start PhaseSmith Viewer")
        .run(|app, event| match event {
            #[cfg(target_os = "macos")]
            RunEvent::Opened { urls } => queue_files(
                app,
                urls.into_iter().filter_map(|url| url.to_file_path().ok()),
            ),
            RunEvent::ExitRequested { api, .. } if request_quit(app) => api.prevent_exit(),
            _ => {}
        });
}
