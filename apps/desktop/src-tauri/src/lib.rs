use async_trait::async_trait;
mod desktop;
mod lifecycle;
#[cfg(test)]
mod native_tests;
mod notifications;
#[path = "../service_config.rs"]
mod service_config;
mod updater;
use shadow_cloud_companion_engine::{
    AutomaticNotification, Command, CommandError, CompanionPlatform, CompanionRemote,
    ConnectionState, DesktopCapabilities, DeviceCredentials, Engine, ExchangeOutcome, Handoff,
    ObservedCampaign, PublicationPage, ReceiveError, RemoteError, SavePublication, SecretVault,
    SessionState, Snapshot, SubmissionReceipt, TurnSubmission, UpdateChannel, UpdateOffer, RELEASE,
};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tokio::sync::{Mutex, MutexGuard};

/// A queued native request interrupts read-only work until that request owns
/// the coordinator. Releasing one request must not hide any later requests.
struct PendingCommand(Arc<AtomicUsize>);

impl PendingCommand {
    fn new(pending: Arc<AtomicUsize>) -> Self {
        pending.fetch_add(1, Ordering::SeqCst);
        Self(pending)
    }

    async fn acquire<T>(self, owner: &Mutex<T>) -> MutexGuard<'_, T> {
        let owner = owner.lock().await;
        drop(self);
        owner
    }
}

impl Drop for PendingCommand {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

struct Coordinator {
    engine: Mutex<Engine>,
    snapshots: tokio::sync::watch::Receiver<Snapshot>,
    interrupt_receive: Arc<AtomicUsize>,
}

#[tauri::command]
async fn companion_snapshot(coordinator: State<'_, Coordinator>) -> Result<Snapshot, CommandError> {
    Ok(coordinator.snapshots.borrow().clone())
}

#[tauri::command]
async fn companion_command(
    command: Command,
    coordinator: State<'_, Coordinator>,
) -> Result<Snapshot, CommandError> {
    // Interrupt only read-only receive HTTP requests and bounded hashing. Auth
    // mutation requests finish normally so rotating credentials cannot be lost.
    let pending = PendingCommand::new(coordinator.interrupt_receive.clone());
    let mut engine = pending.acquire(&coordinator.engine).await;
    engine.command(command).await
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
    interrupt_receive: Arc<AtomicUsize>,
}

impl HttpRemote {
    async fn submission_response(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<Option<SubmissionReceipt>, ReceiveError> {
        // Submissions are never cancelled with read-only polling. Their durable
        // operation key remains authoritative even if the HTTP response is lost.
        let mut response = request.send().await.map_err(|_| ReceiveError::Offline)?;
        match response.status().as_u16() {
            200 | 201 => {}
            404 => return Ok(None),
            401 => return Err(ReceiveError::Unauthorized),
            400 | 413 => return Err(ReceiveError::RejectedSubmission),
            403 => return Err(ReceiveError::Forbidden),
            409 => return Err(ReceiveError::StaleSubmission),
            426 => return Err(ReceiveError::UpdateRequired),
            500..=599 => return Err(ReceiveError::Offline),
            _ => return Err(ReceiveError::InvalidResponse),
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| ReceiveError::Offline)? {
            if bytes.len() + chunk.len() > 64 * 1024 {
                return Err(ReceiveError::InvalidResponse);
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| ReceiveError::InvalidResponse)
    }
    fn receive_request(
        &self,
        access: &str,
        segments: &[&str],
        query: &[(&str, String)],
    ) -> Result<reqwest::RequestBuilder, ReceiveError> {
        let mut url = reqwest::Url::parse(&format!("{}/v1/companion/", self.api_base_url))
            .map_err(|_| ReceiveError::InvalidResponse)?;
        url.path_segments_mut()
            .map_err(|_| ReceiveError::InvalidResponse)?
            .pop_if_empty()
            .extend(segments);
        url.query_pairs_mut().extend_pairs(query);
        Ok(self
            .client
            .get(url)
            .bearer_auth(access)
            .header("X-Companion-Protocol", RELEASE))
    }
    async fn receive_bytes(
        &self,
        request: reqwest::RequestBuilder,
        limit: usize,
    ) -> Result<Vec<u8>, ReceiveError> {
        tokio::select! {
            result=self.receive_bytes_uninterrupted(request,limit) => result,
            _=async { while self.interrupt_receive.load(Ordering::SeqCst) == 0 { tokio::time::sleep(Duration::from_millis(20)).await; } } => Err(ReceiveError::Interrupted),
        }
    }
    async fn receive_bytes_uninterrupted(
        &self,
        request: reqwest::RequestBuilder,
        limit: usize,
    ) -> Result<Vec<u8>, ReceiveError> {
        let mut response = request.send().await.map_err(|_| ReceiveError::Offline)?;
        match response.status().as_u16() {
            200 => {}
            401 => return Err(ReceiveError::Unauthorized),
            403 => return Err(ReceiveError::Forbidden),
            404 | 409 => return Err(ReceiveError::SaveChanged),
            426 => return Err(ReceiveError::UpdateRequired),
            500..=599 => return Err(ReceiveError::Offline),
            _ => return Err(ReceiveError::InvalidResponse),
        }
        if response.content_length().is_some_and(|n| n > limit as u64) {
            return Err(ReceiveError::InvalidResponse);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| ReceiveError::Offline)? {
            if bytes.len() + chunk.len() > limit {
                return Err(ReceiveError::InvalidResponse);
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }

    fn new(api_base_url: String, web_base_url: String) -> Result<Self, Box<dyn std::error::Error>> {
        Ok(Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .redirect(reqwest::redirect::Policy::none())
                .https_only(!tauri::is_dev())
                .build()?,
            api_base_url: api_base_url.trim_end_matches('/').into(),
            web_base_url: web_base_url.trim_end_matches('/').into(),
            interrupt_receive: Arc::new(AtomicUsize::new(0)),
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
    async fn submit(
        &self,
        access: &str,
        submission: &TurnSubmission,
        bytes: Vec<u8>,
    ) -> Result<SubmissionReceipt, ReceiveError> {
        let url = self
            .receive_request(
                access,
                &[
                    "campaigns",
                    &submission.campaign_id,
                    "submissions",
                    &submission.operation_key,
                ],
                &[],
            )?
            .build()
            .map_err(|_| ReceiveError::InvalidResponse)?
            .url()
            .clone();
        let form = reqwest::multipart::Form::new()
            .text("filename", submission.filename.clone())
            .text("baseline", submission.baseline.clone())
            .text("contentHash", submission.content_hash.clone())
            .part(
                "file",
                reqwest::multipart::Part::bytes(bytes).file_name(submission.filename.clone()),
            );
        self.submission_response(
            self.client
                .post(url)
                .bearer_auth(access)
                .header("X-Companion-Protocol", RELEASE)
                .multipart(form),
        )
        .await?
        .ok_or(ReceiveError::InvalidResponse)
    }
    async fn receipt(
        &self,
        access: &str,
        key: &str,
    ) -> Result<Option<SubmissionReceipt>, ReceiveError> {
        tokio::select! {
            result=self.submission_response(self.receive_request(access,&["submissions",key],&[])?)=>result,
            _=async {while self.interrupt_receive.load(Ordering::SeqCst) == 0 {tokio::time::sleep(Duration::from_millis(20)).await;}}=>Err(ReceiveError::Interrupted),
        }
    }
    fn receive_interrupted(&self) -> bool {
        self.interrupt_receive.load(Ordering::SeqCst) != 0
    }
    async fn observe(&self, access: &str) -> Result<Vec<ObservedCampaign>, ReceiveError> {
        #[derive(serde::Deserialize)]
        struct Observation {
            campaigns: Vec<ObservedCampaign>,
        }
        let bytes = self
            .receive_bytes(
                self.receive_request(access, &["campaigns"], &[])?,
                2 * 1024 * 1024,
            )
            .await?;
        serde_json::from_slice::<Observation>(&bytes)
            .map(|o| o.campaigns)
            .map_err(|_| ReceiveError::InvalidResponse)
    }
    async fn publications(
        &self,
        access: &str,
        campaign: &str,
        after: u32,
    ) -> Result<PublicationPage, ReceiveError> {
        let bytes = self
            .receive_bytes(
                self.receive_request(
                    access,
                    &["campaigns", campaign, "publications"],
                    &[("after", after.to_string())],
                )?,
                2 * 1024 * 1024,
            )
            .await?;
        serde_json::from_slice(&bytes).map_err(|_| ReceiveError::InvalidResponse)
    }
    async fn download(
        &self,
        access: &str,
        campaign: &str,
        save: &SavePublication,
    ) -> Result<Vec<u8>, ReceiveError> {
        let request = self.receive_request(
            access,
            &["campaigns", campaign, "saves", &save.file_version_id],
            &[
                ("revision", save.content_revision.to_string()),
                ("hash", save.content_hash.clone()),
            ],
        )?;
        self.receive_bytes(request, save.size.min(25 * 1024 * 1024) as usize)
            .await
    }

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
    web_base_url: String,
    app: tauri::AppHandle,
    notifications: notifications::Notifications,
    lifecycle: Arc<std::sync::OnceLock<lifecycle::Lifecycle>>,
    desktop: Arc<desktop::Desktop>,
    updates: updater::Updates,
}

#[async_trait]
impl CompanionPlatform for NativePlatform {
    fn desktop_capabilities(&self) -> DesktopCapabilities {
        self.desktop.capabilities()
    }
    fn start_at_login_enabled(&self) -> Result<bool, ()> {
        self.desktop.start_at_login_enabled()
    }
    fn set_start_at_login(&self, enabled: bool) -> Result<(), ()> {
        self.desktop.set_start_at_login(enabled)
    }
    async fn check_update(&self, channel: UpdateChannel) -> Result<Option<UpdateOffer>, ()> {
        self.updates.check(channel).await
    }
    async fn install_update(&self, offer_id: &str) -> Result<(), ()> {
        self.updates.install(offer_id).await
    }
    fn open_campaign(&self, number: u32) -> Result<(), ()> {
        let path = if number == 0 {
            "/games".to_owned()
        } else {
            format!("/games/{number}")
        };
        self.open_url(&format!(
            "{}{}",
            self.web_base_url.trim_end_matches('/'),
            path
        ))
    }

    async fn notify_automatic(&self, notification: AutomaticNotification) -> Result<(), ()> {
        if self
            .lifecycle
            .get()
            .is_none_or(|lifecycle| !lifecycle.ready())
        {
            return Err(());
        }
        self.notifications.show(notification).await
    }

    fn dismiss_automatic(&self, authorization_id: &str) {
        self.notifications.dismiss(authorization_id);
    }

    fn open_folder(&self, path: &std::path::Path) -> Result<(), ()> {
        self.app
            .opener()
            .open_path(path.to_string_lossy(), None::<&str>)
            .map_err(|_| ())
    }

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

struct SystemVault {
    service: String,
}

impl SystemVault {
    fn new() -> Self {
        let service = if tauri::is_dev() {
            "com.shadowcloud.companion.development"
        } else {
            "com.shadowcloud.companion"
        };
        Self {
            service: service.into(),
        }
    }
    fn with_entry<T: Send>(
        &self,
        operation: impl FnOnce(keyring::Entry) -> Result<T, ()> + Send,
    ) -> Result<T, ()> {
        // The Linux synchronous provider initializes its own Tokio runtime.
        // Keep initialization and calls off the async coordinator's thread.
        // Joining bounds each synchronous request to one native worker and
        // leaves no detached operation holding a rotating refresh secret.
        std::thread::scope(|scope| {
            std::thread::Builder::new()
                .name("companion-vault".into())
                .spawn_scoped(scope, || {
                    let entry = keyring::Entry::new(&self.service, "device-session-refresh")
                        .map_err(|_| ())?;
                    operation(entry)
                })
                .map_err(|_| ())?
                .join()
                .map_err(|_| ())?
        })
    }
}

impl SecretVault for SystemVault {
    fn load(&self) -> Result<Option<String>, ()> {
        self.with_entry(|entry| entry.get_password().map(Some).map_err(|_| ()))
    }

    fn store(&self, secret: &str) -> Result<(), ()> {
        self.with_entry(|entry| entry.set_password(secret).map_err(|_| ()))
    }

    fn clear(&self) -> Result<(), ()> {
        self.with_entry(|entry| entry.delete_credential().map_err(|_| ()))
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
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            desktop::show_main(app)
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build());
    builder
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if let (Some(desktop), Some(coordinator)) = (
                    app.try_state::<Arc<desktop::Desktop>>(),
                    app.try_state::<Coordinator>(),
                ) {
                    api.prevent_close();
                    let keep_running = coordinator
                        .snapshots
                        .borrow()
                        .preferences
                        .keep_running_in_tray;
                    if !desktop.close_to_tray(keep_running) {
                        dispatch_desktop_action(app, desktop::Action::Quit);
                    }
                }
            }
        })
        .setup(|app| {
            let service_config::ServiceConfiguration {
                api_base_url,
                web_base_url,
            } = service_configuration();
            let remote = Arc::new(HttpRemote::new(api_base_url.clone(), web_base_url.clone())?);
            let mut data_directory = app.path().app_data_dir()?;
            if tauri::is_dev() {
                data_directory = data_directory.join("development");
            }
            let database_path = data_directory.join("companion.sqlite3");
            let interrupt_receive = remote.interrupt_receive.clone();
            let notification_app = app.handle().clone();
            let notification_interrupt = interrupt_receive.clone();
            let notifications = notifications::Notifications::new(move |command| {
                // Register on the native callback thread before queueing behind
                // reconciliation, preserving all other queued requests.
                let pending = PendingCommand::new(notification_interrupt.clone());
                let app = notification_app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = app.state::<Coordinator>();
                    let mut engine = pending.acquire(&state.engine).await;
                    let _ = engine.command(command).await;
                });
            });
            let lifecycle = Arc::new(std::sync::OnceLock::new());
            let desktop_app = app.handle().clone();
            let desktop = desktop::Desktop::new(
                app.handle().clone(),
                Arc::new(move |action| {
                    dispatch_desktop_action(&desktop_app, action);
                }),
            );
            let updates = updater::Updates::new(app.handle().clone(), interrupt_receive.clone())
                .map_err(|_| std::io::Error::other("could not initialize the update client"))?;
            let engine = Engine::open(
                &database_path,
                remote,
                Arc::new(NativePlatform {
                    web_base_url,
                    app: app.handle().clone(),
                    notifications,
                    lifecycle: lifecycle.clone(),
                    desktop: desktop.clone(),
                    updates,
                }),
                Arc::new(SystemVault::new()),
            )?;
            let mut revisions = engine.subscribe();
            app.manage(Coordinator {
                engine: Mutex::new(engine),
                snapshots: revisions.clone(),
                interrupt_receive: interrupt_receive.clone(),
            });
            app.manage(desktop.clone());
            desktop.update(&app.state::<Coordinator>().snapshots.borrow());
            let capability_app = app.handle().clone();
            let capability_interrupt = interrupt_receive.clone();
            desktop.start_monitor(Arc::new(move || {
                let pending = PendingCommand::new(capability_interrupt.clone());
                let app = capability_app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = app.state::<Coordinator>();
                    let mut engine = pending.acquire(&state.engine).await;
                    engine.refresh_desktop_capabilities();
                });
            }));

            let lifecycle_app = app.handle().clone();
            let lifecycle_interrupt = interrupt_receive.clone();
            let _ = lifecycle.set(lifecycle::Lifecycle::new(move || {
                let pending = PendingCommand::new(lifecycle_interrupt.clone());
                let app = lifecycle_app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = app.state::<Coordinator>();
                    let mut engine = pending.acquire(&state.engine).await;
                    engine.resume();
                });
            }));

            let events = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while revisions.changed().await.is_ok() {
                    let snapshot = revisions.borrow_and_update().clone();
                    events.state::<Arc<desktop::Desktop>>().update(&snapshot);
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
                let mut next_protocol_check = tokio::time::Instant::now();
                loop {
                    let observation = if tokio::time::Instant::now() >= next_protocol_check {
                        let observation = check_protocol(&protocol_client, &protocol_url).await;
                        next_protocol_check = tokio::time::Instant::now() + Duration::from_secs(30);
                        Some(observation)
                    } else {
                        None
                    };
                    let state = coordinator.state::<Coordinator>();
                    let mut engine = state.engine.lock().await;
                    if let Some(observation) = observation {
                        engine.observe_protocol(observation);
                    }
                    let snapshot = engine.snapshot();
                    if snapshot.connection.state == ConnectionState::Connected
                        && snapshot.session.state == SessionState::SignedOut
                    {
                        let _ = engine.restore_session().await;
                    }
                    if engine.snapshot().connection.state == ConnectionState::Connected
                        && engine.snapshot().session.state == SessionState::SignedIn
                    {
                        let _ = engine.reconcile().await;
                    }
                    drop(engine);
                    // The engine owns deadlines and resets them after a gap or wake.
                    // Sleep after each reconciliation; never replay missed ticks.
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            });

            let authorization = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_millis(1_500)).await;
                    let _ = authorization
                        .state::<Coordinator>()
                        .engine
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

fn dispatch_desktop_action(app: &tauri::AppHandle, action: desktop::Action) {
    if matches!(action, desktop::Action::Open) {
        desktop::show_main(app);
        return;
    }
    let Some(coordinator) = app.try_state::<Coordinator>() else {
        return;
    };
    let pending = PendingCommand::new(coordinator.interrupt_receive.clone());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<Coordinator>();
        let mut engine = pending.acquire(&state.engine).await;
        match action {
            desktop::Action::PauseAll => {
                let command = desktop::pause_command(&engine.snapshot());
                let _ = engine.command(command).await;
            }
            desktop::Action::Quit => {
                engine.resume();
                app.exit(0);
            }
            desktop::Action::Open => {}
        }
    });
}

#[cfg(test)]
mod coordinator_tests {
    use super::*;
    use std::{
        future::Future,
        task::{Context, Poll, Waker},
    };

    #[tokio::test]
    async fn queued_cancel_still_interrupts_reconciliation_after_an_earlier_command_runs() {
        let remote = HttpRemote::new(
            "https://synthetic.invalid".into(),
            "https://synthetic.invalid".into(),
        )
        .unwrap();
        let coordinator = Mutex::new(());
        // A dispatched submission keeps ownership while Theme, a background
        // reconciliation, and notification Cancel queue in this exact order.
        let dispatched_submission = coordinator.lock().await;
        let mut theme =
            Box::pin(PendingCommand::new(remote.interrupt_receive.clone()).acquire(&coordinator));
        let mut reconciliation = Box::pin(coordinator.lock());
        let mut cancel =
            Box::pin(PendingCommand::new(remote.interrupt_receive.clone()).acquire(&coordinator));
        let mut context = Context::from_waker(Waker::noop());
        assert!(matches!(theme.as_mut().poll(&mut context), Poll::Pending));
        assert!(matches!(
            reconciliation.as_mut().poll(&mut context),
            Poll::Pending
        ));
        assert!(matches!(cancel.as_mut().poll(&mut context), Poll::Pending));

        drop(dispatched_submission);
        let theme_owner = theme.await;
        assert!(remote.receive_interrupted());
        drop(theme_owner);
        let reconciliation_owner = reconciliation.await;
        // This is the production remote gate checked before any new Send.
        // Completing Theme cannot remove the later Cancel authorization barrier.
        assert!(remote.receive_interrupted());
        drop(reconciliation_owner);
        let cancel_owner = cancel.await;
        assert!(!remote.receive_interrupted());
        drop(cancel_owner);
    }

    #[tokio::test]
    async fn abandoning_a_queued_command_releases_its_own_interruption() {
        let remote = HttpRemote::new(
            "https://synthetic.invalid".into(),
            "https://synthetic.invalid".into(),
        )
        .unwrap();
        let coordinator = Mutex::new(());
        let owner = coordinator.lock().await;
        let mut request =
            Box::pin(PendingCommand::new(remote.interrupt_receive.clone()).acquire(&coordinator));
        assert!(matches!(
            request
                .as_mut()
                .poll(&mut Context::from_waker(Waker::noop())),
            Poll::Pending
        ));
        assert!(remote.receive_interrupted());
        drop(request);
        assert!(!remote.receive_interrupted());
        drop(owner);
    }
}

#[cfg(test)]
mod receive_transport_tests {
    use super::*;
    use std::io::{Read, Write};

    #[tokio::test]
    async fn observation_uses_the_scoped_protocol_contract_without_exposing_transport_to_react() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut buffer = [0; 4096];
            let size = socket.read(&mut buffer).unwrap();
            let request = String::from_utf8_lossy(&buffer[..size]).to_lowercase();
            assert!(request.starts_with("get /v1/companion/campaigns"));
            assert!(request.contains("authorization: bearer synthetic-access"));
            assert!(request.contains(&format!("x-companion-protocol: {RELEASE}")));
            let body = r#"{"campaigns":[]}"#;
            write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        });
        let mut remote =
            HttpRemote::new(format!("http://{address}"), format!("http://{address}")).unwrap();
        remote.client = reqwest::Client::new();
        assert!(remote.observe("synthetic-access").await.unwrap().is_empty());
        server.join().unwrap();
    }

    #[tokio::test]
    async fn a_user_command_interrupts_a_stalled_receive_request_promptly() {
        // An unaccepted loopback connection supplies no response. No live service.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let mut remote =
            HttpRemote::new(format!("http://{address}"), format!("http://{address}")).unwrap();
        remote.client = reqwest::Client::new();
        let command = async {
            tokio::time::sleep(Duration::from_millis(30)).await;
            remote.interrupt_receive.store(1, Ordering::SeqCst);
        };
        let (result, ()) = tokio::time::timeout(Duration::from_millis(500), async {
            tokio::join!(remote.observe("synthetic-access"), command)
        })
        .await
        .unwrap();
        assert_eq!(result.unwrap_err(), ReceiveError::Interrupted);
    }
}

#[cfg(test)]
mod submission_transport_tests {
    use super::*;
    use std::io::{Read, Write};
    #[tokio::test]
    async fn queued_commands_interrupt_stalled_receipt_lookups() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let mut remote =
            HttpRemote::new(format!("http://{address}"), format!("http://{address}")).unwrap();
        remote.client = reqwest::Client::new();
        let interrupt = async {
            tokio::time::sleep(Duration::from_millis(30)).await;
            remote.interrupt_receive.store(1, Ordering::SeqCst);
        };
        let (result, ()) = tokio::time::timeout(Duration::from_millis(500), async {
            tokio::join!(remote.receipt("synthetic", "operation-key"), interrupt)
        })
        .await
        .unwrap();
        assert_eq!(result.unwrap_err(), ReceiveError::Interrupted);
    }
    #[tokio::test]
    async fn a_submission_posts_exact_staged_bytes_with_its_operation_key_and_baseline() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let submission = TurnSubmission {
            operation_key: "operation-key-123456".into(),
            campaign_id: "campaign".into(),
            baseline: "campaign:1:2".into(),
            content_hash: "sha256:synthetic".into(),
            filename: "mine.se1".into(),
            size: 11,
        };
        let receipt = SubmissionReceipt {
            submission: submission.clone(),
            file_version_id: "file".into(),
            publication: 2,
        };
        let body = serde_json::to_string(&receipt).unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0u8; 4096];
            loop {
                let n = socket.read(&mut buffer).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buffer[..n]);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                    let length: usize = headers
                        .lines()
                        .find_map(|l| l.strip_prefix("content-length: "))
                        .unwrap()
                        .parse()
                        .unwrap();
                    if bytes.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            let request = String::from_utf8_lossy(&bytes);
            assert!(request.starts_with(
                "POST /v1/companion/campaigns/campaign/submissions/operation-key-123456"
            ));
            assert!(request.contains("campaign:1:2"));
            assert!(request.contains("exact bytes"));
            assert!(request.contains("mine.se1"));
            write!(
                socket,
                "HTTP/1.1 201 Created\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        });
        let mut remote =
            HttpRemote::new(format!("http://{address}"), format!("http://{address}")).unwrap();
        remote.client = reqwest::Client::new();
        assert_eq!(
            remote
                .submit("synthetic-access", &submission, b"exact bytes".to_vec())
                .await
                .unwrap(),
            receipt
        );
        server.join().unwrap();
    }
}
