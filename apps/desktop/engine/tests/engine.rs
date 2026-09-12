use async_trait::async_trait;
use shadow_cloud_companion_engine::{
    ensure_campaign_folder, CampaignFolderError, CampaignIdentity, Command, CommandError,
    CompanionPlatform, CompanionRemote, ConnectionState, CredentialStorage, DeviceCredentials,
    DeviceSessionProfile, DeviceUser, Engine, ExchangeOutcome, Handoff, OnboardingStage,
    RemoteError, SecretVault, SessionState, Theme, RELEASE,
};
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};

struct ApprovedRemote;

#[async_trait]
impl CompanionRemote for ApprovedRemote {
    async fn create_handoff(&self) -> Result<Handoff, RemoteError> {
        Ok(Handoff {
            id: "handoff".into(),
            poll_secret: "poll-secret".into(),
            authorization_url: "https://shadow.example/api/auth/companion?handoff=handoff".into(),
            expires_at: "2026-09-11T20:00:00Z".into(),
        })
    }

    async fn exchange_browser(
        &self,
        _handoff_id: &str,
        _poll_secret: &str,
    ) -> Result<ExchangeOutcome, RemoteError> {
        Ok(ExchangeOutcome::Approved(credentials()))
    }

    async fn exchange_token(&self, _token: &str) -> Result<DeviceCredentials, RemoteError> {
        Ok(credentials())
    }

    async fn refresh(&self, _refresh_token: &str) -> Result<DeviceCredentials, RemoteError> {
        Ok(credentials())
    }

    async fn revoke(&self, _refresh_token: &str) -> Result<(), RemoteError> {
        Ok(())
    }
}

struct RecordingRemote {
    revoked: Arc<Mutex<Vec<String>>>,
}

#[async_trait]
impl CompanionRemote for RecordingRemote {
    async fn create_handoff(&self) -> Result<Handoff, RemoteError> {
        ApprovedRemote.create_handoff().await
    }
    async fn exchange_browser(
        &self,
        id: &str,
        secret: &str,
    ) -> Result<ExchangeOutcome, RemoteError> {
        ApprovedRemote.exchange_browser(id, secret).await
    }
    async fn exchange_token(&self, token: &str) -> Result<DeviceCredentials, RemoteError> {
        ApprovedRemote.exchange_token(token).await
    }
    async fn refresh(&self, token: &str) -> Result<DeviceCredentials, RemoteError> {
        ApprovedRemote.refresh(token).await
    }
    async fn revoke(&self, refresh_token: &str) -> Result<(), RemoteError> {
        self.revoked.lock().unwrap().push(refresh_token.into());
        Ok(())
    }
}

struct OfflineRemote;

#[async_trait]
impl CompanionRemote for OfflineRemote {
    async fn create_handoff(&self) -> Result<Handoff, RemoteError> {
        Err(RemoteError::Offline)
    }

    async fn exchange_browser(
        &self,
        _handoff_id: &str,
        _poll_secret: &str,
    ) -> Result<ExchangeOutcome, RemoteError> {
        Err(RemoteError::Offline)
    }

    async fn exchange_token(&self, _token: &str) -> Result<DeviceCredentials, RemoteError> {
        Err(RemoteError::Offline)
    }

    async fn refresh(&self, _refresh_token: &str) -> Result<DeviceCredentials, RemoteError> {
        Err(RemoteError::Offline)
    }

    async fn revoke(&self, _refresh_token: &str) -> Result<(), RemoteError> {
        Err(RemoteError::Offline)
    }
}

#[derive(Default)]
struct FakePlatform {
    opened: Mutex<Vec<String>>,
    selected: Mutex<Option<PathBuf>>,
}

impl CompanionPlatform for FakePlatform {
    fn open_url(&self, url: &str) -> Result<(), ()> {
        self.opened.lock().unwrap().push(url.into());
        Ok(())
    }

    fn choose_directory(&self) -> Result<Option<PathBuf>, ()> {
        Ok(self.selected.lock().unwrap().clone())
    }
}

#[derive(Default)]
struct FakeVault {
    secret: Mutex<Option<String>>,
}

impl SecretVault for FakeVault {
    fn load(&self) -> Result<Option<String>, ()> {
        Ok(self.secret.lock().unwrap().clone())
    }

    fn store(&self, secret: &str) -> Result<(), ()> {
        *self.secret.lock().unwrap() = Some(secret.into());
        Ok(())
    }

    fn clear(&self) -> Result<(), ()> {
        *self.secret.lock().unwrap() = None;
        Ok(())
    }
}

struct FailingVault;

impl SecretVault for FailingVault {
    fn load(&self) -> Result<Option<String>, ()> {
        Err(())
    }
    fn store(&self, _secret: &str) -> Result<(), ()> {
        Err(())
    }
    fn clear(&self) -> Result<(), ()> {
        Err(())
    }
}

struct RetainingVault {
    secret: Mutex<Option<String>>,
}

struct UnwritableRetainingVault {
    secret: Mutex<Option<String>>,
}

impl SecretVault for UnwritableRetainingVault {
    fn load(&self) -> Result<Option<String>, ()> {
        Ok(self.secret.lock().unwrap().clone())
    }

    fn store(&self, _secret: &str) -> Result<(), ()> {
        Err(())
    }

    fn clear(&self) -> Result<(), ()> {
        Err(())
    }
}

impl SecretVault for RetainingVault {
    fn load(&self) -> Result<Option<String>, ()> {
        Ok(self.secret.lock().unwrap().clone())
    }

    fn store(&self, secret: &str) -> Result<(), ()> {
        *self.secret.lock().unwrap() = Some(secret.into());
        Ok(())
    }

    fn clear(&self) -> Result<(), ()> {
        Err(())
    }
}

fn credentials() -> DeviceCredentials {
    DeviceCredentials {
        access_token: "short-lived-access".into(),
        access_token_expires_at: "2026-09-11T20:05:00Z".into(),
        refresh_token: "device.rotating-refresh-secret".into(),
        device_session: DeviceSessionProfile {
            id: "device".into(),
            expires_at: "2027-03-10T20:00:00Z".into(),
            scopes: vec![
                "campaigns:observe".into(),
                "saves:download".into(),
                "turns:submit".into(),
            ],
            user: DeviceUser {
                id: "user-1".into(),
                email: "solon@example.com".into(),
                display_name: "Solon".into(),
            },
        },
    }
}

#[tokio::test]
async fn browser_handoff_enters_onboarding_without_exposing_credentials_to_sqlite() {
    let temp = tempfile::tempdir().unwrap();
    let database = temp.path().join("companion.sqlite3");
    let platform = Arc::new(FakePlatform::default());
    let vault = Arc::new(FakeVault::default());
    let mut engine = Engine::open(
        &database,
        Arc::new(ApprovedRemote),
        platform.clone(),
        vault.clone(),
    )
    .unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.command(Command::ContinueOnboarding).await.unwrap();

    let waiting = engine.command(Command::StartBrowserSignIn).await.unwrap();
    assert_eq!(waiting.session.state, SessionState::WaitingForBrowser);
    assert_eq!(waiting.onboarding.stage, OnboardingStage::SignIn);
    assert!(!waiting.onboarding.can_send);
    assert_eq!(platform.opened.lock().unwrap().len(), 1);

    engine.poll_browser_sign_in().await.unwrap();
    let signed_in = engine.snapshot();
    assert_eq!(signed_in.session.state, SessionState::SignedIn);
    assert_eq!(
        signed_in.session.credential_storage,
        Some(CredentialStorage::Vault)
    );
    assert_eq!(signed_in.onboarding.stage, OnboardingStage::SignIn);
    assert!(!signed_in.onboarding.can_send);
    // Background polling and session recovery must not undo the user's step.
    assert_eq!(engine.poll_browser_sign_in().await.unwrap(), signed_in);
    assert_eq!(engine.restore_session().await.unwrap(), signed_in);
    let continued = engine.command(Command::ContinueOnboarding).await.unwrap();
    assert_eq!(continued.onboarding.stage, OnboardingStage::CompanionRoot);
    assert_eq!(
        vault.secret.lock().unwrap().as_deref(),
        Some("device.rotating-refresh-secret")
    );
    let sqlite_bytes = fs::read(database).unwrap();
    assert!(!String::from_utf8_lossy(&sqlite_bytes).contains("rotating-refresh-secret"));
}

#[tokio::test]
async fn pasted_token_sign_in_waits_for_continue_including_after_a_completed_setup() {
    let temp = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let platform = Arc::new(FakePlatform::default());
    *platform.selected.lock().unwrap() = Some(root.path().to_path_buf());
    let mut engine = Engine::open(
        &temp.path().join("companion.sqlite3"),
        Arc::new(ApprovedRemote),
        platform,
        Arc::new(FakeVault::default()),
    )
    .unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.command(Command::ContinueOnboarding).await.unwrap();
    let signed_in = engine
        .command(Command::SubmitHandoffToken {
            token: "one-use-token".into(),
        })
        .await
        .unwrap();
    assert_eq!(signed_in.session.state, SessionState::SignedIn);
    assert_eq!(signed_in.onboarding.stage, OnboardingStage::SignIn);
    assert!(!signed_in.onboarding.can_send);
    let continued = engine.command(Command::ContinueOnboarding).await.unwrap();
    assert_eq!(continued.onboarding.stage, OnboardingStage::CompanionRoot);
    let selected_root = engine.command(Command::ChooseCompanionRoot).await.unwrap();
    assert_eq!(
        selected_root.onboarding.stage,
        OnboardingStage::CompanionRoot
    );
    assert!(selected_root.root_path.is_some());
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.command(Command::ContinueOnboarding).await.unwrap();
    let completed = engine.command(Command::CompleteOnboarding).await.unwrap();
    assert!(completed.onboarding.can_send);

    engine.command(Command::SignOut).await.unwrap();
    let reauthenticated = engine
        .command(Command::SubmitHandoffToken {
            token: "another-one-use-token".into(),
        })
        .await
        .unwrap();
    assert_eq!(reauthenticated.session.state, SessionState::SignedIn);
    assert_eq!(reauthenticated.onboarding.stage, OnboardingStage::SignIn);
    assert!(!reauthenticated.onboarding.can_send);
    assert_eq!(engine.restore_session().await.unwrap(), reauthenticated);
    let resumed = engine.command(Command::ContinueOnboarding).await.unwrap();
    assert_eq!(resumed.onboarding.stage, OnboardingStage::Complete);
    assert_eq!(resumed.root_path, completed.root_path);
    assert!(resumed.onboarding.can_send);
}

#[tokio::test]
async fn browser_and_pasted_token_sign_in_require_a_connected_compatible_server() {
    for (protocol, expected) in [
        (Err(()), CommandError::AuthenticationUnavailable),
        (Ok("0.0.0".into()), CommandError::UpdateRequired),
    ] {
        let temp = tempfile::tempdir().unwrap();
        let mut engine = Engine::open(
            &temp.path().join("companion.sqlite3"),
            Arc::new(ApprovedRemote),
            Arc::new(FakePlatform::default()),
            Arc::new(FakeVault::default()),
        )
        .unwrap();
        engine.command(Command::ContinueOnboarding).await.unwrap();
        engine.observe_protocol(protocol);

        assert_eq!(
            engine.command(Command::StartBrowserSignIn).await,
            Err(expected.clone())
        );
        assert_eq!(
            engine
                .command(Command::SubmitHandoffToken {
                    token: "one-use-token".into(),
                })
                .await,
            Err(expected)
        );
        assert_eq!(engine.snapshot().session.state, SessionState::SignedOut);
        assert_eq!(engine.snapshot().onboarding.stage, OnboardingStage::SignIn);
    }
}

#[tokio::test]
async fn an_authenticated_device_cannot_replace_its_session_with_a_new_handoff() {
    let temp = tempfile::tempdir().unwrap();
    let mut engine = Engine::open(
        &temp.path().join("companion.sqlite3"),
        Arc::new(ApprovedRemote),
        Arc::new(FakePlatform::default()),
        Arc::new(FakeVault::default()),
    )
    .unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.command(Command::StartBrowserSignIn).await.unwrap();
    engine.poll_browser_sign_in().await.unwrap();

    assert_eq!(
        engine.command(Command::StartBrowserSignIn).await,
        Err(CommandError::InvalidOnboardingStep)
    );
    assert_eq!(
        engine
            .command(Command::SubmitHandoffToken {
                token: "another-session".into(),
            })
            .await,
        Err(CommandError::InvalidOnboardingStep)
    );
}

#[tokio::test]
async fn setup_steps_can_be_revisited_without_losing_choices_or_enabling_transfers() {
    let temp = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let platform = Arc::new(FakePlatform::default());
    *platform.selected.lock().unwrap() = Some(root.path().to_path_buf());
    let mut engine = Engine::open(
        &temp.path().join("companion.sqlite3"),
        Arc::new(ApprovedRemote),
        platform,
        Arc::new(FakeVault::default()),
    )
    .unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine
        .command(Command::SubmitHandoffToken {
            token: "one-use-token".into(),
        })
        .await
        .unwrap();
    engine.command(Command::ChooseCompanionRoot).await.unwrap();
    engine
        .command(Command::SetAutomaticUploads { enabled: false })
        .await
        .unwrap();
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.command(Command::ContinueOnboarding).await.unwrap();
    let ready = engine.snapshot();
    let steps = vec![
        OnboardingStage::Welcome,
        OnboardingStage::SignIn,
        OnboardingStage::CompanionRoot,
        OnboardingStage::AutomaticUploads,
        OnboardingStage::Review,
    ];

    // Previously reached steps stay available even after moving backwards.
    for stage in &steps {
        let revisited = engine
            .command(Command::NavigateOnboarding {
                stage: stage.clone(),
            })
            .await
            .unwrap();
        assert_eq!(&revisited.onboarding.stage, stage);
        assert_eq!(revisited.onboarding.available_steps, steps);
        assert_eq!(revisited.session, ready.session);
        assert_eq!(revisited.display_name, ready.display_name);
        assert_eq!(revisited.root_path, ready.root_path);
        assert_eq!(revisited.preferences, ready.preferences);
        assert!(!revisited.onboarding.can_send);
        assert!(revisited.read_only);
    }

    assert!(
        engine
            .command(Command::CompleteOnboarding)
            .await
            .unwrap()
            .onboarding
            .can_send
    );
}

#[tokio::test]
async fn revisited_connection_and_root_can_continue_with_the_saved_choices() {
    let temp = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let platform = Arc::new(FakePlatform::default());
    *platform.selected.lock().unwrap() = Some(root.path().to_path_buf());
    let mut engine = Engine::open(
        &temp.path().join("companion.sqlite3"),
        Arc::new(ApprovedRemote),
        platform.clone(),
        Arc::new(FakeVault::default()),
    )
    .unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine
        .command(Command::SubmitHandoffToken {
            token: "one-use-token".into(),
        })
        .await
        .unwrap();
    engine.command(Command::ChooseCompanionRoot).await.unwrap();
    // Neither another authentication request nor another directory pick is needed.
    *platform.selected.lock().unwrap() = None;
    engine.observe_protocol(Err(()));
    engine
        .command(Command::NavigateOnboarding {
            stage: OnboardingStage::SignIn,
        })
        .await
        .unwrap();
    assert_eq!(
        engine
            .command(Command::ContinueOnboarding)
            .await
            .unwrap()
            .onboarding
            .stage,
        OnboardingStage::CompanionRoot,
    );
    assert_eq!(
        engine
            .command(Command::ContinueOnboarding)
            .await
            .unwrap()
            .onboarding
            .stage,
        OnboardingStage::AutomaticUploads,
    );
    assert!(!engine.snapshot().onboarding.can_send);
}

#[tokio::test]
async fn returning_to_welcome_is_not_undone_by_a_pending_browser_approval() {
    let temp = tempfile::tempdir().unwrap();
    let mut engine = Engine::open(
        &temp.path().join("companion.sqlite3"),
        Arc::new(ApprovedRemote),
        Arc::new(FakePlatform::default()),
        Arc::new(FakeVault::default()),
    )
    .unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.command(Command::StartBrowserSignIn).await.unwrap();
    engine
        .command(Command::NavigateOnboarding {
            stage: OnboardingStage::Welcome,
        })
        .await
        .unwrap();

    let approved = engine.poll_browser_sign_in().await.unwrap();
    assert_eq!(approved.session.state, SessionState::SignedIn);
    assert_eq!(approved.onboarding.stage, OnboardingStage::Welcome);
    assert_eq!(
        approved.onboarding.available_steps,
        vec![OnboardingStage::Welcome, OnboardingStage::SignIn]
    );
    assert!(!approved.onboarding.can_send);
}

#[tokio::test]
async fn setup_navigation_rejects_unreached_steps_without_changing_state() {
    let mut engine = Engine::new();
    for stage in [
        OnboardingStage::SignIn,
        OnboardingStage::CompanionRoot,
        OnboardingStage::AutomaticUploads,
        OnboardingStage::Review,
        OnboardingStage::Complete,
    ] {
        let before = engine.snapshot();
        assert_eq!(
            engine.command(Command::NavigateOnboarding { stage }).await,
            Err(CommandError::InvalidOnboardingStep)
        );
        assert_eq!(engine.snapshot(), before);
    }
    engine.command(Command::ContinueOnboarding).await.unwrap();
    assert_eq!(
        engine.command(Command::ContinueOnboarding).await,
        Err(CommandError::InvalidOnboardingStep)
    );
    assert_eq!(
        engine.snapshot().onboarding.available_steps,
        vec![OnboardingStage::Welcome, OnboardingStage::SignIn,]
    );
}

#[tokio::test]
async fn no_campaign_action_is_enabled_until_the_final_onboarding_review() {
    let temp = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let platform = Arc::new(FakePlatform::default());
    *platform.selected.lock().unwrap() = Some(root.path().to_path_buf());
    let mut engine = Engine::open(
        &temp.path().join("companion.sqlite3"),
        Arc::new(ApprovedRemote),
        platform,
        Arc::new(FakeVault::default()),
    )
    .unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.command(Command::StartBrowserSignIn).await.unwrap();
    engine.poll_browser_sign_in().await.unwrap();
    engine.command(Command::ChooseCompanionRoot).await.unwrap();

    let action = || Command::CampaignAction {
        campaign_id: "campaign".into(),
        action: shadow_cloud_companion_engine::CampaignAction::OpenFolder,
    };
    // Having a root does not mean the user has reached Review yet.
    assert_eq!(
        engine
            .command(Command::NavigateOnboarding {
                stage: OnboardingStage::Review
            })
            .await,
        Err(CommandError::InvalidOnboardingStep)
    );
    assert_eq!(
        engine.command(action()).await,
        Err(CommandError::OnboardingIncomplete)
    );
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.command(Command::ContinueOnboarding).await.unwrap();
    assert_eq!(engine.snapshot().onboarding.stage, OnboardingStage::Review);
    assert_eq!(
        engine.command(action()).await,
        Err(CommandError::OnboardingIncomplete)
    );

    let completed = engine.command(Command::CompleteOnboarding).await.unwrap();
    assert!(completed.onboarding.can_send);
    assert!(!completed.read_only);
    assert!(completed.onboarding.available_steps.is_empty());
    assert_eq!(
        engine
            .command(Command::NavigateOnboarding {
                stage: OnboardingStage::Welcome
            })
            .await,
        Err(CommandError::InvalidOnboardingStep)
    );
    assert_eq!(
        engine.command(action()).await,
        Err(CommandError::NotAvailable)
    );
}

#[tokio::test]
async fn an_unavailable_os_vault_uses_memory_only_and_requires_sign_in_after_restart() {
    let temp = tempfile::tempdir().unwrap();
    let database = temp.path().join("companion.sqlite3");
    let platform = Arc::new(FakePlatform::default());
    let mut engine = Engine::open(
        &database,
        Arc::new(ApprovedRemote),
        platform.clone(),
        Arc::new(FailingVault),
    )
    .unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.command(Command::StartBrowserSignIn).await.unwrap();
    engine.poll_browser_sign_in().await.unwrap();
    assert_eq!(
        engine.snapshot().session.credential_storage,
        Some(CredentialStorage::MemoryOnly)
    );
    drop(engine);

    let mut restarted = Engine::open(
        &database,
        Arc::new(ApprovedRemote),
        platform,
        Arc::new(FailingVault),
    )
    .unwrap();
    restarted.observe_protocol(Ok(RELEASE.into()));
    restarted.restore_session().await.unwrap();
    assert_eq!(restarted.snapshot().session.state, SessionState::SignedOut);
}

#[tokio::test]
async fn sign_out_revokes_online_but_preserves_the_root_database_and_save_files() {
    let temp = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let database = temp.path().join("companion.sqlite3");
    let revoked = Arc::new(Mutex::new(Vec::new()));
    let platform = Arc::new(FakePlatform::default());
    *platform.selected.lock().unwrap() = Some(root.path().to_path_buf());
    let vault = Arc::new(FakeVault::default());
    let mut engine = Engine::open(
        &database,
        Arc::new(RecordingRemote {
            revoked: revoked.clone(),
        }),
        platform,
        vault.clone(),
    )
    .unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.command(Command::StartBrowserSignIn).await.unwrap();
    engine.poll_browser_sign_in().await.unwrap();
    engine.command(Command::ChooseCompanionRoot).await.unwrap();
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.command(Command::CompleteOnboarding).await.unwrap();
    let folder = engine
        .ensure_campaign_folder(&CampaignIdentity {
            id: "campaign_01J8Y5QH97FFM2D9M5WJ6R4N8P".into(),
            number: 42,
            name: "Black Glass".into(),
        })
        .unwrap();
    let save = folder.path.join("turn-42.se1");
    fs::write(&save, b"player work").unwrap();

    let signed_out = engine.command(Command::SignOut).await.unwrap();
    let canonical_root = fs::canonicalize(root.path()).unwrap();

    assert_eq!(signed_out.session.state, SessionState::SignedOut);
    assert_eq!(signed_out.root_path.as_deref(), canonical_root.to_str());
    assert_eq!(fs::read(save).unwrap(), b"player work");
    assert!(database.exists());
    assert_eq!(vault.secret.lock().unwrap().as_deref(), None);
    assert_eq!(
        revoked.lock().unwrap().as_slice(),
        ["device.rotating-refresh-secret"]
    );
}

#[cfg(unix)]
#[tokio::test]
async fn sign_out_clears_credentials_even_when_its_sqlite_tombstone_cannot_be_written() {
    use std::os::unix::fs::PermissionsExt;

    let temp = tempfile::tempdir().unwrap();
    let database = temp.path().join("companion.sqlite3");
    let revoked = Arc::new(Mutex::new(Vec::new()));
    let vault = Arc::new(FakeVault::default());
    let mut engine = Engine::open(
        &database,
        Arc::new(RecordingRemote {
            revoked: revoked.clone(),
        }),
        Arc::new(FakePlatform::default()),
        vault.clone(),
    )
    .unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.command(Command::StartBrowserSignIn).await.unwrap();
    engine.poll_browser_sign_in().await.unwrap();
    let mut subscriber = engine.subscribe();
    subscriber.borrow_and_update();

    fs::set_permissions(temp.path(), fs::Permissions::from_mode(0o500)).unwrap();
    let result = engine.command(Command::SignOut).await;
    fs::set_permissions(temp.path(), fs::Permissions::from_mode(0o700)).unwrap();

    assert_eq!(result, Err(CommandError::StorageUnavailable));
    assert_eq!(engine.snapshot().session.state, SessionState::SignedOut);
    assert!(subscriber.has_changed().unwrap());
    assert_eq!(vault.secret.lock().unwrap().as_deref(), None);
    assert_eq!(
        revoked.lock().unwrap().as_slice(),
        ["device.rotating-refresh-secret"]
    );
}

fn reset_command() -> Command {
    serde_json::from_str(r#"{"type":"reset-companion"}"#).unwrap()
}

#[tokio::test]
async fn reset_restarts_setup_and_preferences_but_preserves_campaign_ownership_and_saves() {
    let temp = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let database = temp.path().join("companion.sqlite3");
    let revoked = Arc::new(Mutex::new(Vec::new()));
    let platform = Arc::new(FakePlatform::default());
    *platform.selected.lock().unwrap() = Some(root.path().to_path_buf());
    let vault = Arc::new(FakeVault::default());
    let mut engine = Engine::open(
        &database,
        Arc::new(RecordingRemote {
            revoked: revoked.clone(),
        }),
        platform.clone(),
        vault.clone(),
    )
    .unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine
        .command(Command::SubmitHandoffToken {
            token: "one-use".into(),
        })
        .await
        .unwrap();
    engine.command(Command::ChooseCompanionRoot).await.unwrap();
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.command(Command::CompleteOnboarding).await.unwrap();
    engine
        .command(Command::SetTheme {
            theme: Theme::Light,
        })
        .await
        .unwrap();
    engine
        .command(Command::SetAutomaticUploads { enabled: false })
        .await
        .unwrap();
    engine
        .command(Command::SetPaused { paused: true })
        .await
        .unwrap();
    let identity = CampaignIdentity {
        id: "campaign_01J8Y5QH97FFM2D9M5WJ6R4N8P".into(),
        number: 42,
        name: "Black Glass".into(),
    };
    let folder = engine.ensure_campaign_folder(&identity).unwrap();
    let save = folder.path.join("turn-42.se1");
    fs::write(&save, b"player work").unwrap();
    let marker = folder.path.join(".shadow-cloud-campaign.json");
    let ownership = fs::read(&marker).unwrap();
    let before = engine.snapshot();
    let mut subscriber = engine.subscribe();
    subscriber.borrow_and_update();

    let reset = engine.command(reset_command()).await.unwrap();

    assert_eq!(reset.onboarding.stage, OnboardingStage::Welcome);
    assert_eq!(reset.onboarding.available_steps, [OnboardingStage::Welcome]);
    assert!(!reset.onboarding.can_send);
    assert!(reset.read_only);
    assert!(!reset.paused);
    assert_eq!(reset.session.state, SessionState::SignedOut);
    assert_eq!(reset.display_name, None);
    assert_eq!(reset.root_path, None);
    assert_eq!(reset.preferences.theme, Theme::System);
    assert!(reset.preferences.automatic_uploads);
    assert_eq!(reset.connection, before.connection);
    assert!(reset.revision > before.revision);
    assert!(subscriber.has_changed().unwrap());
    assert_eq!(subscriber.borrow_and_update().clone(), reset);
    assert_eq!(vault.secret.lock().unwrap().as_deref(), None);
    assert_eq!(
        revoked.lock().unwrap().as_slice(),
        ["device.rotating-refresh-secret"]
    );
    assert_eq!(fs::read(&save).unwrap(), b"player work");
    assert_eq!(fs::read(&marker).unwrap(), ownership);
    let connection = rusqlite::Connection::open(&database).unwrap();
    let recorded_folder: String = connection
        .query_row(
            "SELECT path FROM campaign_folders WHERE campaign_id = ?1",
            [&identity.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(PathBuf::from(recorded_folder), folder.path);
    drop(engine);

    let mut restarted = Engine::open(&database, Arc::new(ApprovedRemote), platform, vault).unwrap();
    restarted.observe_protocol(Ok(RELEASE.into()));
    restarted.restore_session().await.unwrap();
    let fresh = restarted.snapshot();
    assert_eq!(fresh.onboarding.stage, OnboardingStage::Welcome);
    assert_eq!(fresh.session.state, SessionState::SignedOut);
    assert_eq!(fresh.root_path, None);
    assert_eq!(fresh.preferences.theme, Theme::System);
    assert!(fresh.preferences.automatic_uploads);
    assert!(!fresh.paused);
    assert_eq!(
        restarted.command(Command::CompleteOnboarding).await,
        Err(CommandError::InvalidOnboardingStep)
    );
    restarted
        .command(Command::ContinueOnboarding)
        .await
        .unwrap();
    restarted
        .command(Command::SubmitHandoffToken {
            token: "new-one-use".into(),
        })
        .await
        .unwrap();
    restarted
        .command(Command::ChooseCompanionRoot)
        .await
        .unwrap();
    assert_eq!(
        restarted.ensure_campaign_folder(&identity).unwrap().path,
        folder.path
    );
    assert!(!restarted.snapshot().onboarding.can_send);
    restarted
        .command(Command::ContinueOnboarding)
        .await
        .unwrap();
    restarted
        .command(Command::ContinueOnboarding)
        .await
        .unwrap();
    let completed = restarted
        .command(Command::CompleteOnboarding)
        .await
        .unwrap();
    assert!(completed.onboarding.can_send);
    assert_eq!(fs::read(save).unwrap(), b"player work");
}

#[tokio::test]
async fn reset_is_available_offline_or_mismatched_and_an_uncleared_vault_cannot_restore() {
    for protocol in [Err(()), Ok("999.0.0".into())] {
        let temp = tempfile::tempdir().unwrap();
        let database = temp.path().join("companion.sqlite3");
        let vault = Arc::new(RetainingVault {
            secret: Mutex::new(Some("stored-refresh".into())),
        });
        let mut engine = Engine::open(
            &database,
            Arc::new(OfflineRemote),
            Arc::new(FakePlatform::default()),
            vault.clone(),
        )
        .unwrap();
        engine.observe_protocol(protocol);

        let reset = engine.command(reset_command()).await.unwrap();
        assert_eq!(reset.session.state, SessionState::SignedOut);
        assert_eq!(reset.onboarding.stage, OnboardingStage::Welcome);
        assert!(!reset.onboarding.can_send);
        drop(engine);

        let mut restarted = Engine::open(
            &database,
            Arc::new(ApprovedRemote),
            Arc::new(FakePlatform::default()),
            vault.clone(),
        )
        .unwrap();
        restarted.observe_protocol(Ok(RELEASE.into()));
        restarted.restore_session().await.unwrap();
        assert_eq!(restarted.snapshot().session.state, SessionState::SignedOut);
        assert_eq!(
            restarted.snapshot().onboarding.available_steps,
            [OnboardingStage::Welcome]
        );
        assert_eq!(
            vault.secret.lock().unwrap().as_deref(),
            Some("stored-refresh")
        );
    }
}

#[tokio::test]
async fn reset_cancels_a_pending_browser_handoff() {
    let temp = tempfile::tempdir().unwrap();
    let mut engine = Engine::open(
        &temp.path().join("companion.sqlite3"),
        Arc::new(ApprovedRemote),
        Arc::new(FakePlatform::default()),
        Arc::new(FakeVault::default()),
    )
    .unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.command(Command::StartBrowserSignIn).await.unwrap();

    let reset = engine.command(reset_command()).await.unwrap();
    assert_eq!(reset.session.authorization_url, None);
    assert_eq!(reset.session.handoff_expires_at, None);
    assert_eq!(engine.poll_browser_sign_in().await.unwrap(), reset);
}

#[tokio::test]
async fn a_failed_reset_rolls_back_settings_and_leaves_the_session_usable_for_retry() {
    let temp = tempfile::tempdir().unwrap();
    let database = temp.path().join("companion.sqlite3");
    let revoked = Arc::new(Mutex::new(Vec::new()));
    let vault = Arc::new(FakeVault::default());
    let mut engine = Engine::open(
        &database,
        Arc::new(RecordingRemote {
            revoked: revoked.clone(),
        }),
        Arc::new(FakePlatform::default()),
        vault.clone(),
    )
    .unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine
        .command(Command::SubmitHandoffToken {
            token: "one-use".into(),
        })
        .await
        .unwrap();
    engine
        .command(Command::SetTheme {
            theme: Theme::Light,
        })
        .await
        .unwrap();
    let before = engine.snapshot();
    let connection = rusqlite::Connection::open(&database).unwrap();
    connection
        .execute_batch(
            "CREATE TRIGGER reject_reset BEFORE INSERT ON settings
         WHEN NEW.key = 'session_restore_enabled' AND NEW.value = 'false'
         BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;",
        )
        .unwrap();

    assert_eq!(
        engine.command(reset_command()).await,
        Err(CommandError::StorageUnavailable)
    );

    assert_eq!(engine.snapshot(), before);
    assert!(revoked.lock().unwrap().is_empty());
    assert!(vault.secret.lock().unwrap().is_some());
    let theme: String = connection
        .query_row(
            "SELECT value FROM settings WHERE key = 'theme'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(theme, "light");
    let restore: String = connection
        .query_row(
            "SELECT value FROM settings WHERE key = 'session_restore_enabled'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(restore, "true");
    connection
        .execute_batch("DROP TRIGGER reject_reset")
        .unwrap();
    assert_eq!(
        engine
            .command(reset_command())
            .await
            .unwrap()
            .onboarding
            .stage,
        OnboardingStage::Welcome
    );
}

#[tokio::test]
async fn an_offline_startup_preserves_the_vault_session_for_a_later_retry() {
    let temp = tempfile::tempdir().unwrap();
    let database = temp.path().join("companion.sqlite3");
    let vault = Arc::new(FakeVault::default());
    *vault.secret.lock().unwrap() = Some("stored-refresh".into());
    let mut offline = Engine::open(
        &database,
        Arc::new(OfflineRemote),
        Arc::new(FakePlatform::default()),
        vault.clone(),
    )
    .unwrap();

    offline.restore_session().await.unwrap();

    assert_eq!(offline.snapshot().session.state, SessionState::SignedOut);
    assert_eq!(
        vault.secret.lock().unwrap().as_deref(),
        Some("stored-refresh")
    );
    drop(offline);

    let mut online = Engine::open(
        &database,
        Arc::new(ApprovedRemote),
        Arc::new(FakePlatform::default()),
        vault,
    )
    .unwrap();
    online.restore_session().await.unwrap();
    assert_eq!(online.snapshot().session.state, SessionState::SignedIn);
}

#[tokio::test]
async fn sign_out_revokes_a_vault_session_even_before_startup_restore_finishes() {
    let temp = tempfile::tempdir().unwrap();
    let revoked = Arc::new(Mutex::new(Vec::new()));
    let vault = Arc::new(FakeVault::default());
    *vault.secret.lock().unwrap() = Some("stored-refresh".into());
    let mut engine = Engine::open(
        &temp.path().join("companion.sqlite3"),
        Arc::new(RecordingRemote {
            revoked: revoked.clone(),
        }),
        Arc::new(FakePlatform::default()),
        vault.clone(),
    )
    .unwrap();

    engine.command(Command::SignOut).await.unwrap();

    assert_eq!(revoked.lock().unwrap().as_slice(), ["stored-refresh"]);
    assert_eq!(vault.secret.lock().unwrap().as_deref(), None);
}

#[tokio::test]
async fn failed_vault_deletion_after_sign_out_cannot_restore_the_session() {
    let temp = tempfile::tempdir().unwrap();
    let database = temp.path().join("companion.sqlite3");
    let vault = Arc::new(RetainingVault {
        secret: Mutex::new(Some("stored-refresh".into())),
    });
    let mut offline = Engine::open(
        &database,
        Arc::new(OfflineRemote),
        Arc::new(FakePlatform::default()),
        vault.clone(),
    )
    .unwrap();

    offline.command(Command::SignOut).await.unwrap();
    assert_eq!(offline.snapshot().session.state, SessionState::SignedOut);
    drop(offline);

    let mut online = Engine::open(
        &database,
        Arc::new(ApprovedRemote),
        Arc::new(FakePlatform::default()),
        vault.clone(),
    )
    .unwrap();
    online.observe_protocol(Ok(RELEASE.into()));
    online.restore_session().await.unwrap();

    assert_eq!(online.snapshot().session.state, SessionState::SignedOut);
    assert_eq!(
        vault.secret.lock().unwrap().as_deref(),
        Some("stored-refresh")
    );
}

#[tokio::test]
async fn memory_only_reauthentication_never_reenables_an_old_vault_session() {
    let temp = tempfile::tempdir().unwrap();
    let database = temp.path().join("companion.sqlite3");
    let vault = Arc::new(UnwritableRetainingVault {
        secret: Mutex::new(Some("old-stored-refresh".into())),
    });
    let mut engine = Engine::open(
        &database,
        Arc::new(ApprovedRemote),
        Arc::new(FakePlatform::default()),
        vault.clone(),
    )
    .unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.command(Command::SignOut).await.unwrap();

    let memory_only = engine
        .command(Command::SubmitHandoffToken {
            token: "new-memory-only-session".into(),
        })
        .await
        .unwrap();
    assert_eq!(
        memory_only.session.credential_storage,
        Some(CredentialStorage::MemoryOnly)
    );
    drop(engine);

    let mut restarted = Engine::open(
        &database,
        Arc::new(ApprovedRemote),
        Arc::new(FakePlatform::default()),
        vault,
    )
    .unwrap();
    restarted.observe_protocol(Ok(RELEASE.into()));
    restarted.restore_session().await.unwrap();

    assert_eq!(restarted.snapshot().session.state, SessionState::SignedOut);
}

#[tokio::test]
async fn durable_non_secret_onboarding_state_is_recovered_with_a_vault_session() {
    let temp = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let database = temp.path().join("companion.sqlite3");
    let platform = Arc::new(FakePlatform::default());
    *platform.selected.lock().unwrap() = Some(root.path().to_path_buf());
    let vault = Arc::new(FakeVault::default());
    let mut engine = Engine::open(
        &database,
        Arc::new(ApprovedRemote),
        platform.clone(),
        vault.clone(),
    )
    .unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.command(Command::StartBrowserSignIn).await.unwrap();
    engine.poll_browser_sign_in().await.unwrap();
    engine.command(Command::ChooseCompanionRoot).await.unwrap();
    engine
        .command(Command::SetTheme {
            theme: Theme::Light,
        })
        .await
        .unwrap();
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.command(Command::CompleteOnboarding).await.unwrap();
    drop(engine);

    let mut restarted = Engine::open(&database, Arc::new(ApprovedRemote), platform, vault).unwrap();
    restarted.observe_protocol(Ok(RELEASE.into()));
    let restored = restarted.restore_session().await.unwrap();
    let canonical_root = fs::canonicalize(root.path()).unwrap();

    assert_eq!(restored.session.state, SessionState::SignedIn);
    assert_eq!(restored.onboarding.stage, OnboardingStage::Complete);
    assert!(restored.onboarding.can_send);
    assert_eq!(restored.root_path.as_deref(), canonical_root.to_str());
    assert_eq!(restored.preferences.theme, Theme::Light);
}

#[cfg(unix)]
#[test]
fn the_sqlite_file_is_restricted_to_the_current_user() {
    use std::os::unix::fs::PermissionsExt;

    let temp = tempfile::tempdir().unwrap();
    let database = temp.path().join("state").join("companion.sqlite3");
    let _engine = Engine::open(
        &database,
        Arc::new(ApprovedRemote),
        Arc::new(FakePlatform::default()),
        Arc::new(FakeVault::default()),
    )
    .unwrap();

    assert_eq!(
        fs::metadata(&database).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert_eq!(
        fs::metadata(database.parent().unwrap())
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
}

#[test]
fn unsafe_server_names_are_rejected_before_a_path_is_formed() {
    for name in ["../Black Glass", "CON.txt", "nul.save"] {
        let root = tempfile::tempdir().unwrap();
        let identity = CampaignIdentity {
            id: "campaign_01J8Y5QH97FFM2D9M5WJ6R4N8P".into(),
            number: 42,
            name: name.into(),
        };

        assert_eq!(
            ensure_campaign_folder(root.path(), &identity),
            Err(CampaignFolderError::UnsafeCampaignName),
            "{name} must be rejected on every supported platform"
        );
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
    }
}

#[test]
fn campaign_folders_are_created_with_only_the_complete_immutable_marker() {
    let root = tempfile::tempdir().unwrap();
    let identity = CampaignIdentity {
        id: "campaign_01J8Y5QH97FFM2D9M5WJ6R4N8P".into(),
        number: 42,
        name: "Black Glass".into(),
    };

    let folder = ensure_campaign_folder(root.path(), &identity).unwrap();
    let canonical_root = fs::canonicalize(root.path()).unwrap();
    assert_eq!(folder.path.parent(), Some(canonical_root.as_path()));
    assert!(folder
        .path
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("42 - Black Glass"));
    let marker = fs::read_to_string(folder.path.join(".shadow-cloud-campaign.json")).unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&marker).unwrap(),
        serde_json::json!({
            "schema": 1,
            "service": "shadow-cloud",
            "campaignId": identity.id,
        })
    );
}

#[test]
fn an_existing_unowned_campaign_name_fails_without_adoption_or_renaming() {
    let template = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let identity = CampaignIdentity {
        id: "campaign_01J8Y5QH97FFM2D9M5WJ6R4N8P".into(),
        number: 42,
        name: "Black Glass".into(),
    };
    let expected_name = ensure_campaign_folder(template.path(), &identity)
        .unwrap()
        .path
        .file_name()
        .unwrap()
        .to_owned();
    let unrelated = root.path().join(expected_name);
    fs::create_dir(&unrelated).unwrap();
    fs::write(unrelated.join("player-save.se1"), b"do not touch").unwrap();

    assert_eq!(
        ensure_campaign_folder(root.path(), &identity),
        Err(CampaignFolderError::NameConflict)
    );
    assert_eq!(
        fs::read(unrelated.join("player-save.se1")).unwrap(),
        b"do not touch"
    );
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
}

#[cfg(unix)]
#[test]
fn a_symlinked_campaign_path_is_rejected_before_following_it() {
    use std::os::unix::fs::symlink;

    let template = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let identity = CampaignIdentity {
        id: "campaign_01J8Y5QH97FFM2D9M5WJ6R4N8P".into(),
        number: 42,
        name: "Black Glass".into(),
    };
    let expected_name = ensure_campaign_folder(template.path(), &identity)
        .unwrap()
        .path
        .file_name()
        .unwrap()
        .to_owned();
    symlink(outside.path(), root.path().join(expected_name)).unwrap();

    assert_eq!(
        ensure_campaign_folder(root.path(), &identity),
        Err(CampaignFolderError::PathEscape)
    );
    assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
}

#[test]
fn a_moved_campaign_folder_is_rediscovered_only_by_its_complete_marker() {
    let root = tempfile::tempdir().unwrap();
    let identity = CampaignIdentity {
        id: "campaign_01J8Y5QH97FFM2D9M5WJ6R4N8P".into(),
        number: 42,
        name: "Black Glass".into(),
    };
    let created = ensure_campaign_folder(root.path(), &identity).unwrap();
    let moved = root.path().join("my moved Campaign folder");
    fs::rename(created.path, &moved).unwrap();

    let recovered = ensure_campaign_folder(root.path(), &identity).unwrap();

    assert!(recovered.recovered);
    assert_eq!(recovered.path, fs::canonicalize(moved).unwrap());
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
}

#[test]
fn an_existing_marker_is_recovered_when_renamed_campaign_metadata_is_not_path_safe() {
    let root = tempfile::tempdir().unwrap();
    let original = CampaignIdentity {
        id: "campaign_01J8Y5QH97FFM2D9M5WJ6R4N8P".into(),
        number: 42,
        name: "Black Glass".into(),
    };
    let created = ensure_campaign_folder(root.path(), &original).unwrap();
    let renamed = CampaignIdentity {
        id: original.id,
        number: 42,
        name: "Black: Glass".into(),
    };

    let recovered = ensure_campaign_folder(root.path(), &renamed).unwrap();

    assert!(recovered.recovered);
    assert_eq!(recovered.path, created.path);
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
}

#[tokio::test]
async fn exact_protocol_match_is_required_before_the_companion_can_connect() {
    let mut engine = Engine::new();
    assert_eq!(
        engine.snapshot().connection.state,
        ConnectionState::Checking
    );

    engine.observe_protocol(Ok("0.0.0".into()));
    let mismatch = engine.snapshot();
    assert_eq!(mismatch.connection.state, ConnectionState::UpdateRequired);
    assert!(mismatch.read_only);
    assert_eq!(
        mismatch.connection.server_protocol_version.as_deref(),
        Some("0.0.0")
    );

    // Read-only protection does not lock the player out of interface preferences.
    engine
        .command(Command::SetTheme {
            theme: Theme::Light,
        })
        .await
        .unwrap();
    assert_eq!(engine.snapshot().preferences.theme, Theme::Light);
    assert_eq!(
        engine.snapshot().connection.state,
        ConnectionState::UpdateRequired
    );

    engine.observe_protocol(Ok(RELEASE.into()));
    assert_eq!(
        engine.snapshot().connection.state,
        ConnectionState::Connected
    );
    assert!(engine.snapshot().read_only);
}

#[tokio::test]
async fn subscriptions_replay_the_latest_revision_and_coalesce_unread_changes() {
    let mut engine = Engine::new();
    let mut subscriber = engine.subscribe();
    assert_eq!(subscriber.borrow_and_update().revision, 0);

    engine
        .command(Command::SetTheme { theme: Theme::Dark })
        .await
        .unwrap();
    engine
        .command(Command::SetPaused { paused: true })
        .await
        .unwrap();
    assert!(subscriber.has_changed().unwrap());
    let latest = subscriber.borrow_and_update().clone();
    assert_eq!(latest.revision, 2);
    assert_eq!(latest.preferences.theme, Theme::Dark);
    assert!(latest.paused);
    assert!(!subscriber.has_changed().unwrap());

    // A window recreated after these changes receives current state, not a stale initial view.
    assert_eq!(engine.subscribe().borrow().revision, 2);
    engine
        .command(Command::SetPaused { paused: true })
        .await
        .unwrap();
    assert!(!subscriber.has_changed().unwrap());
}

#[tokio::test]
async fn a_failed_connection_does_not_clear_a_known_protocol_mismatch_or_player_preferences() {
    use shadow_cloud_companion_engine::CommandError;
    let mut engine = Engine::new();
    engine
        .command(Command::SetPaused { paused: true })
        .await
        .unwrap();
    engine
        .command(Command::SetAutomaticUploads { enabled: false })
        .await
        .unwrap();
    engine.observe_protocol(Ok("0.0.0".into()));
    engine.observe_protocol(Err(()));
    let before = engine.snapshot();
    assert!(before.read_only);
    assert!(!before.connection.reachable);
    assert!(before.paused);
    assert!(!before.preferences.automatic_uploads);
    assert_eq!(
        engine.command(Command::SetPaused { paused: false }).await,
        Err(CommandError::UpdateRequired)
    );
    assert_eq!(
        engine
            .command(Command::SetAutomaticUploads { enabled: true })
            .await,
        Err(CommandError::UpdateRequired)
    );
    assert_eq!(engine.snapshot(), before);
    engine.observe_protocol(Ok(RELEASE.into()));
    assert!(engine.snapshot().connection.reachable);
    assert!(engine.snapshot().paused);
    assert!(!engine.snapshot().preferences.automatic_uploads);
}

#[test]
fn typed_commands_reject_unknown_fields_and_never_offer_force_send() {
    for command in [
        r#"{"type":"force-send","campaignId":"campaign"}"#,
        r#"{"type":"set-theme","theme":"dark","token":"secret"}"#,
        r#"{"type":"set-paused","paused":"false"}"#,
    ] {
        assert!(serde_json::from_str::<Command>(command).is_err());
    }
}

#[derive(Default)]
struct PublicationRemote {
    offline_observe: std::sync::atomic::AtomicBool,
    interrupted: std::sync::atomic::AtomicBool,
    during_observe: Mutex<Option<Box<dyn FnOnce() + Send>>>,
    offline_submission_once: std::sync::atomic::AtomicBool,
    submission_mismatch: std::sync::atomic::AtomicBool,
    submitted_keys: Mutex<Vec<String>>,

    turn_revision: std::sync::atomic::AtomicU32,
    switch_account: std::sync::atomic::AtomicBool,
    can_submit: std::sync::atomic::AtomicBool,
    lose_submission_response: std::sync::atomic::AtomicBool,
    dispatches: std::sync::atomic::AtomicU32,
    receipts:
        Mutex<std::collections::HashMap<String, shadow_cloud_companion_engine::SubmissionReceipt>>,
    publications_unauthorized_once: std::sync::atomic::AtomicBool,
    download_unauthorized_once: std::sync::atomic::AtomicBool,
    expired: std::sync::atomic::AtomicBool,
    revoked: std::sync::atomic::AtomicBool,
    refreshed: std::sync::atomic::AtomicU32,
    during_download: Mutex<Option<Box<dyn FnOnce() + Send>>>,
    saves: Mutex<Vec<(shadow_cloud_companion_engine::SavePublication, Vec<u8>)>>,
}
impl PublicationRemote {
    fn publish(&self, content: &[u8]) {
        use sha2::{Digest, Sha256};
        let mut saves = self.saves.lock().unwrap();
        let publication = saves.len() as u32 + 1;
        saves.push((
            shadow_cloud_companion_engine::SavePublication {
                publication,
                file_version_id: format!("file-{publication}"),
                content_revision: 0,
                content_hash: format!("sha256:{:x}", Sha256::digest(content)),
                size: content.len() as u64,
                filename: "turn.se1".into(),
                published_at: "2026-09-12T12:00:00Z".into(),
            },
            content.to_vec(),
        ));
    }
}
#[async_trait]
impl CompanionRemote for PublicationRemote {
    fn receive_interrupted(&self) -> bool {
        self.interrupted.load(std::sync::atomic::Ordering::SeqCst)
    }
    async fn submit(
        &self,
        _: &str,
        submission: &shadow_cloud_companion_engine::TurnSubmission,
        bytes: Vec<u8>,
    ) -> Result<
        shadow_cloud_companion_engine::SubmissionReceipt,
        shadow_cloud_companion_engine::ReceiveError,
    > {
        use std::sync::atomic::Ordering;
        self.dispatches.fetch_add(1, Ordering::SeqCst);
        self.submitted_keys
            .lock()
            .unwrap()
            .push(submission.operation_key.clone());
        if self.submission_mismatch.load(Ordering::SeqCst) {
            return Err(shadow_cloud_companion_engine::ReceiveError::UpdateRequired);
        }
        if self.offline_submission_once.swap(false, Ordering::SeqCst) {
            return Err(shadow_cloud_companion_engine::ReceiveError::Offline);
        }
        let mut receipts = self.receipts.lock().unwrap();
        if let Some(receipt) = receipts.get(&submission.operation_key) {
            return Ok(receipt.clone());
        }
        assert_eq!(bytes.len() as u64, submission.size);
        self.publish(&bytes);
        let save = self.saves.lock().unwrap().last().unwrap().0.clone();
        let receipt = shadow_cloud_companion_engine::SubmissionReceipt {
            submission: submission.clone(),
            file_version_id: save.file_version_id,
            publication: save.publication,
        };
        receipts.insert(submission.operation_key.clone(), receipt.clone());
        if self.lose_submission_response.swap(false, Ordering::SeqCst) {
            return Err(shadow_cloud_companion_engine::ReceiveError::Offline);
        }
        Ok(receipt)
    }
    async fn receipt(
        &self,
        _: &str,
        key: &str,
    ) -> Result<
        Option<shadow_cloud_companion_engine::SubmissionReceipt>,
        shadow_cloud_companion_engine::ReceiveError,
    > {
        Ok(self.receipts.lock().unwrap().get(key).cloned())
    }

    async fn create_handoff(&self) -> Result<Handoff, RemoteError> {
        ApprovedRemote.create_handoff().await
    }
    async fn exchange_browser(
        &self,
        id: &str,
        secret: &str,
    ) -> Result<ExchangeOutcome, RemoteError> {
        ApprovedRemote.exchange_browser(id, secret).await
    }
    async fn exchange_token(&self, token: &str) -> Result<DeviceCredentials, RemoteError> {
        {
            let mut credentials = ApprovedRemote.exchange_token(token).await?;
            if self
                .switch_account
                .load(std::sync::atomic::Ordering::SeqCst)
            {
                credentials.device_session.user.id = "other-account".into();
            }
            Ok(credentials)
        }
    }
    async fn refresh(&self, token: &str) -> Result<DeviceCredentials, RemoteError> {
        if self.revoked.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(RemoteError::Rejected);
        }
        self.expired
            .store(false, std::sync::atomic::Ordering::SeqCst);
        self.refreshed
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        ApprovedRemote.refresh(token).await
    }
    async fn revoke(&self, token: &str) -> Result<(), RemoteError> {
        ApprovedRemote.revoke(token).await
    }
    async fn observe(
        &self,
        _: &str,
    ) -> Result<
        Vec<shadow_cloud_companion_engine::ObservedCampaign>,
        shadow_cloud_companion_engine::ReceiveError,
    > {
        if self.expired.load(std::sync::atomic::Ordering::SeqCst)
            || self.revoked.load(std::sync::atomic::Ordering::SeqCst)
        {
            return Err(shadow_cloud_companion_engine::ReceiveError::Unauthorized);
        }
        let action = self.during_observe.lock().unwrap().take();
        if let Some(action) = action {
            action();
        }
        if self
            .offline_observe
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            return Err(shadow_cloud_companion_engine::ReceiveError::Offline);
        }
        Ok(vec![shadow_cloud_companion_engine::ObservedCampaign {
            baseline: format!(
                "baseline-{}:{}",
                self.saves.lock().unwrap().len(),
                self.turn_revision.load(std::sync::atomic::Ordering::SeqCst)
            ),
            can_submit: self.can_submit.load(std::sync::atomic::Ordering::SeqCst),
            id: "campaign-1".into(),
            number: 42,
            name: "Campaign".into(),
            round: 1,
            active_lord: "Solon".into(),
            turn_started_at: None,
            current: self.saves.lock().unwrap().last().map(|s| s.0.clone()),
        }])
    }
    async fn publications(
        &self,
        _: &str,
        _: &str,
        after: u32,
    ) -> Result<
        shadow_cloud_companion_engine::PublicationPage,
        shadow_cloud_companion_engine::ReceiveError,
    > {
        if self
            .publications_unauthorized_once
            .swap(false, std::sync::atomic::Ordering::SeqCst)
        {
            return Err(shadow_cloud_companion_engine::ReceiveError::Unauthorized);
        }
        let saves = self.saves.lock().unwrap();
        Ok(shadow_cloud_companion_engine::PublicationPage {
            current: saves.last().map(|s| s.0.clone()),
            publications: saves
                .iter()
                .filter(|s| s.0.publication > after)
                .take(100)
                .map(|s| s.0.clone())
                .collect(),
        })
    }
    async fn download(
        &self,
        _: &str,
        _: &str,
        save: &shadow_cloud_companion_engine::SavePublication,
    ) -> Result<Vec<u8>, shadow_cloud_companion_engine::ReceiveError> {
        if self
            .download_unauthorized_once
            .swap(false, std::sync::atomic::Ordering::SeqCst)
        {
            return Err(shadow_cloud_companion_engine::ReceiveError::Unauthorized);
        }
        let bytes = self
            .saves
            .lock()
            .unwrap()
            .iter()
            .find(|s| &s.0 == save)
            .map(|s| s.1.clone())
            .ok_or(shadow_cloud_companion_engine::ReceiveError::SaveChanged);
        if let Some(action) = self.during_download.lock().unwrap().take() {
            action();
        }
        bytes
    }
}

async fn receiving_engine(
    root: &std::path::Path,
    database: &std::path::Path,
    remote: Arc<PublicationRemote>,
    vault: Arc<FakeVault>,
) -> Engine {
    let mut engine = Engine::open(
        database,
        remote,
        Arc::new(FakePlatform {
            selected: Mutex::new(Some(root.into())),
            ..Default::default()
        }),
        vault,
    )
    .unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine
        .command(Command::SubmitHandoffToken {
            token: "token".into(),
        })
        .await
        .unwrap();
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.command(Command::ChooseCompanionRoot).await.unwrap();
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.command(Command::CompleteOnboarding).await.unwrap();
    engine
}
fn received_files(root: &std::path::Path) -> Vec<Vec<u8>> {
    let mut contents = Vec::new();
    for entry in fs::read_dir(root).unwrap() {
        let folder = entry.unwrap().path();
        if folder.is_dir() {
            for file in fs::read_dir(folder).unwrap() {
                let path = file.unwrap().path();
                if path.extension().is_some_and(|e| e == "se1") {
                    contents.push(fs::read(path).unwrap());
                }
            }
        }
    }
    contents.sort();
    contents
}
#[tokio::test]
async fn activation_receives_only_current_then_catches_every_future_publication_after_restart() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let db = temp.path().join("state/companion.sqlite3");
    let remote = Arc::new(PublicationRemote::default());
    let vault = Arc::new(FakeVault::default());
    remote.publish(b"old");
    remote.publish(b"current");
    let mut engine = receiving_engine(&root, &db, remote.clone(), vault.clone()).await;
    engine.reconcile().await.unwrap();
    assert_eq!(received_files(&root), vec![b"current".to_vec()]);
    drop(engine);
    remote.publish(b"third");
    remote.publish(b"fourth");
    let mut restarted =
        Engine::open(&db, remote, Arc::new(FakePlatform::default()), vault).unwrap();
    restarted.observe_protocol(Ok(RELEASE.into()));
    restarted.restore_session().await.unwrap();
    let snapshot = restarted.reconcile().await.unwrap();
    assert_eq!(snapshot.campaigns[0].status_label, "Synchronized");
    assert_eq!(
        received_files(&root),
        vec![b"current".to_vec(), b"fourth".to_vec(), b"third".to_vec()]
    );
}

#[tokio::test]
async fn identical_publications_share_received_contents_and_deletion_requires_explicit_redownload()
{
    use shadow_cloud_companion_engine::CampaignAction;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let remote = Arc::new(PublicationRemote::default());
    remote.publish(b"same");
    let mut engine = receiving_engine(
        &root,
        &temp.path().join("state/db"),
        remote.clone(),
        Arc::new(FakeVault::default()),
    )
    .await;
    engine.reconcile().await.unwrap();
    let folder = fs::read_dir(&root).unwrap().next().unwrap().unwrap().path();
    fs::rename(folder.join("turn.se1"), folder.join("renamed.se1")).unwrap();
    remote.publish(b"same");
    engine.reconcile().await.unwrap();
    assert_eq!(received_files(&root), vec![b"same".to_vec()]);
    fs::remove_file(folder.join("renamed.se1")).unwrap();
    let snapshot = engine.reconcile().await.unwrap();
    assert!(received_files(&root).is_empty());
    assert!(snapshot.campaigns[0]
        .actions
        .contains(&CampaignAction::RedownloadCurrent));
    engine
        .command(Command::CampaignAction {
            campaign_id: "campaign-1".into(),
            action: CampaignAction::RedownloadCurrent,
        })
        .await
        .unwrap();
    assert_eq!(received_files(&root), vec![b"same".to_vec()]);
    remote.publish(b"new");
    engine.reconcile().await.unwrap();
    fs::remove_file(folder.join("turn.se1")).unwrap();
    engine.reconcile().await.unwrap();
    assert_eq!(received_files(&root), vec![b"new".to_vec()]);
}

#[tokio::test]
async fn a_failed_cursor_commit_recovers_published_files_without_duplicates_or_skipping_later_turns(
) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let db = temp.path().join("state/db");
    let remote = Arc::new(PublicationRemote::default());
    let vault = Arc::new(FakeVault::default());
    remote.publish(b"first");
    let mut engine = receiving_engine(&root, &db, remote.clone(), vault.clone()).await;
    let database = rusqlite::Connection::open(&db).unwrap();
    database.execute_batch("CREATE TRIGGER fail_cursor BEFORE UPDATE OF cursor ON receive_campaigns BEGIN SELECT RAISE(ABORT,'disk unavailable'); END;").unwrap();
    let snapshot = engine.reconcile().await.unwrap();
    assert_eq!(
        snapshot.campaigns[0].status_label,
        "Receive needs attention"
    );
    assert_eq!(received_files(&root), vec![b"first".to_vec()]);
    drop(engine);
    database.execute_batch("DROP TRIGGER fail_cursor;").unwrap();
    remote.publish(b"second");
    let mut engine = Engine::open(&db, remote, Arc::new(FakePlatform::default()), vault).unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.restore_session().await.unwrap();
    engine.reconcile().await.unwrap();
    assert_eq!(
        received_files(&root),
        vec![b"first".to_vec(), b"second".to_vec()]
    );
}

#[tokio::test]
async fn receiving_preserves_filename_collisions_and_catches_paused_publications_without_recreating_missing_folders(
) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let folder = ensure_campaign_folder(
        &root,
        &CampaignIdentity {
            id: "campaign-1".into(),
            number: 42,
            name: "Campaign".into(),
        },
    )
    .unwrap()
    .path;
    fs::write(folder.join("turn.se1"), b"local work").unwrap();
    let remote = Arc::new(PublicationRemote::default());
    remote.publish(b"first");
    let mut engine = receiving_engine(
        &root,
        &temp.path().join("state/db"),
        remote.clone(),
        Arc::new(FakeVault::default()),
    )
    .await;
    engine
        .command(Command::SetPaused { paused: true })
        .await
        .unwrap();
    engine.reconcile().await.unwrap();
    remote.publish(b"second");
    engine.reconcile().await.unwrap();
    assert_eq!(received_files(&root), vec![b"local work".to_vec()]);
    engine
        .command(Command::SetPaused { paused: false })
        .await
        .unwrap();
    engine.reconcile().await.unwrap();
    assert_eq!(
        received_files(&root),
        vec![
            b"first".to_vec(),
            b"local work".to_vec(),
            b"second".to_vec()
        ]
    );
    let snapshot = engine.reconcile().await.unwrap();
    engine
        .command(Command::CandidateAction {
            campaign_id: "campaign-1".into(),
            content_hash: snapshot.campaigns[0].candidates[0].content_hash.clone(),
            action: shadow_cloud_companion_engine::CandidateAction::Ignore,
        })
        .await
        .unwrap();
    let moved = root.join("moved");
    fs::rename(&folder, &moved).unwrap();
    remote.publish(b"third");
    engine.reconcile().await.unwrap();
    assert!(received_files(&root).contains(&b"third".to_vec()));
    fs::rename(&moved, temp.path().join("outside")).unwrap();
    remote.publish(b"fourth");
    assert_eq!(
        engine.reconcile().await.unwrap().campaigns[0].status_label,
        "Receive needs attention"
    );
    assert!(received_files(&root).is_empty());
}

#[tokio::test]
async fn corrupt_downloads_never_become_visible_and_retry_does_not_skip_them() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let remote = Arc::new(PublicationRemote::default());
    remote.publish(b"first");
    let mut engine = receiving_engine(
        &root,
        &temp.path().join("state/db"),
        remote.clone(),
        Arc::new(FakeVault::default()),
    )
    .await;
    remote.saves.lock().unwrap()[0].1 = b"wrong".to_vec();
    assert_eq!(
        engine.reconcile().await.unwrap().campaigns[0].status_label,
        "Receive needs attention"
    );
    assert!(received_files(&root).is_empty());
    remote.saves.lock().unwrap()[0].1 = b"first".to_vec();
    remote.publish(b"second");
    engine.reconcile().await.unwrap();
    assert_eq!(
        received_files(&root),
        vec![b"first".to_vec(), b"second".to_vec()]
    );
}

#[cfg(unix)]
#[tokio::test]
async fn folder_substitution_during_download_cannot_write_outside_the_owned_campaign() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let outside = temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    let remote = Arc::new(PublicationRemote::default());
    remote.publish(b"first");
    let mut engine = receiving_engine(
        &root,
        &temp.path().join("state/db"),
        remote.clone(),
        Arc::new(FakeVault::default()),
    )
    .await;
    let copied_root = root.clone();
    let copied_outside = outside.clone();
    *remote.during_download.lock().unwrap() = Some(Box::new(move || {
        let folder = fs::read_dir(&copied_root)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        fs::rename(&folder, copied_root.join("moved")).unwrap();
        std::os::unix::fs::symlink(copied_outside, &folder).unwrap();
    }));
    assert_eq!(
        engine.reconcile().await.unwrap().campaigns[0].status_label,
        "Receive needs attention"
    );
    assert_eq!(fs::read_dir(outside).unwrap().count(), 0);
}

#[tokio::test]
async fn a_player_edit_after_interrupted_publication_is_preserved_while_the_receive_retries() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let db = temp.path().join("state/db");
    let remote = Arc::new(PublicationRemote::default());
    remote.publish(b"first");
    let mut engine =
        receiving_engine(&root, &db, remote.clone(), Arc::new(FakeVault::default())).await;
    let database = rusqlite::Connection::open(db).unwrap();
    database.execute_batch("CREATE TRIGGER fail_cursor BEFORE UPDATE OF cursor ON receive_campaigns BEGIN SELECT RAISE(ABORT,'disk unavailable'); END;").unwrap();
    engine.reconcile().await.unwrap();
    let folder = fs::read_dir(&root).unwrap().next().unwrap().unwrap().path();
    fs::write(folder.join("turn.se1"), b"local edit").unwrap();
    database.execute_batch("DROP TRIGGER fail_cursor;").unwrap();
    engine.reconcile().await.unwrap();
    assert_eq!(
        received_files(&root),
        vec![b"first".to_vec(), b"local edit".to_vec()]
    );
    remote.publish(b"second");
    let snapshot = engine.reconcile().await.unwrap();
    assert_eq!(
        snapshot.campaigns[0].recovery,
        Some(shadow_cloud_companion_engine::RecoveryState::Conflict)
    );
    assert_eq!(
        received_files(&root),
        vec![b"first".to_vec(), b"local edit".to_vec()]
    );
}

#[tokio::test]
async fn access_expiry_refreshes_before_receiving_and_revocation_clears_account_state_without_file_effects(
) {
    use std::sync::atomic::Ordering;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let remote = Arc::new(PublicationRemote::default());
    remote.publish(b"first");
    let mut engine = receiving_engine(
        &root,
        &temp.path().join("state/db"),
        remote.clone(),
        Arc::new(FakeVault::default()),
    )
    .await;
    remote.expired.store(true, Ordering::SeqCst);
    engine.reconcile().await.unwrap();
    assert_eq!(remote.refreshed.load(Ordering::SeqCst), 1);
    assert_eq!(received_files(&root), vec![b"first".to_vec()]);
    remote.revoked.store(true, Ordering::SeqCst);
    remote.publish(b"second");
    let snapshot = engine.reconcile().await.unwrap();
    assert_eq!(snapshot.session.state, SessionState::SignedOut);
    assert!(snapshot.campaigns.is_empty());
    assert_eq!(received_files(&root), vec![b"first".to_vec()]);
}

#[tokio::test]
async fn a_large_backlog_reports_progress_and_receives_all_pages_in_order() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let remote = Arc::new(PublicationRemote::default());
    remote.publish(b"first");
    let mut engine = receiving_engine(
        &root,
        &temp.path().join("state/db"),
        remote.clone(),
        Arc::new(FakeVault::default()),
    )
    .await;
    engine.reconcile().await.unwrap();
    for n in 0u32..104 {
        remote.publish(&n.to_be_bytes());
    }
    let first = engine.reconcile().await.unwrap();
    assert_eq!(first.campaigns[0].status_label, "Receiving publications");
    assert_eq!(received_files(&root).len(), 101);
    let finished = engine.reconcile().await.unwrap();
    assert_eq!(finished.campaigns[0].status_label, "Synchronized");
    assert_eq!(finished.campaigns[0].archive_bytes, 421);
    assert_eq!(received_files(&root).len(), 105);
}

#[tokio::test]
async fn a_same_publication_replacement_preserves_both_contents_and_large_unrelated_files() {
    use sha2::{Digest, Sha256};
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let remote = Arc::new(PublicationRemote::default());
    remote.publish(b"first");
    let mut engine = receiving_engine(
        &root,
        &temp.path().join("state/db"),
        remote.clone(),
        Arc::new(FakeVault::default()),
    )
    .await;
    engine.reconcile().await.unwrap();
    let folder = fs::read_dir(&root).unwrap().next().unwrap().unwrap().path();
    fs::File::create(folder.join("unrelated.bin"))
        .unwrap()
        .set_len(30 * 1024 * 1024)
        .unwrap();
    {
        let mut saves = remote.saves.lock().unwrap();
        saves[0].0.content_revision = 1;
        saves[0].0.content_hash = format!("sha256:{:x}", Sha256::digest(b"fixed"));
        saves[0].1 = b"fixed".to_vec();
    }
    let snapshot = engine.reconcile().await.unwrap();
    assert_eq!(snapshot.campaigns[0].status_label, "Synchronized");
    assert_eq!(
        received_files(&root),
        vec![b"first".to_vec(), b"fixed".to_vec()]
    );
    assert_eq!(
        fs::metadata(folder.join("unrelated.bin")).unwrap().len(),
        30 * 1024 * 1024
    );
}

#[tokio::test]
async fn access_expiry_during_publication_poll_rotates_the_session_without_skipping_saves() {
    use std::sync::atomic::Ordering;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let remote = Arc::new(PublicationRemote::default());
    remote.publish(b"first");
    let mut engine = receiving_engine(
        &root,
        &temp.path().join("state/db"),
        remote.clone(),
        Arc::new(FakeVault::default()),
    )
    .await;
    remote
        .publications_unauthorized_once
        .store(true, Ordering::SeqCst);
    let snapshot = engine.reconcile().await.unwrap();
    assert_eq!(snapshot.session.state, SessionState::SignedIn);
    assert_eq!(remote.refreshed.load(Ordering::SeqCst), 1);
    assert_eq!(received_files(&root), vec![b"first".to_vec()]);
}

#[tokio::test]
async fn access_expiry_during_download_rotates_the_session_and_retries_without_signing_out() {
    use std::sync::atomic::Ordering;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let remote = Arc::new(PublicationRemote::default());
    remote.publish(b"first");
    let mut engine = receiving_engine(
        &root,
        &temp.path().join("state/db"),
        remote.clone(),
        Arc::new(FakeVault::default()),
    )
    .await;
    remote
        .download_unauthorized_once
        .store(true, Ordering::SeqCst);
    let snapshot = engine.reconcile().await.unwrap();
    assert_eq!(snapshot.session.state, SessionState::SignedIn);
    assert_eq!(remote.refreshed.load(Ordering::SeqCst), 1);
    assert_eq!(received_files(&root), vec![b"first".to_vec()]);
}

#[tokio::test]
async fn a_replacement_cleans_superseded_staging_and_preserves_an_oversized_player_edit() {
    use sha2::{Digest, Sha256};
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let db = temp.path().join("state/db");
    let remote = Arc::new(PublicationRemote::default());
    remote.publish(b"first");
    let mut engine =
        receiving_engine(&root, &db, remote.clone(), Arc::new(FakeVault::default())).await;
    let database = rusqlite::Connection::open(db).unwrap();
    database.execute_batch("CREATE TRIGGER fail_cursor BEFORE UPDATE OF cursor ON receive_campaigns BEGIN SELECT RAISE(ABORT,'disk unavailable'); END;").unwrap();
    engine.reconcile().await.unwrap();
    let folder = fs::read_dir(&root).unwrap().next().unwrap().unwrap().path();
    fs::OpenOptions::new()
        .write(true)
        .open(folder.join("turn.se1"))
        .unwrap()
        .set_len(30 * 1024 * 1024)
        .unwrap();
    database.execute_batch("DROP TRIGGER fail_cursor;").unwrap();
    assert_eq!(
        engine.reconcile().await.unwrap().campaigns[0].status_label,
        "Folder scan incomplete"
    );
    assert_eq!(
        fs::metadata(folder.join("turn.se1")).unwrap().len(),
        30 * 1024 * 1024
    );
    remote.publish(b"later");
    database.execute_batch("CREATE TRIGGER fail_cursor BEFORE UPDATE OF cursor ON receive_campaigns BEGIN SELECT RAISE(ABORT,'disk unavailable'); END;").unwrap();
    engine.reconcile().await.unwrap();
    {
        let mut saves = remote.saves.lock().unwrap();
        saves[1].0.content_revision = 1;
        saves[1].0.content_hash = format!("sha256:{:x}", Sha256::digest(b"fixed"));
        saves[1].1 = b"fixed".to_vec();
    }
    database.execute_batch("DROP TRIGGER fail_cursor;").unwrap();
    assert_eq!(
        engine.reconcile().await.unwrap().campaigns[0].status_label,
        "Folder scan incomplete"
    );
    assert!(!fs::read_dir(folder).unwrap().any(|e| e
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".shadow-cloud-receive-")));
}

#[tokio::test]
async fn manual_candidates_require_two_complete_scans_and_ignore_exact_contents_across_renames() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let remote = Arc::new(PublicationRemote::default());
    remote.publish(b"received");
    let mut engine = receiving_engine(
        &root,
        &temp.path().join("state/db"),
        remote,
        Arc::new(FakeVault::default()),
    )
    .await;
    engine.reconcile().await.unwrap();
    let folder = fs::read_dir(&root).unwrap().next().unwrap().unwrap().path();
    fs::copy(folder.join("turn.se1"), folder.join("copy.se1")).unwrap();
    fs::write(folder.join("mine.se1"), b"local work").unwrap();
    let first = engine.reconcile().await.unwrap();
    assert_eq!(first.campaigns[0].candidates.len(), 1);
    assert!(!first.campaigns[0].candidates[0].stable);
    let second = engine.reconcile().await.unwrap();
    let candidate = &second.campaigns[0].candidates[0];
    assert!(candidate.stable);
    assert_eq!(candidate.filename, "mine.se1");
    assert_eq!(candidate.size, 10);
    let hash = candidate.content_hash.clone();
    engine
        .command(Command::CandidateAction {
            campaign_id: "campaign-1".into(),
            content_hash: hash.clone(),
            action: shadow_cloud_companion_engine::CandidateAction::Ignore,
        })
        .await
        .unwrap();
    fs::rename(folder.join("mine.se1"), folder.join("renamed.se1")).unwrap();
    let snapshot = engine.reconcile().await.unwrap();
    assert!(snapshot.campaigns[0].candidates[0].ignored);
    fs::write(folder.join("renamed.se1"), b"changed work").unwrap();
    let snapshot = engine.reconcile().await.unwrap();
    assert_eq!(snapshot.campaigns[0].candidates.len(), 1);
    assert!(!snapshot.campaigns[0].candidates[0].ignored);
    assert_ne!(snapshot.campaigns[0].candidates[0].content_hash, hash);
}

#[tokio::test]
async fn manual_submission_recovers_a_lost_response_after_restart_without_sending_twice_or_changing_the_original(
) {
    use std::sync::atomic::Ordering;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let db = temp.path().join("state/db");
    let vault = Arc::new(FakeVault::default());
    let remote = Arc::new(PublicationRemote::default());
    remote.publish(b"received");
    remote.can_submit.store(true, Ordering::SeqCst);
    let mut engine = receiving_engine(&root, &db, remote.clone(), vault.clone()).await;
    engine.reconcile().await.unwrap();
    let folder = fs::read_dir(&root).unwrap().next().unwrap().unwrap().path();
    let original = folder.join("mine.se1");
    fs::write(&original, b"my exact turn").unwrap();
    engine.reconcile().await.unwrap();
    let snapshot = engine.reconcile().await.unwrap();
    let candidate = &snapshot.campaigns[0].candidates[0];
    assert!(candidate.can_send);
    remote
        .lose_submission_response
        .store(true, Ordering::SeqCst);
    let snapshot = engine
        .command(Command::CandidateAction {
            campaign_id: "campaign-1".into(),
            content_hash: candidate.content_hash.clone(),
            action: shadow_cloud_companion_engine::CandidateAction::Send,
        })
        .await
        .unwrap();
    assert_eq!(
        snapshot.campaigns[0].status_label,
        "Checking submission receipt"
    );
    assert_eq!(fs::read(&original).unwrap(), b"my exact turn");
    drop(engine);
    let mut engine = Engine::open(
        &db,
        remote.clone(),
        Arc::new(FakePlatform::default()),
        vault,
    )
    .unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.restore_session().await.unwrap();
    let snapshot = engine.reconcile().await.unwrap();
    assert_eq!(remote.dispatches.load(Ordering::SeqCst), 1);
    assert_eq!(remote.saves.lock().unwrap().len(), 2);
    assert!(snapshot.campaigns[0].candidates.is_empty());
    assert_eq!(received_files(&root).len(), 2);
    assert_eq!(fs::read(&original).unwrap(), b"my exact turn");
}

#[cfg(unix)]
#[tokio::test]
async fn a_partial_scan_keeps_candidates_visible_but_blocks_send_until_two_complete_observations() {
    use std::sync::atomic::Ordering;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let remote = Arc::new(PublicationRemote::default());
    remote.publish(b"received");
    remote.can_submit.store(true, Ordering::SeqCst);
    let mut engine = receiving_engine(
        &root,
        &temp.path().join("state/db"),
        remote,
        Arc::new(FakeVault::default()),
    )
    .await;
    engine.reconcile().await.unwrap();
    let folder = fs::read_dir(&root).unwrap().next().unwrap().unwrap().path();
    fs::write(folder.join("mine.se1"), b"local").unwrap();
    engine.reconcile().await.unwrap();
    engine.reconcile().await.unwrap();
    std::os::unix::fs::symlink("absent", folder.join("incomplete.se1")).unwrap();
    let snapshot = engine.reconcile().await.unwrap();
    assert_eq!(snapshot.campaigns[0].candidates.len(), 1);
    assert!(!snapshot.campaigns[0].candidates[0].can_send);
    fs::remove_file(folder.join("incomplete.se1")).unwrap();
    assert!(!engine.reconcile().await.unwrap().campaigns[0].candidates[0].can_send);
    assert!(engine.reconcile().await.unwrap().campaigns[0].candidates[0].can_send);
}

#[tokio::test]
async fn manual_send_never_silently_rebinds_a_reviewed_candidate_to_a_new_turn_revision() {
    use std::sync::atomic::Ordering;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let remote = Arc::new(PublicationRemote::default());
    remote.publish(b"received");
    remote.can_submit.store(true, Ordering::SeqCst);
    let mut engine = receiving_engine(
        &root,
        &temp.path().join("state/db"),
        remote.clone(),
        Arc::new(FakeVault::default()),
    )
    .await;
    engine.reconcile().await.unwrap();
    let folder = fs::read_dir(&root).unwrap().next().unwrap().unwrap().path();
    fs::write(folder.join("mine.se1"), b"local").unwrap();
    engine.reconcile().await.unwrap();
    let snapshot = engine.reconcile().await.unwrap();
    let hash = snapshot.campaigns[0].candidates[0].content_hash.clone();
    remote.turn_revision.store(1, Ordering::SeqCst);
    assert!(engine
        .command(Command::CandidateAction {
            campaign_id: "campaign-1".into(),
            content_hash: hash,
            action: shadow_cloud_companion_engine::CandidateAction::Send
        })
        .await
        .is_err());
    assert_eq!(remote.dispatches.load(Ordering::SeqCst), 0);
}
#[tokio::test]
async fn a_new_publication_before_the_first_local_scan_does_not_rebase_existing_work() {
    use std::sync::atomic::Ordering;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let remote = Arc::new(PublicationRemote::default());
    remote.publish(b"received");
    remote.can_submit.store(true, Ordering::SeqCst);
    let mut engine = receiving_engine(
        &root,
        &temp.path().join("state/db"),
        remote.clone(),
        Arc::new(FakeVault::default()),
    )
    .await;
    engine.reconcile().await.unwrap();
    let folder = fs::read_dir(&root).unwrap().next().unwrap().unwrap().path();
    fs::write(folder.join("mine.se1"), b"old baseline work").unwrap();
    remote.publish(b"changed remote");
    engine.reconcile().await.unwrap();
    let snapshot = engine.reconcile().await.unwrap();
    assert!(!snapshot.campaigns[0].candidates[0].can_send);
}
#[tokio::test]
async fn switching_accounts_retains_campaign_content_provenance_without_sharing_ignore_authorization(
) {
    use std::sync::atomic::Ordering;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let remote = Arc::new(PublicationRemote::default());
    remote.publish(b"historical");
    remote.can_submit.store(true, Ordering::SeqCst);
    let mut engine = receiving_engine(
        &root,
        &temp.path().join("state/db"),
        remote.clone(),
        Arc::new(FakeVault::default()),
    )
    .await;
    engine.reconcile().await.unwrap();
    let folder = fs::read_dir(&root).unwrap().next().unwrap().unwrap().path();
    fs::write(folder.join("mine.se1"), b"local work").unwrap();
    engine.reconcile().await.unwrap();
    let snapshot = engine.reconcile().await.unwrap();
    let hash = snapshot.campaigns[0].candidates[0].content_hash.clone();
    engine
        .command(Command::CandidateAction {
            campaign_id: "campaign-1".into(),
            content_hash: hash,
            action: shadow_cloud_companion_engine::CandidateAction::Ignore,
        })
        .await
        .unwrap();
    engine.command(Command::SignOut).await.unwrap();
    remote.switch_account.store(true, Ordering::SeqCst);
    remote.publish(b"new current");
    engine
        .command(Command::SubmitHandoffToken {
            token: "other-account".into(),
        })
        .await
        .unwrap();
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.reconcile().await.unwrap();
    let snapshot = engine.reconcile().await.unwrap();
    assert_eq!(snapshot.campaigns[0].candidates.len(), 1);
    assert_eq!(snapshot.campaigns[0].candidates[0].filename, "mine.se1");
    assert!(!snapshot.campaigns[0].candidates[0].ignored);
}

#[tokio::test]
async fn unsupported_submission_filenames_remain_local_and_never_create_an_uncertain_upload() {
    use std::sync::atomic::Ordering;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let remote = Arc::new(PublicationRemote::default());
    remote.publish(b"received");
    remote.can_submit.store(true, Ordering::SeqCst);
    let mut engine = receiving_engine(
        &root,
        &temp.path().join("state/db"),
        remote.clone(),
        Arc::new(FakeVault::default()),
    )
    .await;
    engine.reconcile().await.unwrap();
    let folder = fs::read_dir(&root).unwrap().next().unwrap().unwrap().path();
    fs::write(folder.join(format!("{}.se1", "a".repeat(200))), b"local").unwrap();
    engine.reconcile().await.unwrap();
    let snapshot = engine.reconcile().await.unwrap();
    let candidate = &snapshot.campaigns[0].candidates[0];
    assert!(!candidate.can_send);
    assert!(engine
        .command(Command::CandidateAction {
            campaign_id: "campaign-1".into(),
            content_hash: candidate.content_hash.clone(),
            action: shadow_cloud_companion_engine::CandidateAction::Send
        })
        .await
        .is_err());
    assert_eq!(remote.dispatches.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn an_unaccepted_request_retries_immutable_staging_with_the_same_key_and_protocol_mismatch_stops_effects(
) {
    use std::sync::atomic::Ordering;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let remote = Arc::new(PublicationRemote::default());
    remote.publish(b"received");
    remote.can_submit.store(true, Ordering::SeqCst);
    let mut engine = receiving_engine(
        &root,
        &temp.path().join("state/db"),
        remote.clone(),
        Arc::new(FakeVault::default()),
    )
    .await;
    engine.reconcile().await.unwrap();
    let folder = fs::read_dir(&root).unwrap().next().unwrap().unwrap().path();
    fs::write(folder.join("mine.se1"), b"authorized").unwrap();
    engine.reconcile().await.unwrap();
    let snapshot = engine.reconcile().await.unwrap();
    remote.offline_submission_once.store(true, Ordering::SeqCst);
    engine
        .command(Command::CandidateAction {
            campaign_id: "campaign-1".into(),
            content_hash: snapshot.campaigns[0].candidates[0].content_hash.clone(),
            action: shadow_cloud_companion_engine::CandidateAction::Send,
        })
        .await
        .unwrap();
    fs::write(folder.join("mine.se1"), b"changed while offline").unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    remote.submission_mismatch.store(true, Ordering::SeqCst);
    let snapshot = engine.reconcile().await.unwrap();
    assert_eq!(snapshot.connection.state, ConnectionState::UpdateRequired);
    assert!(snapshot.read_only);
    assert_eq!(remote.saves.lock().unwrap().len(), 1);
    remote.submission_mismatch.store(false, Ordering::SeqCst);
    engine.observe_protocol(Ok(RELEASE.into()));
    let snapshot = engine.reconcile().await.unwrap();
    assert_eq!(
        remote.saves.lock().unwrap().last().unwrap().1,
        b"authorized"
    );
    let keys = remote.submitted_keys.lock().unwrap();
    assert_eq!(keys.len(), 3);
    assert!(keys.iter().all(|k| k == &keys[0]));
    assert_eq!(
        fs::read(folder.join("mine.se1")).unwrap(),
        b"changed while offline"
    );
    assert_eq!(snapshot.campaigns[0].candidates.len(), 1);
}

#[derive(Default)]
struct AutomaticPlatform {
    clock: std::sync::atomic::AtomicU64,
    notifications: Mutex<Vec<shadow_cloud_companion_engine::AutomaticNotification>>,
    selected: PathBuf,
}
#[async_trait]
impl CompanionPlatform for AutomaticPlatform {
    fn now_millis(&self) -> u64 {
        self.clock.load(std::sync::atomic::Ordering::SeqCst)
    }
    async fn notify_automatic(
        &self,
        notification: shadow_cloud_companion_engine::AutomaticNotification,
    ) -> Result<(), ()> {
        self.notifications.lock().unwrap().push(notification);
        Ok(())
    }
    fn open_url(&self, _: &str) -> Result<(), ()> {
        Ok(())
    }
    fn choose_directory(&self) -> Result<Option<PathBuf>, ()> {
        Ok(Some(self.selected.clone()))
    }
}

#[tokio::test]
async fn automatic_send_gives_fifteen_seconds_to_cancel_and_preserves_the_ordinary_candidate() {
    use std::sync::atomic::Ordering;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let db = temp.path().join("state/db");
    let remote = Arc::new(PublicationRemote::default());
    remote.publish(b"received");
    remote.can_submit.store(true, Ordering::SeqCst);
    let vault = Arc::new(FakeVault::default());
    let mut engine = receiving_engine(&root, &db, remote.clone(), vault.clone()).await;
    engine.reconcile().await.unwrap();
    drop(engine);
    let platform = Arc::new(AutomaticPlatform {
        selected: root.clone(),
        ..Default::default()
    });
    let mut engine = Engine::open(&db, remote.clone(), platform.clone(), vault).unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.restore_session().await.unwrap();
    let folder = fs::read_dir(&root).unwrap().next().unwrap().unwrap().path();
    fs::write(folder.join("mine.se1"), b"my turn").unwrap();
    engine.reconcile().await.unwrap();
    let snapshot = engine.reconcile().await.unwrap();
    assert_eq!(
        snapshot.campaigns[0]
            .countdown
            .as_ref()
            .unwrap()
            .remaining_seconds,
        15
    );
    assert_eq!(platform.notifications.lock().unwrap().len(), 1);
    for second in 1..15 {
        platform.clock.store(second * 1000, Ordering::SeqCst);
        engine.reconcile().await.unwrap();
    }
    assert_eq!(remote.dispatches.load(Ordering::SeqCst), 0);
    engine
        .command(Command::CampaignAction {
            campaign_id: "campaign-1".into(),
            action: shadow_cloud_companion_engine::CampaignAction::CancelAutomaticSend,
        })
        .await
        .unwrap();
    platform.clock.store(15_000, Ordering::SeqCst);
    let snapshot = engine.reconcile().await.unwrap();
    assert!(snapshot.campaigns[0].countdown.is_none());
    assert!(snapshot.campaigns[0].candidates[0].can_send);
    assert!(!snapshot.campaigns[0].candidates[0].ignored);
    assert_eq!(fs::read(folder.join("mine.se1")).unwrap(), b"my turn");
    assert_eq!(remote.dispatches.load(Ordering::SeqCst), 0);
}

async fn automatic_engine_fixture() -> (
    tempfile::TempDir,
    Engine,
    Arc<PublicationRemote>,
    Arc<AutomaticPlatform>,
    Arc<FakeVault>,
    PathBuf,
) {
    use std::sync::atomic::Ordering;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let db = temp.path().join("state/db");
    let remote = Arc::new(PublicationRemote::default());
    remote.publish(b"received");
    remote.can_submit.store(true, Ordering::SeqCst);
    let vault = Arc::new(FakeVault::default());
    let mut engine = receiving_engine(&root, &db, remote.clone(), vault.clone()).await;
    engine.reconcile().await.unwrap();
    drop(engine);
    let platform = Arc::new(AutomaticPlatform {
        selected: root.clone(),
        ..Default::default()
    });
    let mut engine = Engine::open(&db, remote.clone(), platform.clone(), vault.clone()).unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.restore_session().await.unwrap();
    let file = fs::read_dir(&root)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path()
        .join("mine.se1");
    fs::write(&file, b"my turn").unwrap();
    engine.reconcile().await.unwrap();
    engine.reconcile().await.unwrap();
    (temp, engine, remote, platform, vault, file)
}

#[tokio::test]
async fn automatic_send_stages_at_fifteen_seconds_and_cannot_reauthorize_sent_contents() {
    use std::sync::atomic::Ordering;
    let (_temp, mut engine, remote, platform, _vault, file) = automatic_engine_fixture().await;
    for second in 1..15 {
        platform.clock.store(second * 1000, Ordering::SeqCst);
        engine.reconcile().await.unwrap();
    }
    assert_eq!(remote.dispatches.load(Ordering::SeqCst), 0);
    platform.clock.store(15_000, Ordering::SeqCst);
    let snapshot = engine.reconcile().await.unwrap();
    assert_eq!(remote.dispatches.load(Ordering::SeqCst), 1);
    assert_eq!(snapshot.campaigns[0].status_label, "Submission accepted");
    assert!(snapshot.campaigns[0].countdown.is_none());
    assert_eq!(remote.saves.lock().unwrap().last().unwrap().1, b"my turn");
    fs::write(file, b"later local work").unwrap();
    let snapshot = engine.reconcile().await.unwrap();
    assert_eq!(snapshot.campaigns[0].candidates.len(), 1);
    assert!(!snapshot.campaigns[0].candidates[0].can_send);
    assert_eq!(remote.dispatches.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn automatic_countdown_restarts_after_wake_restart_and_file_mutation_and_ignores_old_notification_actions(
) {
    use std::sync::atomic::Ordering;
    let (temp, mut engine, remote, platform, vault, file) = automatic_engine_fixture().await;
    let old_id = engine.snapshot().campaigns[0]
        .countdown
        .as_ref()
        .unwrap()
        .authorization_id
        .clone();
    platform.clock.store(60_000, Ordering::SeqCst);
    assert!(engine.reconcile().await.unwrap().campaigns[0]
        .countdown
        .is_none());
    let snapshot = engine.reconcile().await.unwrap();
    assert_eq!(
        snapshot.campaigns[0]
            .countdown
            .as_ref()
            .unwrap()
            .remaining_seconds,
        15
    );
    assert_eq!(remote.dispatches.load(Ordering::SeqCst), 0);
    fs::write(&file, b"changed turn").unwrap();
    assert!(engine.reconcile().await.unwrap().campaigns[0]
        .countdown
        .is_none());
    let snapshot = engine.reconcile().await.unwrap();
    assert_eq!(
        snapshot.campaigns[0]
            .countdown
            .as_ref()
            .unwrap()
            .remaining_seconds,
        15
    );
    engine
        .command(Command::CancelAutomaticSend {
            campaign_id: "campaign-1".into(),
            authorization_id: old_id,
        })
        .await
        .unwrap();
    assert!(engine.snapshot().campaigns[0].countdown.is_some());
    drop(engine);
    platform.clock.store(120_000, Ordering::SeqCst);
    let mut engine = Engine::open(
        &temp.path().join("state/db"),
        remote.clone(),
        platform.clone(),
        vault,
    )
    .unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.restore_session().await.unwrap();
    assert!(engine.reconcile().await.unwrap().campaigns[0]
        .countdown
        .is_none());
    assert_eq!(
        engine.reconcile().await.unwrap().campaigns[0]
            .countdown
            .as_ref()
            .unwrap()
            .remaining_seconds,
        15
    );
    assert_eq!(remote.dispatches.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn automatic_send_never_fires_an_elapsed_countdown_after_a_reconciliation_stall() {
    use std::sync::atomic::Ordering;
    let (_temp, mut engine, remote, platform, _vault, _file) = automatic_engine_fixture().await;
    for second in 1..15 {
        platform.clock.store(second * 1000, Ordering::SeqCst);
        engine.reconcile().await.unwrap();
    }
    platform.clock.store(15_000, Ordering::SeqCst);
    let clock = platform.clone();
    *remote.during_observe.lock().unwrap() = Some(Box::new(move || {
        clock.clock.store(60_000, Ordering::SeqCst);
    }));
    let snapshot = engine.reconcile().await.unwrap();
    assert_eq!(remote.dispatches.load(Ordering::SeqCst), 0);
    assert!(snapshot.campaigns[0].countdown.is_none());
    engine.reconcile().await.unwrap();
    assert_eq!(
        engine.reconcile().await.unwrap().campaigns[0]
            .countdown
            .as_ref()
            .unwrap()
            .remaining_seconds,
        15
    );
}

#[tokio::test]
async fn offline_before_automatic_dispatch_requires_a_new_full_window_and_matching_authorization() {
    use std::sync::atomic::Ordering;
    let (_temp, mut engine, remote, platform, _vault, _file) = automatic_engine_fixture().await;
    for second in 1..15 {
        platform.clock.store(second * 1000, Ordering::SeqCst);
        engine.reconcile().await.unwrap();
    }
    platform.clock.store(15_000, Ordering::SeqCst);
    let second = remote.clone();
    *remote.during_observe.lock().unwrap() = Some(Box::new(move || {
        let failure = second.clone();
        *second.during_observe.lock().unwrap() = Some(Box::new(move || {
            failure.offline_observe.store(true, Ordering::SeqCst);
        }));
    }));
    engine.reconcile().await.unwrap();
    assert_eq!(remote.dispatches.load(Ordering::SeqCst), 0);
    remote.offline_observe.store(false, Ordering::SeqCst);
    engine.observe_protocol(Ok(RELEASE.into()));
    let snapshot = engine.reconcile().await.unwrap();
    assert_eq!(
        snapshot.campaigns[0]
            .countdown
            .as_ref()
            .unwrap()
            .remaining_seconds,
        15
    );
    // A Roster/Seat/turn revision invalidates the original authorization even when bytes match.
    remote.turn_revision.store(1, Ordering::SeqCst);
    assert!(engine.reconcile().await.unwrap().campaigns[0]
        .countdown
        .is_none());
    assert!(!engine.snapshot().campaigns[0].candidates[0].can_send);
    assert_eq!(remote.dispatches.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn changed_local_contents_cannot_silently_renew_stale_automatic_authorization() {
    use std::sync::atomic::Ordering;
    let (_temp, mut engine, remote, _platform, _vault, file) = automatic_engine_fixture().await;
    remote.turn_revision.store(1, Ordering::SeqCst);
    assert!(engine.reconcile().await.unwrap().campaigns[0]
        .countdown
        .is_none());
    fs::write(file, b"edited after stale turn").unwrap();
    engine.reconcile().await.unwrap();
    let snapshot = engine.reconcile().await.unwrap();
    assert!(snapshot.campaigns[0].countdown.is_none());
    assert!(!snapshot.campaigns[0].candidates[0].can_send);
}

#[tokio::test]
async fn another_candidate_appearing_at_automatic_authorization_blocks_dispatch() {
    use std::sync::atomic::Ordering;
    let (_temp, mut engine, remote, platform, _vault, file) = automatic_engine_fixture().await;
    for second in 1..15 {
        platform.clock.store(second * 1000, Ordering::SeqCst);
        engine.reconcile().await.unwrap();
    }
    platform.clock.store(15_000, Ordering::SeqCst);
    let second = remote.clone();
    *remote.during_observe.lock().unwrap() = Some(Box::new(move || {
        *second.during_observe.lock().unwrap() = Some(Box::new(move || {
            fs::write(file.with_file_name("another.se1"), b"second candidate").unwrap();
        }));
    }));
    engine.reconcile().await.unwrap();
    assert_eq!(remote.dispatches.load(Ordering::SeqCst), 0);
    let snapshot = engine.reconcile().await.unwrap();
    assert_eq!(snapshot.campaigns[0].candidates.len(), 2);
    assert!(snapshot.campaigns[0].countdown.is_none());
}

#[tokio::test]
async fn restart_after_automatic_staging_cannot_dispatch_without_a_fresh_countdown() {
    use std::sync::atomic::Ordering;
    let (temp, mut engine, remote, platform, vault, _file) = automatic_engine_fixture().await;
    let db = temp.path().join("state/db");
    let database = rusqlite::Connection::open(&db).unwrap();
    database.execute_batch("CREATE TRIGGER interrupt_dispatch BEFORE UPDATE OF state ON turn_submissions WHEN NEW.state IN ('dispatched','abandoned') BEGIN SELECT RAISE(ABORT,'storage interrupted'); END;").unwrap();
    for second in 1..=15 {
        platform.clock.store(second * 1000, Ordering::SeqCst);
        engine.reconcile().await.unwrap();
    }
    assert_eq!(remote.dispatches.load(Ordering::SeqCst), 0);
    drop(engine);
    database
        .execute_batch("DROP TRIGGER interrupt_dispatch;")
        .unwrap();
    let mut engine = Engine::open(&db, remote.clone(), platform.clone(), vault).unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.restore_session().await.unwrap();
    engine.reconcile().await.unwrap();
    assert_eq!(remote.dispatches.load(Ordering::SeqCst), 0);
    assert_eq!(
        engine.reconcile().await.unwrap().campaigns[0]
            .countdown
            .as_ref()
            .unwrap()
            .remaining_seconds,
        15
    );
}

#[tokio::test]
async fn even_a_short_native_sleep_discards_countdowns_and_reobserves_before_a_full_window() {
    use std::sync::atomic::Ordering;
    let (_temp, mut engine, remote, platform, _vault, _file) = automatic_engine_fixture().await;
    for second in 1..15 {
        platform.clock.store(second * 1000, Ordering::SeqCst);
        engine.reconcile().await.unwrap();
    }
    platform.clock.store(15_000, Ordering::SeqCst);
    assert!(engine.resume().campaigns[0].countdown.is_none());
    assert!(engine.reconcile().await.unwrap().campaigns[0]
        .countdown
        .is_none());
    assert_eq!(
        engine.reconcile().await.unwrap().campaigns[0]
            .countdown
            .as_ref()
            .unwrap()
            .remaining_seconds,
        15
    );
    assert_eq!(remote.dispatches.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn switching_accounts_requires_explicit_send_for_existing_local_work() {
    use std::sync::atomic::Ordering;
    let (_temp, mut engine, remote, _platform, _vault, file) = automatic_engine_fixture().await;
    engine.command(Command::SignOut).await.unwrap();
    remote.switch_account.store(true, Ordering::SeqCst);
    engine
        .command(Command::SubmitHandoffToken {
            token: "other-account".into(),
        })
        .await
        .unwrap();
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.reconcile().await.unwrap();
    let snapshot = engine.reconcile().await.unwrap();
    assert!(snapshot.campaigns[0].countdown.is_none());
    assert!(snapshot.campaigns[0].candidates[0].can_send);
    assert!(!snapshot.campaigns[0].candidates[0].ignored);
    assert_eq!(fs::read(file).unwrap(), b"my turn");
    assert_eq!(remote.dispatches.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn cancel_stops_automatic_sending_even_when_its_durable_write_temporarily_fails() {
    use std::sync::atomic::Ordering;
    let (temp, mut engine, remote, platform, _vault, _file) = automatic_engine_fixture().await;
    let id = engine.snapshot().campaigns[0]
        .countdown
        .as_ref()
        .unwrap()
        .authorization_id
        .clone();
    let database = rusqlite::Connection::open(temp.path().join("state/db")).unwrap();
    database.execute_batch("CREATE TRIGGER fail_cancel BEFORE INSERT ON automatic_cancelled BEGIN SELECT RAISE(ABORT,'storage unavailable'); END;").unwrap();
    assert_eq!(
        engine
            .command(Command::CancelAutomaticSend {
                campaign_id: "campaign-1".into(),
                authorization_id: id
            })
            .await,
        Err(CommandError::StorageUnavailable)
    );
    assert!(engine.snapshot().campaigns[0].countdown.is_none());
    for second in 1..15 {
        platform.clock.store(second * 1000, Ordering::SeqCst);
        engine.reconcile().await.unwrap();
    }
    database.execute_batch("DROP TRIGGER fail_cancel;").unwrap();
    platform.clock.store(15_000, Ordering::SeqCst);
    let snapshot = engine.reconcile().await.unwrap();
    assert!(snapshot.campaigns[0].countdown.is_none());
    assert!(snapshot.campaigns[0].candidates[0].can_send);
    assert_eq!(remote.dispatches.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn campaign_automatic_override_survives_restart_and_inherit_tracks_the_global_preference() {
    use shadow_cloud_companion_engine::AutomaticMode;
    let (temp, mut engine, remote, platform, vault, _file) = automatic_engine_fixture().await;
    let snapshot = engine
        .command(Command::SetCampaignAutomaticUploads {
            campaign_id: "campaign-1".into(),
            mode: AutomaticMode::Manual,
        })
        .await
        .unwrap();
    assert!(!snapshot.campaigns[0].automatic_uploads);
    assert!(snapshot.campaigns[0].countdown.is_none());
    engine
        .command(Command::SetAutomaticUploads { enabled: false })
        .await
        .unwrap();
    engine
        .command(Command::SetCampaignAutomaticUploads {
            campaign_id: "campaign-1".into(),
            mode: AutomaticMode::Automatic,
        })
        .await
        .unwrap();
    assert!(engine.reconcile().await.unwrap().campaigns[0]
        .countdown
        .is_some());
    drop(engine);
    let mut engine = Engine::open(&temp.path().join("state/db"), remote, platform, vault).unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.restore_session().await.unwrap();
    engine.reconcile().await.unwrap();
    let snapshot = engine.reconcile().await.unwrap();
    assert!(!snapshot.preferences.automatic_uploads);
    assert!(snapshot.campaigns[0].automatic_uploads);
    assert_eq!(
        snapshot.campaigns[0]
            .countdown
            .as_ref()
            .unwrap()
            .remaining_seconds,
        15
    );
    let snapshot = engine
        .command(Command::SetCampaignAutomaticUploads {
            campaign_id: "campaign-1".into(),
            mode: AutomaticMode::Inherit,
        })
        .await
        .unwrap();
    assert!(!snapshot.campaigns[0].automatic_uploads);
    assert!(snapshot.campaigns[0].countdown.is_none());
    engine
        .command(Command::SetAutomaticUploads { enabled: true })
        .await
        .unwrap();
    assert!(engine.reconcile().await.unwrap().campaigns[0]
        .countdown
        .is_some());
}

#[tokio::test]
async fn cancel_queued_as_connection_drops_persists_the_exact_suppression_across_restart() {
    let (temp, mut engine, remote, platform, vault, _file) = automatic_engine_fixture().await;
    let id = engine.snapshot().campaigns[0]
        .countdown
        .as_ref()
        .unwrap()
        .authorization_id
        .clone();
    engine.observe_protocol(Err(()));
    assert!(engine.snapshot().campaigns[0].countdown.is_none());
    engine
        .command(Command::CancelAutomaticSend {
            campaign_id: "campaign-1".into(),
            authorization_id: id,
        })
        .await
        .unwrap();
    drop(engine);
    let mut engine = Engine::open(&temp.path().join("state/db"), remote, platform, vault).unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.restore_session().await.unwrap();
    engine.reconcile().await.unwrap();
    let snapshot = engine.reconcile().await.unwrap();
    assert!(snapshot.campaigns[0].countdown.is_none());
    assert!(snapshot.campaigns[0].candidates[0].can_send);
    assert!(!snapshot.campaigns[0].candidates[0].ignored);
}

#[tokio::test]
async fn changed_cloud_save_preserves_local_work_and_blocks_receive_and_send_until_resolution() {
    let (_temp, mut engine, remote, _platform, _vault, file) = automatic_engine_fixture().await;
    remote.publish(b"new cloud save");
    let snapshot = engine.reconcile().await.unwrap();
    assert_eq!(
        snapshot.campaigns[0].recovery,
        Some(shadow_cloud_companion_engine::RecoveryState::Conflict)
    );
    assert_eq!(
        snapshot.campaigns[0].sync_status,
        shadow_cloud_companion_engine::SyncStatus::Conflict
    );
    assert!(!snapshot.campaigns[0].candidates[0].can_send);
    assert!(snapshot.campaigns[0].countdown.is_none());
    assert_eq!(
        received_files(file.parent().unwrap().parent().unwrap()),
        vec![b"my turn".to_vec(), b"received".to_vec()]
    );
    fs::write(&file, b"edited during conflict").unwrap();
    engine.reconcile().await.unwrap();
    let snapshot = engine.reconcile().await.unwrap();
    assert_eq!(
        snapshot.campaigns[0].recovery,
        Some(shadow_cloud_companion_engine::RecoveryState::Conflict)
    );
    assert!(!snapshot.campaigns[0].candidates[0].can_send);
    assert_eq!(fs::read(&file).unwrap(), b"edited during conflict");
}

#[tokio::test]
async fn use_latest_preserves_exact_local_work_before_receiving_and_does_not_offer_force_send() {
    use shadow_cloud_companion_engine::ResolutionAction;
    let (_temp, mut engine, remote, _platform, _vault, file) = automatic_engine_fixture().await;
    remote.publish(b"new cloud save");
    let snapshot = engine.reconcile().await.unwrap();
    let snapshot = engine
        .command(Command::ResolveCampaign {
            campaign_id: "campaign-1".into(),
            action: ResolutionAction::UseLatest,
            review_token: snapshot.campaigns[0].recovery_token.clone(),
        })
        .await
        .unwrap();
    assert!(snapshot.campaigns[0].recovery.is_none());
    assert!(snapshot.campaigns[0].candidates[0].ignored);
    assert!(!snapshot.campaigns[0].candidates[0].can_send);
    assert_eq!(fs::read(&file).unwrap(), b"my turn");
    let copies: Vec<_> = fs::read_dir(file.parent().unwrap().join(".shadow-cloud-conflicts"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "se1"))
        .collect();
    assert_eq!(copies.len(), 1);
    assert_eq!(fs::read(&copies[0]).unwrap(), b"my turn");
    assert_eq!(
        received_files(file.parent().unwrap().parent().unwrap()),
        vec![
            b"my turn".to_vec(),
            b"new cloud save".to_vec(),
            b"received".to_vec()
        ]
    );
    let hash = snapshot.campaigns[0].candidates[0].content_hash.clone();
    engine
        .command(Command::CandidateAction {
            campaign_id: "campaign-1".into(),
            content_hash: hash,
            action: shadow_cloud_companion_engine::CandidateAction::Restore,
        })
        .await
        .unwrap();
    let snapshot = engine.reconcile().await.unwrap();
    assert!(snapshot.campaigns[0].recovery.is_some());
    assert!(!snapshot.campaigns[0].candidates[0].can_send);
}

#[tokio::test]
async fn stale_turn_review_requires_a_separate_manual_send_even_if_local_contents_change() {
    use shadow_cloud_companion_engine::{CandidateAction, RecoveryState, ResolutionAction};
    use std::sync::atomic::Ordering;
    let (_temp, mut engine, remote, _platform, _vault, file) = automatic_engine_fixture().await;
    remote.turn_revision.store(1, Ordering::SeqCst);
    let snapshot = engine.reconcile().await.unwrap();
    assert_eq!(snapshot.campaigns[0].recovery, Some(RecoveryState::Stale));
    let snapshot = engine
        .command(Command::ResolveCampaign {
            campaign_id: "campaign-1".into(),
            action: ResolutionAction::ReviewCurrentTurn,
            review_token: snapshot.campaigns[0].recovery_token.clone(),
        })
        .await
        .unwrap();
    assert!(snapshot.campaigns[0].recovery.is_none());
    assert!(snapshot.campaigns[0].candidates[0].can_send);
    assert!(snapshot.campaigns[0].countdown.is_none());
    fs::write(file, b"my reviewed turn").unwrap();
    engine.reconcile().await.unwrap();
    let snapshot = engine.reconcile().await.unwrap();
    assert!(snapshot.campaigns[0].countdown.is_none());
    let hash = snapshot.campaigns[0].candidates[0].content_hash.clone();
    assert_eq!(remote.dispatches.load(Ordering::SeqCst), 0);
    engine
        .command(Command::CandidateAction {
            campaign_id: "campaign-1".into(),
            content_hash: hash,
            action: CandidateAction::Send,
        })
        .await
        .unwrap();
    assert_eq!(remote.dispatches.load(Ordering::SeqCst), 1);
    assert_eq!(
        remote.saves.lock().unwrap().last().unwrap().1,
        b"my reviewed turn"
    );
}

#[tokio::test]
async fn failed_conflict_commit_keeps_the_copy_and_can_resume_after_restart() {
    use shadow_cloud_companion_engine::{RecoveryState, ResolutionAction};
    let (temp, mut engine, remote, platform, vault, file) = automatic_engine_fixture().await;
    remote.publish(b"new cloud save");
    let snapshot = engine.reconcile().await.unwrap();
    let database = rusqlite::Connection::open(temp.path().join("state/db")).unwrap();
    database.execute_batch("CREATE TRIGGER fail_resolution BEFORE UPDATE OF ignored ON turn_candidates BEGIN SELECT RAISE(FAIL,'injected'); END;").unwrap();
    assert!(engine
        .command(Command::ResolveCampaign {
            campaign_id: "campaign-1".into(),
            action: ResolutionAction::UseLatest,
            review_token: snapshot.campaigns[0].recovery_token.clone()
        })
        .await
        .is_err());
    assert_eq!(
        engine.snapshot().campaigns[0].recovery,
        Some(RecoveryState::Conflict)
    );
    assert_eq!(
        received_files(file.parent().unwrap().parent().unwrap()).len(),
        2
    );
    let area = file.parent().unwrap().join(".shadow-cloud-conflicts");
    let copies: Vec<_> = fs::read_dir(&area)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "se1"))
        .collect();
    assert_eq!(copies.len(), 1);
    assert_eq!(fs::read(&copies[0]).unwrap(), b"my turn");
    database
        .execute_batch("DROP TRIGGER fail_resolution;")
        .unwrap();
    drop(engine);
    let mut engine = Engine::open(&temp.path().join("state/db"), remote, platform, vault).unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.restore_session().await.unwrap();
    let snapshot = engine.reconcile().await.unwrap();
    let snapshot = engine
        .command(Command::ResolveCampaign {
            campaign_id: "campaign-1".into(),
            action: ResolutionAction::UseLatest,
            review_token: snapshot.campaigns[0].recovery_token.clone(),
        })
        .await
        .unwrap();
    assert!(snapshot.campaigns[0].recovery.is_none());
    assert_eq!(
        fs::read_dir(area)
            .unwrap()
            .filter(|e| e
                .as_ref()
                .unwrap()
                .path()
                .extension()
                .is_some_and(|ext| ext == "se1"))
            .count(),
        1
    );
    assert_eq!(fs::read(file).unwrap(), b"my turn");
}

#[tokio::test]
async fn changed_review_identity_rejects_the_old_choice_and_publishes_a_fresh_review() {
    use shadow_cloud_companion_engine::ResolutionAction;
    let (_temp, mut engine, remote, _platform, _vault, file) = automatic_engine_fixture().await;
    remote.publish(b"new cloud save");
    let snapshot = engine.reconcile().await.unwrap();
    let old = snapshot.campaigns[0].recovery_token.clone();
    remote.publish(b"newer cloud save");
    assert!(engine
        .command(Command::ResolveCampaign {
            campaign_id: "campaign-1".into(),
            action: ResolutionAction::UseLatest,
            review_token: old.clone()
        })
        .await
        .is_err());
    assert_ne!(engine.snapshot().campaigns[0].recovery_token, old);
    assert_eq!(
        received_files(file.parent().unwrap().parent().unwrap()).len(),
        2
    );
    assert!(!file
        .parent()
        .unwrap()
        .join(".shadow-cloud-conflicts")
        .exists());
}

#[tokio::test]
async fn missing_root_remains_bound_and_visible_after_restart() {
    let (temp, engine, remote, platform, vault, file) = automatic_engine_fixture().await;
    let root = file.parent().unwrap().parent().unwrap().to_owned();
    let path = engine.snapshot().root_path.clone();
    fs::rename(&root, temp.path().join("temporarily-unmounted")).unwrap();
    drop(engine);
    let mut engine = Engine::open(&temp.path().join("state/db"), remote, platform, vault).unwrap();
    assert_eq!(engine.snapshot().root_path, path);
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.restore_session().await.unwrap();
    let snapshot = engine.reconcile().await.unwrap();
    assert_eq!(snapshot.root_path, path);
    assert!(!root.exists());
    assert!(snapshot.campaigns[0].candidates.iter().all(|c| !c.can_send));
}

#[tokio::test]
async fn failed_pause_persistence_stops_effects_in_the_running_session() {
    for campaign_only in [false, true] {
        let (temp, mut engine, remote, _platform, _vault, file) = automatic_engine_fixture().await;
        let database = rusqlite::Connection::open(temp.path().join("state/db")).unwrap();
        database.execute_batch(if campaign_only {"CREATE TRIGGER fail_pause BEFORE INSERT ON campaign_recovery BEGIN SELECT RAISE(FAIL,'injected'); END;"} else {"CREATE TRIGGER fail_pause BEFORE INSERT ON settings BEGIN SELECT RAISE(FAIL,'injected'); END;"}).unwrap();
        let command = if campaign_only {
            Command::SetCampaignPaused {
                campaign_id: "campaign-1".into(),
                paused: true,
            }
        } else {
            Command::SetPaused { paused: true }
        };
        assert!(engine.command(command).await.is_err());
        let snapshot = engine.snapshot();
        assert!(if campaign_only {
            snapshot.campaigns[0].paused
        } else {
            snapshot.paused
        });
        assert!(snapshot.campaigns[0].countdown.is_none());
        remote.publish(b"new cloud save");
        let _ = engine.reconcile().await;
        assert_eq!(
            received_files(file.parent().unwrap().parent().unwrap()).len(),
            2
        );
    }
}

#[tokio::test]
async fn changes_during_conflict_preservation_keep_both_sides_until_another_review() {
    use shadow_cloud_companion_engine::{RecoveryState, ResolutionAction};
    for change in ["cloud", "local"] {
        let (_temp, mut engine, remote, _platform, _vault, file) = automatic_engine_fixture().await;
        remote.publish(b"new cloud save");
        let snapshot = engine.reconcile().await.unwrap();
        let remote_next = remote.clone();
        let remote_changed = remote.clone();
        let local = file.clone();
        *remote.during_observe.lock().unwrap() = Some(Box::new(move || {
            *remote_next.during_observe.lock().unwrap() = Some(Box::new(move || {
                if change == "cloud" {
                    remote_changed.publish(b"newer cloud save");
                } else {
                    fs::write(local, b"local edit during preservation").unwrap();
                }
            }));
        }));
        assert!(engine
            .command(Command::ResolveCampaign {
                campaign_id: "campaign-1".into(),
                action: ResolutionAction::UseLatest,
                review_token: snapshot.campaigns[0].recovery_token.clone()
            })
            .await
            .is_err());
        assert_eq!(
            engine.snapshot().campaigns[0].recovery,
            Some(RecoveryState::Conflict)
        );
        let copies: Vec<_> = fs::read_dir(file.parent().unwrap().join(".shadow-cloud-conflicts"))
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.extension().is_some_and(|ext| ext == "se1"))
            .collect();
        assert_eq!(copies.len(), 1);
        assert_eq!(fs::read(&copies[0]).unwrap(), b"my turn");
        assert_eq!(
            received_files(file.parent().unwrap().parent().unwrap()).len(),
            2
        );
        assert_eq!(
            fs::read(file).unwrap(),
            if change == "cloud" {
                b"my turn".to_vec()
            } else {
                b"local edit during preservation".to_vec()
            }
        );
    }
}
