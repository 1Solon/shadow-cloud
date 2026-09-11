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
    assert_eq!(signed_in.onboarding.stage, OnboardingStage::CompanionRoot);
    assert_eq!(
        vault.secret.lock().unwrap().as_deref(),
        Some("device.rotating-refresh-secret")
    );
    let sqlite_bytes = fs::read(database).unwrap();
    assert!(!String::from_utf8_lossy(&sqlite_bytes).contains("rotating-refresh-secret"));
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
    assert_eq!(
        engine.command(action()).await,
        Err(CommandError::OnboardingIncomplete)
    );
    engine.command(Command::ContinueOnboarding).await.unwrap();
    assert_eq!(engine.snapshot().onboarding.stage, OnboardingStage::Review);
    assert_eq!(
        engine.command(action()).await,
        Err(CommandError::OnboardingIncomplete)
    );

    let completed = engine.command(Command::CompleteOnboarding).await.unwrap();
    assert!(completed.onboarding.can_send);
    assert!(!completed.read_only);
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
