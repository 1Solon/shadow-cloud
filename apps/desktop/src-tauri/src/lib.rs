use tauri::{Emitter, Manager};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(url) = argv
                .iter()
                .find(|argument| argument.starts_with("shadow-cloud://"))
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_focus();
                }

                let _ = app.emit("deep-link://new-url", vec![url.to_string()]);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running Shadow-Cloud desktop");
}
