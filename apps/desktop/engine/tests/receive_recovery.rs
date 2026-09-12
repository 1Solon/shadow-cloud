use async_trait::async_trait;
use sha2::{Digest, Sha256};
use shadow_cloud_companion_engine::*;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
};

type Hook = Box<dyn FnOnce(&Remote) + Send>;
type Saves = BTreeMap<String, Vec<(SavePublication, Vec<u8>)>>;
struct Remote {
    account: Mutex<String>,
    saves: Mutex<Saves>,
    during_page: Mutex<Option<Hook>>,
    during_download: Mutex<Option<Hook>>,
    observations: AtomicUsize,
    downloads: AtomicUsize,
}
impl Remote {
    fn new() -> Self {
        Self {
            account: Mutex::new("account-1".into()),
            saves: Mutex::new(BTreeMap::new()),
            during_page: Mutex::new(None),
            during_download: Mutex::new(None),
            observations: AtomicUsize::new(0),
            downloads: AtomicUsize::new(0),
        }
    }
    fn publish(&self, campaign: &str, bytes: &[u8]) {
        let mut all = self.saves.lock().unwrap();
        let saves = all.entry(campaign.into()).or_default();
        let publication = saves.len() as u32 + 1;
        saves.push((
            SavePublication {
                publication,
                file_version_id: format!("{campaign}-file-{publication}"),
                content_revision: 0,
                content_hash: format!("sha256:{:x}", Sha256::digest(bytes)),
                size: bytes.len() as u64,
                filename: "turn.se1".into(),
                published_at: "2026-09-12T12:00:00Z".into(),
            },
            bytes.to_vec(),
        ));
    }
    fn replace(&self, campaign: &str, bytes: &[u8]) {
        let mut all = self.saves.lock().unwrap();
        let (save, contents) = all.get_mut(campaign).unwrap().last_mut().unwrap();
        save.content_revision += 1;
        save.content_hash = format!("sha256:{:x}", Sha256::digest(bytes));
        save.size = bytes.len() as u64;
        *contents = bytes.to_vec();
    }
    fn credentials(&self) -> DeviceCredentials {
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
                    id: self.account.lock().unwrap().clone(),
                    email: "synthetic@example.test".into(),
                    display_name: "Synthetic".into(),
                },
            },
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
        Ok(self.credentials())
    }
    async fn refresh(&self, _: &str) -> Result<DeviceCredentials, RemoteError> {
        Ok(self.credentials())
    }
    async fn revoke(&self, _: &str) -> Result<(), RemoteError> {
        Ok(())
    }
    async fn observe(&self, _: &str) -> Result<Vec<ObservedCampaign>, ReceiveError> {
        self.observations.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .saves
            .lock()
            .unwrap()
            .iter()
            .enumerate()
            .map(|(index, (id, saves))| {
                let current = saves.last().map(|(save, _)| save.clone());
                ObservedCampaign {
                    id: id.clone(),
                    number: index as u32 + 1,
                    name: id.clone(),
                    round: 1,
                    active_lord: "Synthetic".into(),
                    turn_started_at: None,
                    baseline: format!(
                        "baseline-{}-{}",
                        saves.len(),
                        current.as_ref().map_or(0, |save| save.content_revision)
                    ),
                    can_submit: true,
                    current,
                }
            })
            .collect())
    }
    async fn publications(
        &self,
        _: &str,
        campaign: &str,
        after: u32,
    ) -> Result<PublicationPage, ReceiveError> {
        let hook = self.during_page.lock().unwrap().take();
        if let Some(hook) = hook {
            hook(self);
        }
        let saves = self.saves.lock().unwrap();
        let saves = &saves[campaign];
        Ok(PublicationPage {
            current: saves.last().map(|(save, _)| save.clone()),
            publications: saves
                .iter()
                .filter(|(save, _)| save.publication > after)
                .take(100)
                .map(|(save, _)| save.clone())
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
        let bytes = self.saves.lock().unwrap()[campaign]
            .iter()
            .find(|(candidate, _)| candidate.content_hash == save.content_hash)
            .unwrap()
            .1
            .clone();
        let hook = self.during_download.lock().unwrap().take();
        if let Some(hook) = hook {
            hook(self);
        }
        Ok(bytes)
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
    fn store(&self, value: &str) -> Result<(), ()> {
        *self.0.lock().unwrap() = Some(value.into());
        Ok(())
    }
    fn clear(&self) -> Result<(), ()> {
        *self.0.lock().unwrap() = None;
        Ok(())
    }
}
struct Fixture {
    temp: tempfile::TempDir,
    root: PathBuf,
    database: PathBuf,
    remote: Arc<Remote>,
    engine: Engine,
}
impl Fixture {
    async fn new(campaigns: &[&str]) -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        fs::create_dir(&root).unwrap();
        let database = temp.path().join("state/db");
        let remote = Arc::new(Remote::new());
        for campaign in campaigns {
            remote.publish(campaign, b"first");
        }
        let mut engine = Engine::open(
            &database,
            remote.clone(),
            Arc::new(Platform(root.clone())),
            Arc::new(Vault::default()),
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
        Self {
            temp,
            root,
            database,
            remote,
            engine,
        }
    }
    fn folder(&self, campaign: &str) -> PathBuf {
        fs::read_dir(&self.root)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .contains(campaign)
            })
            .unwrap()
    }
}
fn files(folder: &Path) -> BTreeMap<String, Vec<u8>> {
    fs::read_dir(folder)
        .unwrap()
        .map(|entry| {
            let entry = entry.unwrap();
            (
                entry.file_name().to_string_lossy().into_owned(),
                fs::read(entry.path()).unwrap(),
            )
        })
        .collect()
}
fn visible(folder: &Path) -> Vec<Vec<u8>> {
    let mut contents: Vec<_> = files(folder)
        .into_iter()
        .filter(|(name, _)| !name.starts_with('.'))
        .map(|(_, bytes)| bytes)
        .collect();
    contents.sort();
    contents
}

#[tokio::test]
async fn account_switch_does_not_recreate_a_previously_bound_missing_campaign_folder() {
    let mut f = Fixture::new(&["campaign-1"]).await;
    let folder = f.folder("campaign-1");
    let moved = f.temp.path().join("outside");
    fs::rename(&folder, &moved).unwrap();
    f.engine.command(Command::SignOut).await.unwrap();
    *f.remote.account.lock().unwrap() = "account-2".into();
    f.remote.publish("campaign-1", b"second");
    f.engine
        .command(Command::SubmitHandoffToken {
            token: "other-account".into(),
        })
        .await
        .unwrap();
    f.engine.command(Command::ContinueOnboarding).await.unwrap();
    let snapshot = f.engine.reconcile().await.unwrap();
    assert_eq!(
        snapshot.campaigns[0].status_label,
        "Receive needs attention"
    );
    assert_eq!(fs::read_dir(&f.root).unwrap().count(), 0);
    assert_eq!(visible(&moved), vec![b"first".to_vec()]);
    let restored = f.root.join("restored");
    fs::rename(moved, &restored).unwrap();
    assert_eq!(
        f.engine.reconcile().await.unwrap().campaigns[0].status_label,
        "Synchronized"
    );
    assert_eq!(
        visible(&restored),
        vec![b"first".to_vec(), b"second".to_vec()]
    );
}

#[tokio::test]
async fn campaign_pause_preserves_staging_and_catches_every_publication_after_resume() {
    let mut f = Fixture::new(&["campaign-1", "campaign-2"]).await;
    let first = f.folder("campaign-1");
    let second = f.folder("campaign-2");
    let failure = rusqlite::Connection::open(&f.database).unwrap();
    failure.execute_batch("CREATE TRIGGER fail_cursor BEFORE UPDATE OF cursor ON receive_campaigns WHEN NEW.campaign='campaign-1' BEGIN SELECT RAISE(ABORT,'synthetic disk failure'); END;").unwrap();
    f.remote.publish("campaign-1", b"second");
    f.engine.reconcile().await.unwrap();
    failure.execute_batch("DROP TRIGGER fail_cursor;").unwrap();
    f.engine
        .command(Command::SetCampaignPaused {
            campaign_id: "campaign-1".into(),
            paused: true,
        })
        .await
        .unwrap();
    let before = files(&first);
    assert!(before
        .keys()
        .any(|name| name.starts_with(".shadow-cloud-receive-")));
    let observations = f.remote.observations.load(Ordering::SeqCst);
    f.remote.publish("campaign-1", b"third");
    f.remote.publish("campaign-1", b"fourth");
    f.remote.publish("campaign-2", b"other campaign second");
    f.engine.reconcile().await.unwrap();
    assert!(f.remote.observations.load(Ordering::SeqCst) > observations);
    assert_eq!(files(&first), before);
    assert_eq!(
        visible(&second),
        vec![b"first".to_vec(), b"other campaign second".to_vec()]
    );
    f.engine
        .command(Command::SetCampaignPaused {
            campaign_id: "campaign-1".into(),
            paused: false,
        })
        .await
        .unwrap();
    f.engine.reconcile().await.unwrap();
    assert_eq!(
        visible(&first),
        vec![
            b"first".to_vec(),
            b"fourth".to_vec(),
            b"second".to_vec(),
            b"third".to_vec()
        ]
    );
    assert!(!files(&first)
        .keys()
        .any(|name| name.starts_with(".shadow-cloud-receive-")));
}

#[tokio::test]
async fn a_publication_change_after_observation_detects_new_local_work_before_receiving() {
    let mut f = Fixture::new(&["campaign-1"]).await;
    let folder = f.folder("campaign-1");
    let local = folder.join("my-turn.se1");
    *f.remote.during_page.lock().unwrap() = Some(Box::new(move |remote| {
        fs::write(local, b"local work").unwrap();
        remote.publish("campaign-1", b"second");
    }));
    let downloads = f.remote.downloads.load(Ordering::SeqCst);
    let snapshot = f.engine.reconcile().await.unwrap();
    assert_eq!(snapshot.campaigns[0].status_label, "Save conflict");
    assert_eq!(f.remote.downloads.load(Ordering::SeqCst), downloads);
    assert_eq!(
        visible(&folder),
        vec![b"first".to_vec(), b"local work".to_vec()]
    );
}

#[tokio::test]
async fn a_same_publication_replacement_during_download_blocks_staging_and_preserves_local_work() {
    let mut f = Fixture::new(&["campaign-1"]).await;
    let folder = f.folder("campaign-1");
    fs::remove_file(folder.join("turn.se1")).unwrap();
    f.engine.reconcile().await.unwrap();
    let local = folder.join("my-turn.se1");
    *f.remote.during_download.lock().unwrap() = Some(Box::new(move |remote| {
        fs::write(local, b"local work").unwrap();
        remote.replace("campaign-1", b"replacement");
    }));
    assert!(f
        .engine
        .command(Command::CampaignAction {
            campaign_id: "campaign-1".into(),
            action: CampaignAction::RedownloadCurrent
        })
        .await
        .is_err());
    assert_eq!(
        f.engine.snapshot().campaigns[0].status_label,
        "Save conflict"
    );
    assert_eq!(visible(&folder), vec![b"local work".to_vec()]);
    assert!(!files(&folder)
        .keys()
        .any(|name| name.starts_with(".shadow-cloud-receive-")));
}

#[tokio::test]
async fn redownload_checks_fresh_cloud_identity_before_using_a_cached_action() {
    let mut f = Fixture::new(&["campaign-1"]).await;
    let folder = f.folder("campaign-1");
    fs::remove_file(folder.join("turn.se1")).unwrap();
    fs::write(folder.join("my-turn.se1"), b"local work").unwrap();
    let snapshot = f.engine.reconcile().await.unwrap();
    assert!(snapshot.campaigns[0]
        .actions
        .contains(&CampaignAction::RedownloadCurrent));
    let before = files(&folder);
    let downloads = f.remote.downloads.load(Ordering::SeqCst);
    f.remote.replace("campaign-1", b"replacement");
    assert!(f
        .engine
        .command(Command::CampaignAction {
            campaign_id: "campaign-1".into(),
            action: CampaignAction::RedownloadCurrent
        })
        .await
        .is_err());
    assert_eq!(
        f.engine.snapshot().campaigns[0].status_label,
        "Save conflict"
    );
    assert_eq!(f.remote.downloads.load(Ordering::SeqCst), downloads);
    assert_eq!(files(&folder), before);
}
