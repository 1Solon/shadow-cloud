use async_trait::async_trait;
#[path = "../service_config.rs"]
mod service_config;
use shadow_cloud_companion_engine::{
    Command, CommandError, CompanionPlatform, CompanionRemote, ConnectionState, DeviceCredentials,
    Engine, ExchangeOutcome, Handoff, RemoteError, SecretVault, SessionState, Snapshot,
};
use std::{path::PathBuf, sync::Arc, time::Duration};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;

#[tauri::command]
async fn companion_snapshot(engine: State<'_, Mutex<Engine>>) -> Result<Snapshot, CommandError> {
    Ok(engine.lock().await.snapshot())
}

#[tauri::command]
async fn companion_command(
    command: Command,
    engine: State<'_, Mutex<Engine>>,
) -> Result<Snapshot, CommandError> {
    engine.lock().await.command(command).await
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Protocol {
    protocol_version: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct HandoffWire {
    handoff_id: String,
    poll_secret: String,
    expires_at: String,
    approval_path: String,
}

#[derive(serde::Deserialize)]
struct ExchangeStatus {
    status: String,
}

struct HttpRemote {
    client: reqwest::Client,
    api_base_url: String,
    web_base_url: String,
}

impl HttpRemote {
    fn new(api_base_url: String, web_base_url: String) -> Result<Self, Box<dyn std::error::Error>> {
        Ok(Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .redirect(reqwest::redirect::Policy::none())
                .https_only(!tauri::is_dev())
                .build()?,
            api_base_url: api_base_url.trim_end_matches('/').into(),
            web_base_url: web_base_url.trim_end_matches('/').into(),
        })
    }

    async fn json(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<serde_json::Value, RemoteError> {
        let response = request.send().await.map_err(|_| RemoteError::Offline)?;
        if !response.status().is_success() {
            return Err(if response.status().is_server_error() {
                RemoteError::Offline
            } else {
                RemoteError::Rejected
            });
        }
        let bytes = response.bytes().await.map_err(|_| RemoteError::Offline)?;
        if bytes.len() > 64 * 1024 {
            return Err(RemoteError::Rejected);
        }
        serde_json::from_slice(&bytes).map_err(|_| RemoteError::Rejected)
    }
}

#[async_trait]
impl CompanionRemote for HttpRemote {
    async fn create_handoff(&self) -> Result<Handoff, RemoteError> {
        let value = self
            .json(
                self.client
                    .post(format!("{}/v1/auth/companion-handoffs", self.api_base_url)),
            )
            .await?;
        let handoff: HandoffWire =
            serde_json::from_value(value).map_err(|_| RemoteError::Rejected)?;
        if !handoff.approval_path.starts_with('/') || handoff.approval_path.starts_with("//") {
            return Err(RemoteError::Rejected);
        }
        Ok(Handoff {
            id: handoff.handoff_id,
            poll_secret: handoff.poll_secret,
            authorization_url: format!("{}{}", self.web_base_url, handoff.approval_path),
            expires_at: handoff.expires_at,
        })
    }

    async fn exchange_browser(
        &self,
        handoff_id: &str,
        poll_secret: &str,
    ) -> Result<ExchangeOutcome, RemoteError> {
        let value = self
            .json(
                self.client
                    .post(format!(
                        "{}/v1/auth/device-sessions/exchange",
                        self.api_base_url
                    ))
                    .json(&serde_json::json!({
                        "handoffId": handoff_id,
                        "pollSecret": poll_secret,
                    })),
            )
            .await?;
        let status: ExchangeStatus =
            serde_json::from_value(value.clone()).map_err(|_| RemoteError::Rejected)?;
        if status.status == "pending" {
            return Ok(ExchangeOutcome::Pending);
        }
        if status.status != "approved" {
            return Err(RemoteError::Rejected);
        }
        serde_json::from_value(value)
            .map(ExchangeOutcome::Approved)
            .map_err(|_| RemoteError::Rejected)
    }

    async fn exchange_token(&self, token: &str) -> Result<DeviceCredentials, RemoteError> {
        let value = self
            .json(
                self.client
                    .post(format!(
                        "{}/v1/auth/device-sessions/exchange",
                        self.api_base_url
                    ))
                    .json(&serde_json::json!({ "handoffToken": token })),
            )
            .await?;
        serde_json::from_value(value).map_err(|_| RemoteError::Rejected)
    }

    async fn refresh(&self, refresh_token: &str) -> Result<DeviceCredentials, RemoteError> {
        let value = self
            .json(
                self.client
                    .post(format!(
                        "{}/v1/auth/device-sessions/refresh",
                        self.api_base_url
                    ))
                    .json(&serde_json::json!({ "refreshToken": refresh_token })),
            )
            .await?;
        serde_json::from_value(value).map_err(|_| RemoteError::Rejected)
    }

    async fn revoke(&self, refresh_token: &str) -> Result<(), RemoteError> {
        self.json(
            self.client
                .post(format!(
                    "{}/v1/auth/device-sessions/revoke",
                    self.api_base_url
                ))
                .json(&serde_json::json!({ "refreshToken": refresh_token })),
        )
        .await
        .map(|_| ())
    }
}

struct NativePlatform {
    app: tauri::AppHandle,
}

impl CompanionPlatform for NativePlatform {
    fn open_url(&self, url: &str) -> Result<(), ()> {
        self.app
            .opener()
            .open_url(url, None::<&str>)
            .map_err(|_| ())
    }

    fn choose_directory(&self) -> Result<Option<PathBuf>, ()> {
        self.app
            .dialog()
            .file()
            .set_title("Choose the Shadow Cloud Companion root")
            .blocking_pick_folder()
            .map(|path| path.into_path().map_err(|_| ()))
            .transpose()
    }
}

struct SystemVault;

impl SystemVault {
    fn entry() -> Result<keyring::Entry, ()> {
        let service = if tauri::is_dev() {
            "com.shadowcloud.companion.development"
        } else {
            "com.shadowcloud.companion"
        };
        keyring::Entry::new(service, "device-session-refresh").map_err(|_| ())
    }
}

impl SecretVault for SystemVault {
    fn load(&self) -> Result<Option<String>, ()> {
        Self::entry()?.get_password().map(Some).map_err(|_| ())
    }

    fn store(&self, secret: &str) -> Result<(), ()> {
        Self::entry()?.set_password(secret).map_err(|_| ())
    }

    fn clear(&self) -> Result<(), ()> {
        Self::entry()?.delete_credential().map_err(|_| ())
    }
}

async fn check_protocol(client: &reqwest::Client, url: &str) -> Result<String, ()> {
    let response = client.get(url).send().await.map_err(|_| ())?;
    if !response.status().is_success() {
        return Err(());
    }
    let bytes = response.bytes().await.map_err(|_| ())?;
    if bytes.len() > 4096 {
        return Err(());
    }
    let protocol: Protocol = serde_json::from_slice(&bytes).map_err(|_| ())?;
    Ok(protocol.protocol_version)
}

fn service_configuration() -> service_config::ServiceConfiguration {
    // Tauri's mode distinguishes `tauri dev` from even a debug packaged build.
    service_config::ServiceConfiguration::resolve(tauri::is_dev(), |variable| {
        std::env::var(variable).ok().or_else(|| {
            match variable {
                "SHADOW_CLOUD_API_URL" => option_env!("SHADOW_CLOUD_DEV_API_URL"),
                "SHADOW_CLOUD_WEB_URL" => option_env!("SHADOW_CLOUD_DEV_WEB_URL"),
                _ => None,
            }
            .map(str::to_owned)
        })
    })
}

#[cfg(all(test, not(dev)))]
mod packaged_configuration_tests {
    use super::*;

    #[test]
    fn native_packaged_runtime_selects_the_hosted_api_and_webui() {
        let configuration = service_configuration();
        assert_eq!(
            configuration.api_base_url,
            "https://shadow-cloud.solonsstuff.com"
        );
        assert_eq!(
            configuration.web_base_url,
            "https://shadow-cloud.solonsstuff.com"
        );
    }

    #[tokio::test]
    async fn packaged_http_client_rejects_plain_http_even_in_a_debug_build() {
        let remote = HttpRemote::new(
            "http://localhost:3101".into(),
            "http://localhost:3200".into(),
        )
        .unwrap();
        let error = remote
            .client
            .get("http://localhost:3101/v1/companion/protocol")
            .send()
            .await
            .unwrap_err();
        assert!(
            error.is_builder(),
            "plain HTTP must be rejected before any request is sent"
        );
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let service_config::ServiceConfiguration {
                api_base_url,
                web_base_url,
            } = service_configuration();
            let remote = Arc::new(HttpRemote::new(api_base_url.clone(), web_base_url)?);
            let mut data_directory = app.path().app_data_dir()?;
            if tauri::is_dev() {
                data_directory = data_directory.join("development");
            }
            let database_path = data_directory.join("companion.sqlite3");
            let engine = Engine::open(
                &database_path,
                remote,
                Arc::new(NativePlatform {
                    app: app.handle().clone(),
                }),
                Arc::new(SystemVault),
            )?;
            let mut revisions = engine.subscribe();
            app.manage(Mutex::new(engine));

            let events = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while revisions.changed().await.is_ok() {
                    let snapshot = revisions.borrow_and_update().clone();
                    let _ = events.emit("companion:snapshot", snapshot);
                }
            });

            let protocol_client = reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .redirect(reqwest::redirect::Policy::none())
                .https_only(!tauri::is_dev())
                .build()?;
            let protocol_url = format!(
                "{}/v1/companion/protocol",
                api_base_url.trim_end_matches('/')
            );
            let coordinator = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let observation = check_protocol(&protocol_client, &protocol_url).await;
                    let state = coordinator.state::<Mutex<Engine>>();
                    let mut engine = state.lock().await;
                    engine.observe_protocol(observation);
                    let snapshot = engine.snapshot();
                    if snapshot.connection.state == ConnectionState::Connected
                        && snapshot.session.state == SessionState::SignedOut
                    {
                        let _ = engine.restore_session().await;
                    }
                    drop(engine);
                    tokio::time::sleep(Duration::from_secs(30)).await;
                }
            });

            let authorization = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_millis(1_500)).await;
                    let _ = authorization
                        .state::<Mutex<Engine>>()
                        .lock()
                        .await
                        .poll_browser_sign_in()
                        .await;
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
