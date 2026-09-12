use async_trait::async_trait;
use sha2::{Digest, Sha256};
use shadow_cloud_companion_engine::*;
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};

fn hash(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

struct CampaignHistory {
    number: u32,
    publications: Vec<SavePublication>,
    can_submit: bool,
}

impl CampaignHistory {
    fn baseline(&self) -> String {
        format!(
            "campaign-{}-publication-{}",
            self.number,
            self.publications.len()
        )
    }
}

#[derive(Default)]
struct Cloud {
    campaigns: BTreeMap<String, CampaignHistory>,
    contents: HashMap<String, Arc<Vec<u8>>>,
    receipts: HashMap<String, SubmissionReceipt>,
    cursors: BTreeMap<String, Vec<u32>>,
}

impl Cloud {
    fn publish(&mut self, campaign: &str, bytes: &[u8], filename: &str) -> SavePublication {
        let content_hash = hash(bytes);
        self.contents
            .entry(content_hash.clone())
            .or_insert_with(|| Arc::new(bytes.to_vec()));
        let history = self.campaigns.get_mut(campaign).unwrap();
        let publication = history.publications.len() as u32 + 1;
        let save = SavePublication {
            publication,
            file_version_id: format!("{campaign}-save-{publication}"),
            content_revision: 0,
            content_hash,
            size: bytes.len() as u64,
            filename: filename.into(),
            published_at: "2026-09-12T12:00:00Z".into(),
        };
        history.publications.push(save.clone());
        save
    }
}

struct Remote {
    cloud: Mutex<Cloud>,
    observations: AtomicUsize,
    downloads: AtomicUsize,
    submissions: AtomicUsize,
    lookups: AtomicUsize,
    lose_response: AtomicBool,
}

impl Remote {
    fn new(campaigns: u32, initial: &[u8]) -> Self {
        let mut cloud = Cloud::default();
        for number in 1..=campaigns {
            let id = format!("campaign-{number:03}");
            cloud.campaigns.insert(
                id.clone(),
                CampaignHistory {
                    number,
                    publications: vec![],
                    can_submit: true,
                },
            );
            cloud.publish(&id, initial, "current.se1");
        }
        Self {
            cloud: Mutex::new(cloud),
            observations: AtomicUsize::new(0),
            downloads: AtomicUsize::new(0),
            submissions: AtomicUsize::new(0),
            lookups: AtomicUsize::new(0),
            lose_response: AtomicBool::new(false),
        }
    }

    fn credentials(device: &str) -> DeviceCredentials {
        serde_json::from_value(serde_json::json!({
            "accessToken": format!("synthetic-access-{device}"),
            "accessTokenExpiresAt": "2027-01-01T00:00:00Z",
            "refreshToken": device,
            "deviceSession": {
                "id": device,
                "expiresAt": "2027-01-01T00:00:00Z",
                "scopes": ["campaigns:observe", "saves:download", "turns:submit"],
                "user": {
                    "id": "synthetic-account",
                    "email": "synthetic@example.test",
                    "displayName": "Synthetic Player"
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

    async fn exchange_token(&self, device: &str) -> Result<DeviceCredentials, RemoteError> {
        Ok(Self::credentials(device))
    }

    async fn refresh(&self, device: &str) -> Result<DeviceCredentials, RemoteError> {
        Ok(Self::credentials(device))
    }

    async fn revoke(&self, _: &str) -> Result<(), RemoteError> {
        Ok(())
    }

    async fn observe(&self, _: &str) -> Result<Vec<ObservedCampaign>, ReceiveError> {
        self.observations.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .cloud
            .lock()
            .unwrap()
            .campaigns
            .iter()
            .map(|(id, history)| ObservedCampaign {
                id: id.clone(),
                number: history.number,
                name: format!("Synthetic Campaign {}", history.number),
                round: history.publications.len() as u32,
                active_lord: "Synthetic Player".into(),
                turn_started_at: None,
                current: history.publications.last().cloned(),
                baseline: history.baseline(),
                can_submit: history.can_submit,
            })
            .collect())
    }

    async fn publications(
        &self,
        _: &str,
        campaign: &str,
        after: u32,
    ) -> Result<PublicationPage, ReceiveError> {
        let mut cloud = self.cloud.lock().unwrap();
        cloud
            .cursors
            .entry(campaign.into())
            .or_default()
            .push(after);
        let history = cloud
            .campaigns
            .get(campaign)
            .ok_or(ReceiveError::Forbidden)?;
        Ok(PublicationPage {
            current: history.publications.last().cloned(),
            // Several pages exercise durable catch-up without thousands of files.
            publications: history
                .publications
                .iter()
                .filter(|save| save.publication > after)
                .take(25)
                .cloned()
                .collect(),
        })
    }

    async fn download(
        &self,
        _: &str,
        campaign: &str,
        save: &SavePublication,
    ) -> Result<Vec<u8>, ReceiveError> {
        self.downloads.fetch_add(1, Ordering::SeqCst);
        let cloud = self.cloud.lock().unwrap();
        let history = cloud
            .campaigns
            .get(campaign)
            .ok_or(ReceiveError::Forbidden)?;
        if !history.publications.contains(save) {
            return Err(ReceiveError::SaveChanged);
        }
        Ok(cloud.contents[&save.content_hash].as_ref().clone())
    }

    async fn submit(
        &self,
        _: &str,
        submission: &TurnSubmission,
        bytes: Vec<u8>,
    ) -> Result<SubmissionReceipt, ReceiveError> {
        self.submissions.fetch_add(1, Ordering::SeqCst);
        if bytes.len() as u64 != submission.size || hash(&bytes) != submission.content_hash {
            return Err(ReceiveError::RejectedSubmission);
        }
        let mut cloud = self.cloud.lock().unwrap();
        if let Some(receipt) = cloud.receipts.get(&submission.operation_key) {
            return if receipt.submission == *submission {
                Ok(receipt.clone())
            } else {
                Err(ReceiveError::RejectedSubmission)
            };
        }
        let campaign = cloud
            .campaigns
            .get(&submission.campaign_id)
            .ok_or(ReceiveError::Forbidden)?;
        if !campaign.can_submit || campaign.baseline() != submission.baseline {
            return Err(ReceiveError::StaleSubmission);
        }
        let save = cloud.publish(&submission.campaign_id, &bytes, &submission.filename);
        cloud
            .campaigns
            .get_mut(&submission.campaign_id)
            .unwrap()
            .can_submit = false;
        let receipt = SubmissionReceipt {
            submission: submission.clone(),
            file_version_id: save.file_version_id,
            publication: save.publication,
        };
        cloud
            .receipts
            .insert(submission.operation_key.clone(), receipt.clone());
        if self.lose_response.swap(false, Ordering::SeqCst) {
            Err(ReceiveError::Offline)
        } else {
            Ok(receipt)
        }
    }

    async fn receipt(&self, _: &str, key: &str) -> Result<Option<SubmissionReceipt>, ReceiveError> {
        self.lookups.fetch_add(1, Ordering::SeqCst);
        Ok(self.cloud.lock().unwrap().receipts.get(key).cloned())
    }
}

struct Platform(PathBuf);

impl CompanionPlatform for Platform {
    fn now_millis(&self) -> u64 {
        1_789_214_400_000
    }

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

struct Device {
    _temporary: tempfile::TempDir,
    database: PathBuf,
    root: PathBuf,
    vault: Arc<Vault>,
    remote: Arc<Remote>,
    engine: Engine,
}

impl Device {
    async fn new(remote: Arc<Remote>, name: &str) -> Self {
        let temporary = tempfile::tempdir().unwrap();
        let database = temporary.path().join("state/companion.sqlite3");
        let root = temporary.path().join("root");
        fs::create_dir(&root).unwrap();
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
            Command::SubmitHandoffToken { token: name.into() },
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
        Self {
            _temporary: temporary,
            database,
            root,
            vault,
            remote,
            engine,
        }
    }

    fn folder(&self) -> PathBuf {
        assert_eq!(self.engine.snapshot().campaigns.len(), 1);
        fs::read_dir(&self.root)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path()
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

    async fn diagnostics(&mut self) -> serde_json::Value {
        let snapshot = self
            .engine
            .command(Command::GenerateDiagnostics)
            .await
            .unwrap();
        serde_json::from_str(snapshot.diagnostics.as_ref().unwrap()).unwrap()
    }

    async fn scan_stable(&mut self) -> Snapshot {
        self.engine.reconcile().await.unwrap();
        self.engine.reconcile().await.unwrap()
    }

    fn send(hash: &str) -> Command {
        Command::CandidateAction {
            campaign_id: "campaign-001".into(),
            content_hash: hash.into(),
            action: CandidateAction::Send,
        }
    }
}

#[tokio::test]
async fn hundred_campaigns_receive_ten_thousand_publications_in_order_across_restart() {
    let started = Instant::now();
    let bytes = b"synthetic repeated canonical contents";
    let remote = Arc::new(Remote::new(100, bytes));
    let mut device = Device::new(remote.clone(), "scale-device").await;
    assert_eq!(device.engine.snapshot().campaigns.len(), 100);
    assert_eq!(remote.downloads.load(Ordering::SeqCst), 100);
    {
        let mut cloud = remote.cloud.lock().unwrap();
        for number in 1..=100 {
            for _ in 1..100 {
                cloud.publish(&format!("campaign-{number:03}"), bytes, "current.se1");
            }
        }
    }
    // A page covers 25 new publications, so four passes must finish 99 per Campaign.
    for pass in 0..4 {
        device.engine.reconcile().await.unwrap();
        if pass == 1 {
            assert_eq!(
                device.diagnostics().await["history"]["receivedPublicationRows"],
                5_100
            );
            device.restart().await;
        }
    }
    let snapshot = device.engine.snapshot();
    assert_eq!(snapshot.campaigns.len(), 100);
    assert!(snapshot.campaigns.iter().all(|campaign| {
        campaign.sync_status == SyncStatus::Synchronized
            && campaign.candidates.is_empty()
            && campaign.archive_bytes == bytes.len() as u64
    }));
    let diagnostics = device.diagnostics().await;
    assert_eq!(diagnostics["history"]["receivedPublicationRows"], 10_000);
    assert_eq!(diagnostics["history"]["campaignFolderBindings"], 100);
    device.restart().await;
    device.engine.reconcile().await.unwrap();
    assert_eq!(
        device.diagnostics().await["history"]["receivedPublicationRows"],
        10_000
    );
    assert_eq!(remote.downloads.load(Ordering::SeqCst), 100);
    assert_eq!(remote.submissions.load(Ordering::SeqCst), 0);
    // Bound network work and monotonic cursors, not machine-dependent wall time.
    assert!(remote.observations.load(Ordering::SeqCst) <= 110);
    let cloud = remote.cloud.lock().unwrap();
    assert_eq!(cloud.cursors.len(), 100);
    for cursors in cloud.cursors.values() {
        assert_eq!(cursors, &[0, 1, 26, 51, 76, 100]);
    }
    for folder in fs::read_dir(&device.root).unwrap() {
        let folder = folder.unwrap().path();
        assert_eq!(fs::read(folder.join("current.se1")).unwrap(), bytes);
        assert_eq!(
            fs::read_dir(folder).unwrap().count(),
            2,
            "only the save and ownership marker"
        );
    }
    eprintln!(
        "100 Campaigns / 10,000 publication rows: {:?}, {} observations, {} downloads",
        started.elapsed(),
        remote.observations.load(Ordering::SeqCst),
        remote.downloads.load(Ordering::SeqCst)
    );
}

#[tokio::test]
async fn thousand_files_remain_distinct_candidates_without_overwrite_or_automatic_send() {
    let remote = Arc::new(Remote::new(1, b"received canonical save"));
    let mut device = Device::new(remote.clone(), "large-folder-device").await;
    let folder = device.folder();
    for number in 1..1_000 {
        fs::write(
            folder.join(format!("local-{number:04}.se1")),
            format!("synthetic local turn {number}"),
        )
        .unwrap();
    }
    let started = Instant::now();
    let snapshot = device.scan_stable().await;
    let candidates = &snapshot.campaigns[0].candidates;
    assert_eq!(candidates.len(), 999);
    assert!(candidates
        .iter()
        .all(|candidate| candidate.stable && candidate.can_send));
    assert!(snapshot.campaigns[0].countdown.is_none());
    let ignored_hash = candidates[500].content_hash.clone();
    device
        .engine
        .command(Command::CandidateAction {
            campaign_id: "campaign-001".into(),
            content_hash: ignored_hash.clone(),
            action: CandidateAction::Ignore,
        })
        .await
        .unwrap();
    device.restart().await;
    let restarted = device.scan_stable().await;
    assert_eq!(restarted.campaigns[0].candidates.len(), 999);
    assert_eq!(
        restarted.campaigns[0]
            .candidates
            .iter()
            .filter(|candidate| candidate.ignored)
            .map(|candidate| candidate.content_hash.as_str())
            .collect::<Vec<_>>(),
        vec![ignored_hash.as_str()]
    );
    let diagnostics = device.diagnostics().await;
    assert_eq!(diagnostics["history"]["candidateRows"], 999);
    assert_eq!(diagnostics["history"]["receivedPublicationRows"], 1);
    assert_eq!(
        fs::read_dir(&folder).unwrap().count(),
        1_001,
        "1,000 saves plus the ownership marker"
    );
    assert_eq!(
        fs::read(folder.join("current.se1")).unwrap(),
        b"received canonical save"
    );
    for number in 1..1_000 {
        assert_eq!(
            fs::read(folder.join(format!("local-{number:04}.se1"))).unwrap(),
            format!("synthetic local turn {number}").as_bytes()
        );
    }
    assert_eq!(remote.submissions.load(Ordering::SeqCst), 0);
    assert_eq!(remote.downloads.load(Ordering::SeqCst), 1);
    assert!(remote.observations.load(Ordering::SeqCst) <= 8);
    eprintln!(
        "1,000 files / four scans and restart: {:?}, {} observations, {} downloads",
        started.elapsed(),
        remote.observations.load(Ordering::SeqCst),
        remote.downloads.load(Ordering::SeqCst)
    );
}

#[tokio::test]
async fn twenty_five_mib_save_receives_and_submits_exact_contents_without_losing_either_file() {
    let started = Instant::now();
    let received = vec![b'A'; 25 * 1024 * 1024];
    let local = vec![b'B'; 25 * 1024 * 1024];
    let remote = Arc::new(Remote::new(1, &received));
    let mut device = Device::new(remote.clone(), "large-save-device").await;
    let folder = device.folder();
    assert_eq!(fs::read(folder.join("current.se1")).unwrap(), received);
    fs::write(folder.join("local.se1"), &local).unwrap();
    let snapshot = device.scan_stable().await;
    let candidate = &snapshot.campaigns[0].candidates[0];
    assert_eq!(candidate.size, 25 * 1024 * 1024);
    assert_eq!(candidate.content_hash, hash(&local));
    assert!(candidate.can_send);
    device
        .engine
        .command(Device::send(&candidate.content_hash))
        .await
        .unwrap();
    device.restart().await;
    let snapshot = device.scan_stable().await;
    assert!(snapshot.campaigns[0].candidates.is_empty());
    assert_eq!(snapshot.campaigns[0].sync_status, SyncStatus::Synchronized);
    assert_eq!(snapshot.campaigns[0].archive_bytes, 50 * 1024 * 1024);
    assert_eq!(fs::read(folder.join("current.se1")).unwrap(), received);
    assert_eq!(fs::read(folder.join("local.se1")).unwrap(), local);
    assert_eq!(fs::read_dir(folder).unwrap().count(), 3);
    let diagnostics = device.diagnostics().await;
    assert_eq!(diagnostics["counts"]["pendingSubmissions"], 0);
    assert_eq!(diagnostics["history"]["submissionRows"], 1);
    assert_eq!(diagnostics["history"]["receivedPublicationRows"], 2);
    let cloud = remote.cloud.lock().unwrap();
    assert_eq!(cloud.receipts.len(), 1);
    let receipt = cloud.receipts.values().next().unwrap();
    assert_eq!(receipt.submission.content_hash, hash(&local));
    assert_eq!(receipt.submission.size, 25 * 1024 * 1024);
    assert_eq!(
        cloud.contents[&receipt.submission.content_hash].as_slice(),
        local
    );
    assert_eq!(cloud.campaigns["campaign-001"].publications.len(), 2);
    assert_eq!(remote.submissions.load(Ordering::SeqCst), 1);
    assert_eq!(remote.downloads.load(Ordering::SeqCst), 1);
    assert!(remote.observations.load(Ordering::SeqCst) <= 10);
    eprintln!(
        "25 MiB receive / manual Send / restart: {:?}, {} observations, {} downloads",
        started.elapsed(),
        remote.observations.load(Ordering::SeqCst),
        remote.downloads.load(Ordering::SeqCst)
    );
}

#[tokio::test]
async fn two_devices_preserve_local_work_and_resolve_one_immutable_receipt_after_a_lost_response() {
    let remote = Arc::new(Remote::new(1, b"shared canonical save"));
    let mut first = Device::new(remote.clone(), "first-device").await;
    let mut second = Device::new(remote.clone(), "second-device").await;
    let first_file = first.folder().join("local.se1");
    let second_file = second.folder().join("local.se1");
    let first_bytes = b"first device authorized contents";
    let second_bytes = b"second device independent local work";
    fs::write(&first_file, first_bytes).unwrap();
    fs::write(&second_file, second_bytes).unwrap();
    let first_snapshot = first.scan_stable().await;
    let second_snapshot = second.scan_stable().await;
    let first_candidate = &first_snapshot.campaigns[0].candidates[0];
    let second_candidate = &second_snapshot.campaigns[0].candidates[0];
    assert!(first_candidate.can_send && second_candidate.can_send);

    // Both devices saw the same baseline. The first request commits, but its
    // response is lost; the second device still has its old snapshot.
    remote.lose_response.store(true, Ordering::SeqCst);
    first
        .engine
        .command(Device::send(&first_candidate.content_hash))
        .await
        .unwrap();
    assert_eq!(first.diagnostics().await["counts"]["pendingSubmissions"], 1);
    let immutable = remote
        .cloud
        .lock()
        .unwrap()
        .receipts
        .values()
        .next()
        .unwrap()
        .clone();
    assert_eq!(immutable.submission.content_hash, hash(first_bytes));
    assert!(second
        .engine
        .command(Device::send(&second_candidate.content_hash))
        .await
        .is_err());
    let second_snapshot = second.engine.reconcile().await.unwrap();
    assert_eq!(
        second_snapshot.campaigns[0].sync_status,
        SyncStatus::Conflict
    );
    assert!(second_snapshot.campaigns[0]
        .candidates
        .iter()
        .all(|candidate| !candidate.can_send));
    assert_eq!(fs::read(&second_file).unwrap(), second_bytes);

    // Mutating a filename after dispatch cannot change the already accepted
    // operation, and receipt recovery cannot replace the newer local work.
    let later_bytes = b"first device additional work after dispatch";
    fs::write(&first_file, later_bytes).unwrap();
    first.restart().await;
    let recovered = first.scan_stable().await;
    assert_eq!(first.diagnostics().await["counts"]["pendingSubmissions"], 0);
    assert_eq!(recovered.campaigns[0].candidates.len(), 1);
    assert_eq!(
        recovered.campaigns[0].candidates[0].content_hash,
        hash(later_bytes)
    );
    assert_eq!(fs::read(&first_file).unwrap(), later_bytes);
    for device in [&first, &second] {
        assert_eq!(
            fs::read(device.folder().join("current.se1")).unwrap(),
            b"shared canonical save"
        );
    }
    second.restart().await;
    let second_snapshot = second.scan_stable().await;
    assert_eq!(
        second_snapshot.campaigns[0].sync_status,
        SyncStatus::Conflict
    );
    assert_eq!(
        second_snapshot.campaigns[0].candidates[0].content_hash,
        hash(second_bytes)
    );
    assert_eq!(fs::read(second_file).unwrap(), second_bytes);

    let cloud = remote.cloud.lock().unwrap();
    assert_eq!(cloud.receipts.len(), 1);
    assert_eq!(
        cloud.receipts[&immutable.submission.operation_key],
        immutable
    );
    assert_eq!(
        cloud.contents[&immutable.submission.content_hash].as_slice(),
        first_bytes
    );
    assert_eq!(cloud.campaigns["campaign-001"].publications.len(), 2);
    assert_eq!(remote.submissions.load(Ordering::SeqCst), 1);
    assert_eq!(remote.lookups.load(Ordering::SeqCst), 1);
    assert_eq!(remote.downloads.load(Ordering::SeqCst), 2);
}
