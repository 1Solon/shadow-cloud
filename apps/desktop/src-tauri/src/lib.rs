use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State, WindowEvent,
};

#[derive(Default)]
struct TrayCloseState {
    minimize_to_tray_on_close: AtomicBool,
    is_quitting: AtomicBool,
}

#[tauri::command]
fn set_minimize_to_tray_on_close(enabled: bool, state: State<'_, Arc<TrayCloseState>>) {
    state
        .minimize_to_tray_on_close
        .store(enabled, Ordering::Relaxed);
}

fn should_hide_window_on_close(minimize_to_tray_on_close: bool, is_quitting: bool) -> bool {
    minimize_to_tray_on_close && !is_quitting
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::should_hide_window_on_close;

    #[test]
    fn hides_window_when_close_to_tray_is_enabled_and_app_is_not_quitting() {
        assert!(should_hide_window_on_close(true, false));
    }

    #[test]
    fn allows_close_when_preference_is_disabled_or_app_is_quitting() {
        assert!(!should_hide_window_on_close(false, false));
        assert!(!should_hide_window_on_close(true, true));
    }
}

pub fn run() {
    let tray_close_state = Arc::new(TrayCloseState::default());
    let close_state = Arc::clone(&tray_close_state);
    let menu_state = Arc::clone(&tray_close_state);

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(tray_close_state)
        .setup(|app| {
            let menu = MenuBuilder::new(app)
                .text("show", "Show Shadow Cloud")
                .text("quit", "Quit")
                .build()?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Shadow Cloud Local")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "quit" => {
                        app.state::<Arc<TrayCloseState>>()
                            .is_quitting
                            .store(true, Ordering::Relaxed);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }
                    | TrayIconEvent::DoubleClick {
                        button: MouseButton::Left,
                        ..
                    } => show_main_window(tray.app_handle()),
                    _ => {}
                });

            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }

            tray.build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![set_minimize_to_tray_on_close])
        .on_window_event(move |window, event| {
            if window.label() != "main" {
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                if should_hide_window_on_close(
                    close_state
                        .minimize_to_tray_on_close
                        .load(Ordering::Relaxed),
                    close_state.is_quitting.load(Ordering::Relaxed),
                ) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .on_menu_event(move |app, event| {
            if event.id().as_ref() == "quit" {
                menu_state.is_quitting.store(true, Ordering::Relaxed);
                app.exit(0);
            }
        })
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(url) = argv
                .iter()
                .find(|argument| argument.starts_with("shadow-cloud://"))
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
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
