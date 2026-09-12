use async_trait::async_trait;
use shadow_cloud_companion_engine::{
    AutomaticNotification, Command, CompanionPlatform, CompanionRemote, DeviceCredentials, Engine,
    ExchangeOutcome, Handoff, ObservedCampaign, PublicationPage, ReceiveError, RemoteError,
    SecretVault, RELEASE,
};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};

struct Remote {
    account: Mutex<String>,
    can_submit: AtomicBool,
}

impl Default for Remote {
    fn default() -> Self {
        Self {
            account: Mutex::new("private-account-a".into()),
            can_submit: AtomicBool::new(false),
        }
    }
}

impl Remote {
    fn credentials(&self) -> DeviceCredentials {
        serde_json::from_value(serde_json::json!({
            "accessToken": "private-access-secret",
            "accessTokenExpiresAt": "2026-09-13T00:00:00Z",
            "refreshToken": "private-refresh-secret",
            "deviceSession": {
                "id": "private-device-id",
                "expiresAt": "2027-01-01T00:00:00Z",
                "scopes": ["campaigns:observe", "saves:download", "turns:submit"],
                "user": {
                    "id": *self.account.lock().unwrap(),
                    "email": "private-player@example.test",
                    "displayName": "Private Player"
                }
            }
        }))
        .unwrap()
    }
}

#[async_trait]
impl CompanionRemote for Remote {
    async fn create_handoff(&self) -> Result<Handoff, RemoteError> {
        Err(RemoteError::Rejected)
    }

    async fn exchange_browser(&self, _: &str, _: &str) -> Result<ExchangeOutcome, RemoteError> {
        Err(RemoteError::Rejected)
    }

    async fn exchange_token(&self, _: &str) -> Result<DeviceCredentials, RemoteError> {
        Ok(self.credentials())
    }

    async fn refresh(&self, _: &str) -> Result<DeviceCredentials, RemoteError> {
        Ok(self.credentials())
    }

    async fn revoke(&self, _: &str) -> Result<(), RemoteError> {
        Ok(())
    }

    async fn observe(&self, _: &str) -> Result<Vec<ObservedCampaign>, ReceiveError> {
        Ok(vec![serde_json::from_value(serde_json::json!({
            "id": "private-campaign-id",
            "number": 42,
            "name": "Private Campaign",
            "round": 1,
            "activeLord": "Private Player",
            "turnStartedAt": null,
            "current": null,
            "baseline": "private-campaign-baseline",
            "canSubmit": self.can_submit.load(Ordering::SeqCst)
        }))
        .unwrap()])
    }

    async fn publications(
        &self,
        _: &str,
        _: &str,
        _: u32,
    ) -> Result<PublicationPage, ReceiveError> {
        Ok(PublicationPage {
            current: None,
            publications: vec![],
        })
    }
}

struct Platform {
    root: PathBuf,
    clock: AtomicU64,
}

#[async_trait]
impl CompanionPlatform for Platform {
    fn now_millis(&self) -> u64 {
        self.clock.load(Ordering::SeqCst)
    }

    async fn notify_automatic(&self, _: AutomaticNotification) -> Result<(), ()> {
        Ok(())
    }

    fn open_url(&self, _: &str) -> Result<(), ()> {
        Ok(())
    }

    fn choose_directory(&self) -> Result<Option<PathBuf>, ()> {
        Ok(Some(self.root.clone()))
    }
}

#[derive(Default)]
struct Vault(Mutex<Option<String>>);

impl SecretVault for Vault {
    fn load(&self) -> Result<Option<String>, ()> {
        Ok(self.0.lock().unwrap().clone())
    }

    fn store(&self, secret: &str) -> Result<(), ()> {
        *self.0.lock().unwrap() = Some(secret.into());
        Ok(())
    }

    fn clear(&self) -> Result<(), ()> {
        *self.0.lock().unwrap() = None;
        Ok(())
    }
}

async fn signed_in(
    database: &Path,
    remote: Arc<Remote>,
    platform: Arc<Platform>,
    vault: Arc<Vault>,
) -> Engine {
    let mut engine = Engine::open(database, remote, platform, vault).unwrap();
    engine.observe_protocol(Ok(RELEASE.into()));
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine
        .command(Command::SubmitHandoffToken {
            token: "private-handoff-secret".into(),
        })
        .await
        .unwrap();
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.command(Command::ChooseCompanionRoot).await.unwrap();
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.command(Command::CompleteOnboarding).await.unwrap();
    engine.reconcile().await.unwrap();
    engine
}

async fn diagnostics(engine: &mut Engine) -> serde_json::Value {
    let command = serde_json::from_str(r#"{"type":"generate-diagnostics"}"#).unwrap();
    let snapshot = serde_json::to_value(engine.command(command).await.unwrap()).unwrap();
    serde_json::from_str(snapshot["diagnostics"].as_str().unwrap()).unwrap()
}

#[tokio::test]
async fn diagnostics_are_explicit_aggregate_facts_without_private_values_or_exported_files() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("private-root");
    fs::create_dir(&root).unwrap();
    let database = temporary.path().join("state/companion.sqlite3");
    let platform = Arc::new(Platform {
        root: root.clone(),
        clock: AtomicU64::new(1_789_257_600_000),
    });
    let mut engine = signed_in(
        &database,
        Arc::new(Remote::default()),
        platform,
        Arc::new(Vault::default()),
    )
    .await;
    let folder = fs::read_dir(&root).unwrap().next().unwrap().unwrap().path();
    fs::write(folder.join("private-turn.se1"), b"private-save-contents").unwrap();
    engine.reconcile().await.unwrap();
    engine.reconcile().await.unwrap();
    let before = serde_json::to_value(engine.snapshot()).unwrap();
    assert!(before
        .get("diagnostics")
        .is_none_or(|value| value.is_null()));
    let report = diagnostics(&mut engine).await;
    assert_eq!(report["appVersion"], RELEASE);
    assert_eq!(report["protocolVersion"], RELEASE);
    assert_eq!(report["counts"]["campaigns"], 1);
    assert_eq!(report["counts"]["turnCandidates"], 1);
    assert_eq!(report["history"]["candidateRows"], 1);
    let text = report.to_string();
    for private in [
        "private-",
        "Private Campaign",
        "Private Player",
        "example.test",
        "sha256:",
        temporary.path().to_str().unwrap(),
    ] {
        assert!(!text.contains(private), "diagnostics exposed {private}");
    }
    engine.observe_protocol(Ok("private-server-protocol-response".into()));
    let mismatch = diagnostics(&mut engine).await;
    assert_eq!(mismatch["connection"], "update-required");
    assert_eq!(mismatch["serverProtocolMatches"], false);
    assert!(!mismatch.to_string().contains("private-server"));
    assert_eq!(fs::read_dir(&folder).unwrap().count(), 2);
    assert_eq!(
        fs::read(folder.join("private-turn.se1")).unwrap(),
        b"private-save-contents"
    );
    assert_eq!(fs::read_dir(temporary.path()).unwrap().count(), 2);
}

#[tokio::test]
async fn recent_activity_is_bounded_and_survives_restart_without_pruning_local_work() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("root");
    fs::create_dir(&root).unwrap();
    let database = temporary.path().join("state/companion.sqlite3");
    let remote = Arc::new(Remote::default());
    let platform = Arc::new(Platform {
        root: root.clone(),
        clock: AtomicU64::new(1_789_257_600_000),
    });
    let vault = Arc::new(Vault::default());
    let mut engine = signed_in(&database, remote.clone(), platform.clone(), vault.clone()).await;
    let folder = fs::read_dir(&root).unwrap().next().unwrap().unwrap().path();
    let original = folder.join("turn.se1");
    fs::write(&original, b"durable local work").unwrap();
    engine.reconcile().await.unwrap();
    engine.reconcile().await.unwrap();
    let history = diagnostics(&mut engine).await["history"].clone();
    for index in 0..600 {
        platform.clock.fetch_add(1_000, Ordering::SeqCst);
        engine
            .command(Command::SetPaused {
                paused: index % 2 == 0,
            })
            .await
            .unwrap();
    }
    assert_eq!(engine.snapshot().activity.len(), 100);
    assert_eq!(
        diagnostics(&mut engine).await["history"]["activityRows"],
        500
    );
    let retained = engine.snapshot().activity;
    assert!(retained
        .windows(2)
        .all(|pair| { pair[0].id.parse::<u64>().unwrap() > pair[1].id.parse::<u64>().unwrap() }));
    assert!(retained.iter().all(|item| item.occurred_at.ends_with('Z')));
    drop(engine);
    let mut restarted = Engine::open(&database, remote, platform, vault).unwrap();
    restarted.observe_protocol(Ok(RELEASE.into()));
    restarted.restore_session().await.unwrap();
    assert_eq!(restarted.snapshot().activity, retained);
    restarted.reconcile().await.unwrap();
    let after = diagnostics(&mut restarted).await;
    assert_eq!(after["history"]["activityRows"], 500);
    assert_eq!(after["history"]["candidateRows"], history["candidateRows"]);
    assert_eq!(
        after["history"]["campaignFolderBindings"],
        history["campaignFolderBindings"]
    );
    assert_eq!(fs::read(&original).unwrap(), b"durable local work");
    assert_eq!(restarted.snapshot().campaigns[0].candidates.len(), 1);
}

#[tokio::test]
async fn activity_records_campaign_transitions_without_recording_each_countdown_second() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("root");
    fs::create_dir(&root).unwrap();
    let remote = Arc::new(Remote::default());
    remote.can_submit.store(true, Ordering::SeqCst);
    let platform = Arc::new(Platform {
        root: root.clone(),
        clock: AtomicU64::new(1_789_257_600_000),
    });
    let mut engine = signed_in(
        &temporary.path().join("state/companion.sqlite3"),
        remote,
        platform.clone(),
        Arc::new(Vault::default()),
    )
    .await;
    let folder = fs::read_dir(&root).unwrap().next().unwrap().unwrap().path();
    fs::write(folder.join("turn.se1"), b"completed turn").unwrap();
    engine.reconcile().await.unwrap();
    engine.reconcile().await.unwrap();
    let countdown = engine.snapshot().campaigns[0].countdown.clone().unwrap();
    assert!(engine.snapshot().activity.iter().any(|event| {
        event.campaign_name.contains("Private Campaign")
            && event.description.contains("Automatic Send")
    }));
    let count = diagnostics(&mut engine).await["history"]["activityRows"].clone();
    for _ in 0..5 {
        platform.clock.fetch_add(1_000, Ordering::SeqCst);
        engine.reconcile().await.unwrap();
    }
    assert_eq!(
        engine.snapshot().campaigns[0]
            .countdown
            .as_ref()
            .unwrap()
            .remaining_seconds,
        10
    );
    assert_eq!(
        diagnostics(&mut engine).await["history"]["activityRows"],
        count
    );
    engine
        .command(Command::CancelAutomaticSend {
            campaign_id: "private-campaign-id".into(),
            authorization_id: countdown.authorization_id,
        })
        .await
        .unwrap();
    assert_eq!(
        diagnostics(&mut engine).await["history"]["activityRows"]
            .as_u64()
            .unwrap(),
        count.as_u64().unwrap() + 1
    );
    assert!(engine.snapshot().activity[0]
        .description
        .contains("Turn candidate"));
}

#[tokio::test]
async fn account_switching_hides_previous_activity_and_clears_generated_diagnostics() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("root");
    fs::create_dir(&root).unwrap();
    let remote = Arc::new(Remote::default());
    let mut engine = signed_in(
        &temporary.path().join("state/companion.sqlite3"),
        remote.clone(),
        Arc::new(Platform {
            root,
            clock: AtomicU64::new(1_789_257_600_000),
        }),
        Arc::new(Vault::default()),
    )
    .await;
    let previous_ids: Vec<_> = engine
        .snapshot()
        .activity
        .iter()
        .map(|event| event.id.clone())
        .collect();
    assert!(!previous_ids.is_empty());
    diagnostics(&mut engine).await;
    let signed_out = serde_json::to_value(engine.command(Command::SignOut).await.unwrap()).unwrap();
    assert_eq!(signed_out["activity"], serde_json::json!([]));
    assert!(signed_out["diagnostics"].is_null());
    *remote.account.lock().unwrap() = "private-account-b".into();
    engine
        .command(Command::SubmitHandoffToken {
            token: "private-handoff-b".into(),
        })
        .await
        .unwrap();
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.reconcile().await.unwrap();
    assert!(!engine.snapshot().activity.is_empty());
    assert!(engine
        .snapshot()
        .activity
        .iter()
        .all(|event| !previous_ids.contains(&event.id)));
    engine.command(Command::SignOut).await.unwrap();
    *remote.account.lock().unwrap() = "private-account-a".into();
    engine
        .command(Command::SubmitHandoffToken {
            token: "private-handoff-a".into(),
        })
        .await
        .unwrap();
    engine.command(Command::ContinueOnboarding).await.unwrap();
    engine.reconcile().await.unwrap();
    assert!(previous_ids.iter().all(|id| engine
        .snapshot()
        .activity
        .iter()
        .any(|event| &event.id == id)));
}

#[tokio::test]
async fn an_activity_write_failure_does_not_prevent_durable_pause_or_remove_local_work() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("root");
    fs::create_dir(&root).unwrap();
    let database = temporary.path().join("state/companion.sqlite3");
    let remote = Arc::new(Remote::default());
    let platform = Arc::new(Platform {
        root: root.clone(),
        clock: AtomicU64::new(1_789_257_600_000),
    });
    let vault = Arc::new(Vault::default());
    let mut engine = signed_in(&database, remote.clone(), platform.clone(), vault.clone()).await;
    let folder = fs::read_dir(&root).unwrap().next().unwrap().unwrap().path();
    let original = folder.join("turn.se1");
    fs::write(&original, b"local work survives diagnostic failure").unwrap();
    engine.reconcile().await.unwrap();
    let before = engine.snapshot().activity;
    // Fault injection targets only optional activity persistence; assertions use
    // the public command/snapshot interface and the player's actual file.
    let failure = rusqlite::Connection::open(&database).unwrap();
    failure.execute_batch("CREATE TRIGGER fail_activity BEFORE INSERT ON recent_activity BEGIN SELECT RAISE(ABORT,'activity storage unavailable'); END;").unwrap();
    let paused = engine
        .command(Command::SetPaused { paused: true })
        .await
        .unwrap();
    assert!(paused.paused);
    assert_eq!(paused.activity, before);
    drop(engine);
    let mut restarted = Engine::open(&database, remote, platform, vault).unwrap();
    restarted.observe_protocol(Ok(RELEASE.into()));
    restarted.restore_session().await.unwrap();
    assert!(restarted.snapshot().paused);
    assert_eq!(
        fs::read(&original).unwrap(),
        b"local work survives diagnostic failure"
    );
    failure
        .execute_batch("DROP TRIGGER fail_activity;")
        .unwrap();
    restarted.reconcile().await.unwrap();
    assert!(restarted
        .snapshot()
        .activity
        .iter()
        .any(|event| event.description == "All Campaigns paused."));
}
