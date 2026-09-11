use shadow_cloud_companion_engine::{Command, CommandError, Engine, Snapshot};
use std::{sync::Mutex, time::Duration};
use tauri::{Emitter, Manager, State};

#[tauri::command]
fn companion_snapshot(engine: State<'_, Mutex<Engine>>) -> Snapshot {
    engine
        .lock()
        .expect("engine coordinator poisoned")
        .snapshot()
}

#[tauri::command]
fn companion_command(
    command: Command,
    engine: State<'_, Mutex<Engine>>,
) -> Result<Snapshot, CommandError> {
    engine
        .lock()
        .expect("engine coordinator poisoned")
        .command(command)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Protocol {
    protocol_version: String,
}

async fn check_protocol(client: &reqwest::Client, url: &str) -> Result<String, ()> {
    let mut response = client.get(url).send().await.map_err(|_| ())?;
    if !response.status().is_success() {
        return Err(());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| ())? {
        if body.len() + chunk.len() > 4096 {
            return Err(());
        }
        body.extend_from_slice(&chunk);
    }
    let protocol: Protocol = serde_json::from_slice(&body).map_err(|_| ())?;
    Ok(protocol.protocol_version)
}

fn api_base_url() -> String {
    #[cfg(debug_assertions)]
    if let Ok(url) = std::env::var("SHADOW_CLOUD_API_URL") {
        return url;
    }
    option_env!("SHADOW_CLOUD_API_URL")
        .unwrap_or("https://shadow-cloud.solonsstuff.com")
        .into()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(Mutex::new(Engine::new()))
        .setup(|app| {
            let mut revisions = app
                .state::<Mutex<Engine>>()
                .lock()
                .expect("engine coordinator poisoned")
                .subscribe();
            let events = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while revisions.changed().await.is_ok() {
                    let snapshot = revisions.borrow_and_update().clone();
                    // Full immutable snapshots are revisioned and may coalesce.
                    let _ = events.emit("companion:snapshot", snapshot);
                }
            });

            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .redirect(reqwest::redirect::Policy::none())
                .https_only(!cfg!(debug_assertions))
                .build()?;
            let url = format!(
                "{}/v1/companion/protocol",
                api_base_url().trim_end_matches('/')
            );
            let coordinator = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let observation = check_protocol(&client, &url).await;
                    coordinator
                        .state::<Mutex<Engine>>()
                        .lock()
                        .expect("engine coordinator poisoned")
                        .observe_protocol(observation);
                    tokio::time::sleep(Duration::from_secs(30)).await;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            companion_snapshot,
            companion_command
        ])
        .run(tauri::generate_context!())
        .expect("could not start Shadow Cloud Companion");
}
