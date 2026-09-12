use async_trait::async_trait;
use shadow_cloud_companion_engine::*;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

fn credentials() -> DeviceCredentials {
    DeviceCredentials {
        access_token: "synthetic-access".into(),
        access_token_expires_at: "2026-09-12T12:00:00Z".into(),
        refresh_token: "synthetic-refresh".into(),
        device_session: DeviceSessionProfile {
            id: "synthetic-device".into(),
            expires_at: "2027-01-01T00:00:00Z".into(),
            scopes: vec![
                "campaigns:observe".into(),
                "saves:download".into(),
                "turns:submit".into(),
            ],
            user: DeviceUser {
                id: "account-1".into(),
                email: "synthetic@example.test".into(),
                display_name: "Synthetic".into(),
            },
        },
    }
}
struct Platform(PathBuf);
impl CompanionPlatform for Platform {
    fn open_url(&self, _: &str) -> Result<(), ()> {
        Ok(())
    }
    fn choose_directory(&self) -> Result<Option<PathBuf>, ()> {
        Ok(Some(self.0.clone()))
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
struct Remote {
    observations: Mutex<Vec<ObservedCampaign>>,
    submitted: Mutex<Vec<(TurnSubmission, Vec<u8>)>>,
    receipts: Mutex<HashMap<String, SubmissionReceipt>>,
    lookups: Mutex<Vec<String>>,
    accept: AtomicBool,
    lose_response: AtomicBool,
}
impl Remote {
    fn new() -> Self {
        Self {
            observations: Mutex::new(vec![ObservedCampaign {
                id: "campaign-1".into(),
                number: 1,
                name: "Synthetic".into(),
                round: 1,
                active_lord: "Synthetic".into(),
                turn_started_at: None,
                current: None,
                baseline: "baseline-1".into(),
                can_submit: true,
            }]),
            submitted: Mutex::new(vec![]),
            receipts: Mutex::new(HashMap::new()),
            lookups: Mutex::new(vec![]),
            accept: AtomicBool::new(false),
            lose_response: AtomicBool::new(false),
        }
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
        Ok(credentials())
    }
    async fn refresh(&self, _: &str) -> Result<DeviceCredentials, RemoteError> {
        Ok(credentials())
    }
    async fn revoke(&self, _: &str) -> Result<(), RemoteError> {
        Ok(())
    }
    async fn observe(&self, _: &str) -> Result<Vec<ObservedCampaign>, ReceiveError> {
        Ok(self.observations.lock().unwrap().clone())
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
    async fn submit(
        &self,
        _: &str,
        submission: &TurnSubmission,
        bytes: Vec<u8>,
    ) -> Result<SubmissionReceipt, ReceiveError> {
        self.submitted
            .lock()
            .unwrap()
            .push((submission.clone(), bytes));
        if !self.accept.load(Ordering::SeqCst) {
            return Err(ReceiveError::Offline);
        }
        let receipt = SubmissionReceipt {
            submission: submission.clone(),
            file_version_id: "accepted-file".into(),
            publication: 1,
        };
        self.receipts
            .lock()
            .unwrap()
            .insert(submission.operation_key.clone(), receipt.clone());
        if self.lose_response.load(Ordering::SeqCst) {
            Err(ReceiveError::Offline)
        } else {
            Ok(receipt)
        }
    }
    async fn receipt(&self, _: &str, key: &str) -> Result<Option<SubmissionReceipt>, ReceiveError> {
        self.lookups.lock().unwrap().push(key.into());
        Ok(self.receipts.lock().unwrap().get(key).cloned())
    }
}
struct Fixture {
    _temp: tempfile::TempDir,
    root: PathBuf,
    database: PathBuf,
    file: PathBuf,
    engine: Engine,
    remote: Arc<Remote>,
    vault: Arc<Vault>,
}
impl Fixture {
    async fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        fs::create_dir(&root).unwrap();
        let database = temp.path().join("state/companion.sqlite3");
        let remote = Arc::new(Remote::new());
        let vault = Arc::new(Vault::default());
        let mut engine = Engine::open(
            &database,
            remote.clone(),
            Arc::new(Platform(root.clone())),
            vault.clone(),
        )
        .unwrap();
        engine.observe_protocol(Ok(RELEASE.into()));
        for command in [
            Command::ContinueOnboarding,
            Command::SubmitHandoffToken {
                token: "synthetic".into(),
            },
            Command::ContinueOnboarding,
            Command::ChooseCompanionRoot,
            Command::ContinueOnboarding,
            Command::SetAutomaticUploads { enabled: false },
            Command::ContinueOnboarding,
            Command::CompleteOnboarding,
        ] {
            engine.command(command).await.unwrap();
        }
        engine.reconcile().await.unwrap();
        let folder = fs::read_dir(&root).unwrap().next().unwrap().unwrap().path();
        let file = folder.join("my-turn.se1");
        fs::write(&file, b"authorized immutable bytes").unwrap();
        engine.reconcile().await.unwrap();
        engine.reconcile().await.unwrap();
        Self {
            _temp: temp,
            root,
            database,
            file,
            engine,
            remote,
            vault,
        }
    }
    async fn send(&mut self) {
        let candidate = self.engine.snapshot().campaigns[0].candidates[0].clone();
        assert!(candidate.can_send);
        self.engine
            .command(Command::CandidateAction {
                campaign_id: "campaign-1".into(),
                content_hash: candidate.content_hash,
                action: CandidateAction::Send,
            })
            .await
            .unwrap();
    }
    async fn restart(&mut self) {
        self.engine = Engine::open(
            &self.database,
            self.remote.clone(),
            Arc::new(Platform(self.root.clone())),
            self.vault.clone(),
        )
        .unwrap();
        self.engine.observe_protocol(Ok(RELEASE.into()));
        self.engine.restore_session().await.unwrap();
    }
    async fn prepare_without_dispatch(&mut self) {
        let failure = rusqlite::Connection::open(&self.database).unwrap();
        failure.execute_batch("CREATE TRIGGER interrupted_dispatch BEFORE UPDATE OF state ON turn_submissions WHEN NEW.state='dispatched' BEGIN SELECT RAISE(ABORT,'synthetic disk failure'); END;").unwrap();
        self.send().await;
        assert!(self.remote.submitted.lock().unwrap().is_empty());
        failure
            .execute_batch("DROP TRIGGER interrupted_dispatch;")
            .unwrap();
    }
}
fn stages(folder: &Path) -> Vec<PathBuf> {
    fs::read_dir(folder)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| {
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with(".shadow-cloud-send-")
        })
        .collect()
}

#[tokio::test]
async fn never_dispatched_manual_work_loses_authorization_when_membership_permission_or_baseline_changes(
) {
    for change in ["membership", "permission", "baseline"] {
        let mut f = Fixture::new().await;
        f.prepare_without_dispatch().await;
        let original = f.remote.observations.lock().unwrap().clone();
        {
            let mut observations = f.remote.observations.lock().unwrap();
            match change {
                "membership" => observations.clear(),
                "permission" => observations[0].can_submit = false,
                _ => observations[0].baseline = "baseline-2".into(),
            }
        }
        f.restart().await;
        f.engine.reconcile().await.unwrap();
        assert!(f.remote.submitted.lock().unwrap().is_empty(), "{change}");
        assert_eq!(fs::read(&f.file).unwrap(), b"authorized immutable bytes");
        // Restoring the prior observation cannot revive the withdrawn operation.
        *f.remote.observations.lock().unwrap() = original;
        f.engine.reconcile().await.unwrap();
        assert!(f.remote.submitted.lock().unwrap().is_empty(), "{change}");
    }
}

#[tokio::test]
async fn never_dispatched_manual_work_is_cancelled_after_live_mutation_or_disappearance() {
    for change in ["contents", "folder", "root"] {
        let mut f = Fixture::new().await;
        f.prepare_without_dispatch().await;
        let original = f.file.clone();
        let moved = f._temp.path().join("preserved-outside-root");
        match change {
            "contents" => fs::write(&f.file, b"changed local turn").unwrap(),
            "folder" => fs::rename(f.file.parent().unwrap(), &moved).unwrap(),
            _ => fs::rename(&f.root, &moved).unwrap(),
        }
        f.restart().await;
        f.engine.reconcile().await.unwrap();
        assert!(f.remote.submitted.lock().unwrap().is_empty());
        match change {
            "contents" => assert_eq!(fs::read(&f.file).unwrap(), b"changed local turn"),
            "folder" => {
                assert!(!original.parent().unwrap().exists());
                fs::rename(&moved, original.parent().unwrap()).unwrap();
            }
            _ => {
                assert!(!f.root.exists());
                fs::rename(&moved, &f.root).unwrap();
            }
        }
        f.engine.reconcile().await.unwrap();
        assert!(
            f.remote.submitted.lock().unwrap().is_empty(),
            "{change} must require a new Send"
        );
    }
}

#[tokio::test]
async fn a_valid_prepared_manual_submission_resumes_from_its_immutable_stage() {
    let mut f = Fixture::new().await;
    f.prepare_without_dispatch().await;
    let stage = stages(f.file.parent().unwrap());
    assert_eq!(stage.len(), 1);
    let expected_key = stage[0]
        .file_name()
        .unwrap()
        .to_str()
        .unwrap()
        .strip_prefix(".shadow-cloud-send-")
        .unwrap()
        .to_owned();
    f.remote.accept.store(true, Ordering::SeqCst);
    f.restart().await;
    f.engine.reconcile().await.unwrap();
    let submitted = f.remote.submitted.lock().unwrap();
    assert_eq!(submitted.len(), 1);
    assert_eq!(submitted[0].0.operation_key, expected_key);
    assert_eq!(submitted[0].1, b"authorized immutable bytes");
    assert_eq!(fs::read(&f.file).unwrap(), b"authorized immutable bytes");
}

#[tokio::test]
async fn an_uncertain_submission_is_not_retried_against_changed_membership_permission_or_baseline()
{
    for change in ["membership", "permission", "baseline"] {
        let mut f = Fixture::new().await;
        f.send().await;
        {
            let mut observations = f.remote.observations.lock().unwrap();
            match change {
                "membership" => observations.clear(),
                "permission" => observations[0].can_submit = false,
                _ => observations[0].baseline = "baseline-2".into(),
            }
        }
        f.restart().await;
        let snapshot = f.engine.reconcile().await.unwrap();
        assert_eq!(f.remote.submitted.lock().unwrap().len(), 1, "{change}");
        assert_eq!(f.remote.lookups.lock().unwrap().len(), 1);
        assert!(
            snapshot
                .campaigns
                .iter()
                .any(|campaign| campaign.id == "campaign-1"
                    && campaign.status_label == "Checking submission receipt"),
            "{change}: {:?}",
            snapshot
                .campaigns
                .iter()
                .map(|campaign| &campaign.status_label)
                .collect::<Vec<_>>()
        );
        assert_eq!(fs::read(&f.file).unwrap(), b"authorized immutable bytes");
    }
}

#[tokio::test]
async fn an_uncertain_submission_keeps_its_bytes_and_key_across_pause_missing_folder_and_local_edits(
) {
    let mut f = Fixture::new().await;
    f.send().await;
    let submission = f.remote.submitted.lock().unwrap()[0].clone();
    f.engine
        .command(Command::SetPaused { paused: true })
        .await
        .unwrap();
    fs::write(&f.file, b"later local candidate").unwrap();
    f.restart().await;
    f.engine.reconcile().await.unwrap();
    assert_eq!(f.remote.submitted.lock().unwrap().len(), 1);
    let folder = f.file.parent().unwrap().to_owned();
    let moved = f._temp.path().join("moved-campaign");
    fs::rename(&folder, &moved).unwrap();
    f.engine
        .command(Command::SetPaused { paused: false })
        .await
        .unwrap();
    f.engine.reconcile().await.unwrap();
    assert_eq!(f.remote.submitted.lock().unwrap().len(), 1);
    assert!(!folder.exists());
    fs::rename(&moved, &folder).unwrap();
    f.remote.accept.store(true, Ordering::SeqCst);
    f.engine.reconcile().await.unwrap();
    let submitted = f.remote.submitted.lock().unwrap();
    assert_eq!(submitted.len(), 2);
    assert_eq!(submitted[1], submission);
    assert_eq!(fs::read(&f.file).unwrap(), b"later local candidate");
}

#[tokio::test]
async fn accepted_lost_responses_resolve_while_paused_without_root_or_membership_and_do_not_touch_files(
) {
    let mut f = Fixture::new().await;
    f.remote.accept.store(true, Ordering::SeqCst);
    f.remote.lose_response.store(true, Ordering::SeqCst);
    f.send().await;
    f.engine
        .command(Command::SetPaused { paused: true })
        .await
        .unwrap();
    f.remote.observations.lock().unwrap().clear();
    let moved = f._temp.path().join("preserved-root");
    let relative = f.file.strip_prefix(&f.root).unwrap().to_owned();
    fs::rename(&f.root, &moved).unwrap();
    f.restart().await;
    f.engine.reconcile().await.unwrap();
    f.engine.reconcile().await.unwrap();
    assert_eq!(f.remote.submitted.lock().unwrap().len(), 1);
    assert_eq!(
        f.remote.lookups.lock().unwrap().len(),
        1,
        "accepted receipts resolve the operation even after membership loss"
    );
    assert!(!f.root.exists());
    assert_eq!(
        fs::read(moved.join(&relative)).unwrap(),
        b"authorized immutable bytes"
    );
    assert_eq!(
        stages(moved.join(relative).parent().unwrap()).len(),
        1,
        "Pause must also defer resolved staging cleanup"
    );
}

#[tokio::test]
async fn resolving_an_operation_does_not_delete_changed_contents_at_its_old_stage_name() {
    let mut f = Fixture::new().await;
    f.remote.accept.store(true, Ordering::SeqCst);
    f.remote.lose_response.store(true, Ordering::SeqCst);
    f.send().await;
    f.engine
        .command(Command::SetPaused { paused: true })
        .await
        .unwrap();
    let stage = stages(f.file.parent().unwrap()).pop().unwrap();
    fs::write(
        &stage,
        b"replacement contents are not the engine staging copy",
    )
    .unwrap();
    f.restart().await;
    f.engine.reconcile().await.unwrap();
    f.engine
        .command(Command::SetPaused { paused: false })
        .await
        .unwrap();
    f.engine.reconcile().await.unwrap();
    assert_eq!(
        fs::read(stage).unwrap(),
        b"replacement contents are not the engine staging copy"
    );
    assert_eq!(fs::read(&f.file).unwrap(), b"authorized immutable bytes");
}

#[tokio::test]
async fn ignoring_prepared_work_withdraws_its_send_even_if_restored_before_restart() {
    let mut f = Fixture::new().await;
    f.prepare_without_dispatch().await;
    let hash = f.engine.snapshot().campaigns[0].candidates[0]
        .content_hash
        .clone();
    for action in [CandidateAction::Ignore, CandidateAction::Restore] {
        f.engine
            .command(Command::CandidateAction {
                campaign_id: "campaign-1".into(),
                content_hash: hash.clone(),
                action,
            })
            .await
            .unwrap();
    }
    f.remote.accept.store(true, Ordering::SeqCst);
    f.restart().await;
    let snapshot = f.engine.reconcile().await.unwrap();
    assert!(f.remote.submitted.lock().unwrap().is_empty());
    assert!(snapshot.campaigns[0]
        .candidates
        .iter()
        .any(|c| c.content_hash == hash && !c.ignored));
    assert_eq!(fs::read(f.file).unwrap(), b"authorized immutable bytes");
}
