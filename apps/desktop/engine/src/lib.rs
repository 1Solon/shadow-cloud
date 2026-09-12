//! The Companion's webview-independent snapshot/command boundary.
use async_trait::async_trait;
use rusqlite::{Connection as SqliteConnection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};

mod receive;
pub use receive::{ObservedCampaign, PublicationPage, ReceiveError, SavePublication};

pub const RELEASE: &str = env!("COMPANION_RELEASE");
const CAMPAIGN_MARKER: &str = ".shadow-cloud-campaign.json";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CampaignIdentity {
    pub id: String,
    pub number: u32,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CampaignFolder {
    pub path: PathBuf,
    pub recovered: bool,
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum CampaignFolderError {
    #[error("the Companion root is not a real directory")]
    InvalidRoot,
    #[error("the Campaign identity is invalid")]
    InvalidCampaignIdentity,
    #[error("the Campaign name is unsafe on a supported platform")]
    UnsafeCampaignName,
    #[error("the Campaign folder name is already owned by something else")]
    NameConflict,
    #[error("more than one folder claims this Campaign")]
    DuplicateMarkers,
    #[error("the Campaign folder escaped the Companion root")]
    PathEscape,
    #[error("the Campaign folder could not be read or written")]
    FileSystem,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CampaignMarker {
    schema: u8,
    service: String,
    campaign_id: String,
}

/// Create or rediscover the one marker-owned flat folder for a Campaign.
pub fn ensure_campaign_folder(
    root: &Path,
    identity: &CampaignIdentity,
) -> Result<CampaignFolder, CampaignFolderError> {
    validate_campaign_id(&identity.id)?;
    let metadata = fs::symlink_metadata(root).map_err(|_| CampaignFolderError::InvalidRoot)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(CampaignFolderError::InvalidRoot);
    }
    let canonical_root = fs::canonicalize(root).map_err(|_| CampaignFolderError::InvalidRoot)?;

    let mut recovered = Vec::new();
    for entry in fs::read_dir(&canonical_root).map_err(|_| CampaignFolderError::FileSystem)? {
        let entry = entry.map_err(|_| CampaignFolderError::FileSystem)?;
        let metadata =
            fs::symlink_metadata(entry.path()).map_err(|_| CampaignFolderError::FileSystem)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            continue;
        }
        if marker_matches(&entry.path(), &identity.id)? {
            recovered.push(checked_child(&canonical_root, &entry.path())?);
        }
    }
    match recovered.as_slice() {
        [path] => {
            return Ok(CampaignFolder {
                path: path.clone(),
                recovered: true,
            })
        }
        [_, _, ..] => return Err(CampaignFolderError::DuplicateMarkers),
        [] => {}
    }

    validate_new_folder_name(identity)?;
    let target = canonical_root.join(folder_name(identity));
    match fs::symlink_metadata(&target) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(CampaignFolderError::PathEscape)
        }
        Ok(_) => return Err(CampaignFolderError::NameConflict),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(CampaignFolderError::FileSystem),
    }

    fs::create_dir(&target).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            CampaignFolderError::NameConflict
        } else {
            CampaignFolderError::FileSystem
        }
    })?;
    if let Err(error) = write_marker(&target, &identity.id) {
        let _ = fs::remove_dir(&target);
        return Err(error);
    }
    let path = checked_child(&canonical_root, &target)?;
    Ok(CampaignFolder {
        path,
        recovered: false,
    })
}

fn validate_campaign_id(campaign_id: &str) -> Result<(), CampaignFolderError> {
    if campaign_id.is_empty()
        || campaign_id.len() > 128
        || !campaign_id
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || value == b'-' || value == b'_')
    {
        return Err(CampaignFolderError::InvalidCampaignIdentity);
    }
    Ok(())
}

fn validate_new_folder_name(identity: &CampaignIdentity) -> Result<(), CampaignFolderError> {
    let name = identity.name.trim();
    let upper = name.to_ascii_uppercase();
    let device_stem = upper.split('.').next().unwrap_or_default();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if name.is_empty()
        || name.chars().count() > 80
        || name != identity.name
        || name.ends_with(['.', ' '])
        || name.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
        })
        || reserved.contains(&device_stem)
    {
        return Err(CampaignFolderError::UnsafeCampaignName);
    }
    Ok(())
}

fn folder_name(identity: &CampaignIdentity) -> String {
    let digest = Sha256::digest(identity.id.as_bytes());
    let suffix = digest[..5]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("{} - {} [{}]", identity.number, identity.name, suffix)
}

fn marker_matches(path: &Path, campaign_id: &str) -> Result<bool, CampaignFolderError> {
    let marker_path = path.join(CAMPAIGN_MARKER);
    let metadata = match fs::symlink_metadata(&marker_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err(CampaignFolderError::FileSystem),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 4096 {
        return Ok(false);
    }
    let marker: CampaignMarker = match fs::read_to_string(marker_path)
        .ok()
        .and_then(|value| serde_json::from_str(&value).ok())
    {
        Some(marker) => marker,
        None => return Ok(false),
    };
    Ok(marker.schema == 1 && marker.service == "shadow-cloud" && marker.campaign_id == campaign_id)
}

fn checked_child(root: &Path, child: &Path) -> Result<PathBuf, CampaignFolderError> {
    let canonical = fs::canonicalize(child).map_err(|_| CampaignFolderError::FileSystem)?;
    if canonical.parent() != Some(root) {
        return Err(CampaignFolderError::PathEscape);
    }
    Ok(canonical)
}

fn write_marker(path: &Path, campaign_id: &str) -> Result<(), CampaignFolderError> {
    let marker = CampaignMarker {
        schema: 1,
        service: "shadow-cloud".into(),
        campaign_id: campaign_id.into(),
    };
    let contents =
        serde_json::to_vec_pretty(&marker).map_err(|_| CampaignFolderError::FileSystem)?;
    write_new_file_atomically(&path.join(CAMPAIGN_MARKER), |file| {
        file.write_all(&contents)
    })
    .map_err(|_| CampaignFolderError::FileSystem)
}

fn write_new_file_atomically(
    target: &Path,
    write_contents: impl FnOnce(&mut fs::File) -> std::io::Result<()>,
) -> std::io::Result<()> {
    let file_name = target
        .file_name()
        .ok_or_else(|| std::io::Error::from(std::io::ErrorKind::InvalidInput))?;
    let mut incomplete_name = file_name.to_os_string();
    incomplete_name.push(".incomplete");
    let incomplete = target.with_file_name(incomplete_name);
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&incomplete)?;
    let result = (|| {
        write_contents(&mut file)?;
        file.sync_all()?;
        drop(file);
        match fs::symlink_metadata(target) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Ok(_) => return Err(std::io::Error::from(std::io::ErrorKind::AlreadyExists)),
            Err(error) => return Err(error),
        }
        fs::rename(&incomplete, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&incomplete);
    }
    result
}

#[cfg(test)]
mod marker_tests {
    use super::*;
    use std::io::{self, Write};

    #[test]
    fn a_failed_marker_write_never_publishes_partial_ownership() {
        let directory = tempfile::tempdir().unwrap();
        let marker = directory.path().join(CAMPAIGN_MARKER);

        let result = write_new_file_atomically(&marker, |file| {
            file.write_all(b"{\"schema\":")?;
            Err(io::Error::other("injected write interruption"))
        });

        assert!(result.is_err());
        assert!(!marker.exists());
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 0);
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Theme {
    Dark,
    Light,
    System,
}

impl Theme {
    fn storage_value(&self) -> &'static str {
        match self {
            Self::Dark => "dark",
            Self::Light => "light",
            Self::System => "system",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConnectionState {
    Checking,
    Connected,
    Offline,
    UpdateRequired,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub state: ConnectionState,
    pub reachable: bool,
    pub server_protocol_version: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub theme: Theme,
    pub automatic_uploads: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SyncStatus {
    Conflict,
    Sending,
    Synchronized,
    Archived,
    Receiving,
    NeedsAttention,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Campaign {
    pub id: String,
    pub number: u32,
    pub name: String,
    pub round: u32,
    pub active_lord: String,
    pub sync_status: SyncStatus,
    pub status_label: String,
    pub detail: String,
    pub automatic_uploads: bool,
    pub turn_started_at: Option<String>,
    pub last_transfer: String,
    pub archive_bytes: u64,
    pub actions: Vec<CampaignAction>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CampaignAction {
    ResolveConflict,
    CancelAutomaticSend,
    OpenFolder,
    RedownloadCurrent,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: String,
    pub campaign_name: String,
    pub description: String,
    pub occurred_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SessionState {
    SignedOut,
    WaitingForBrowser,
    SignedIn,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CredentialStorage {
    Vault,
    MemoryOnly,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub state: SessionState,
    pub authorization_url: Option<String>,
    pub handoff_expires_at: Option<String>,
    pub credential_storage: Option<CredentialStorage>,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OnboardingStage {
    Welcome,
    SignIn,
    CompanionRoot,
    AutomaticUploads,
    Review,
    Complete,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingSnapshot {
    pub stage: OnboardingStage,
    pub available_steps: Vec<OnboardingStage>,
    pub can_send: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u32,
    pub app_version: String,
    pub protocol_version: String,
    pub connection: Connection,
    pub session: SessionSnapshot,
    pub onboarding: OnboardingSnapshot,
    pub read_only: bool,
    pub paused: bool,
    pub display_name: Option<String>,
    pub root_path: Option<String>,
    pub preferences: Preferences,
    pub campaigns: Vec<Campaign>,
    pub activity: Vec<Activity>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Command {
    ContinueOnboarding,
    NavigateOnboarding {
        stage: OnboardingStage,
    },
    StartBrowserSignIn,
    SubmitHandoffToken {
        token: String,
    },
    ChooseCompanionRoot,
    CompleteOnboarding,
    SignOut,
    ResetCompanion,
    SetTheme {
        theme: Theme,
    },
    SetAutomaticUploads {
        enabled: bool,
    },
    SetPaused {
        paused: bool,
    },
    CampaignAction {
        campaign_id: String,
        action: CampaignAction,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, thiserror::Error)]
#[serde(rename_all = "kebab-case")]
pub enum CommandError {
    #[error("update-required")]
    UpdateRequired,
    #[error("not-available")]
    NotAvailable,
    #[error("onboarding-incomplete")]
    OnboardingIncomplete,
    #[error("invalid-onboarding-step")]
    InvalidOnboardingStep,
    #[error("authentication-unavailable")]
    AuthenticationUnavailable,
    #[error("authorization-expired")]
    AuthorizationExpired,
    #[error("folder-selection-cancelled")]
    FolderSelectionCancelled,
    #[error("invalid-companion-root")]
    InvalidCompanionRoot,
    #[error("storage-unavailable")]
    StorageUnavailable,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Handoff {
    pub id: String,
    pub poll_secret: String,
    pub authorization_url: String,
    pub expires_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceUser {
    pub id: String,
    pub email: String,
    pub display_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSessionProfile {
    pub id: String,
    pub expires_at: String,
    pub scopes: Vec<String>,
    pub user: DeviceUser,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCredentials {
    pub access_token: String,
    pub access_token_expires_at: String,
    pub refresh_token: String,
    pub device_session: DeviceSessionProfile,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExchangeOutcome {
    Pending,
    Approved(DeviceCredentials),
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum RemoteError {
    #[error("offline")]
    Offline,
    #[error("rejected")]
    Rejected,
}

#[async_trait]
pub trait CompanionRemote: Send + Sync {
    fn receive_interrupted(&self) -> bool {
        false
    }
    async fn observe(&self, _access: &str) -> Result<Vec<ObservedCampaign>, ReceiveError> {
        Err(ReceiveError::Offline)
    }
    async fn publications(
        &self,
        _access: &str,
        _campaign: &str,
        _after: u32,
    ) -> Result<PublicationPage, ReceiveError> {
        Err(ReceiveError::Offline)
    }
    async fn download(
        &self,
        _access: &str,
        _campaign: &str,
        _save: &SavePublication,
    ) -> Result<Vec<u8>, ReceiveError> {
        Err(ReceiveError::Offline)
    }
    async fn create_handoff(&self) -> Result<Handoff, RemoteError>;
    async fn exchange_browser(
        &self,
        handoff_id: &str,
        poll_secret: &str,
    ) -> Result<ExchangeOutcome, RemoteError>;
    async fn exchange_token(&self, token: &str) -> Result<DeviceCredentials, RemoteError>;
    async fn refresh(&self, refresh_token: &str) -> Result<DeviceCredentials, RemoteError>;
    async fn revoke(&self, refresh_token: &str) -> Result<(), RemoteError>;
}

pub trait CompanionPlatform: Send + Sync {
    fn open_folder(&self, _path: &Path) -> Result<(), ()> {
        Err(())
    }
    fn open_url(&self, url: &str) -> Result<(), ()>;
    fn choose_directory(&self) -> Result<Option<PathBuf>, ()>;
}

pub trait SecretVault: Send + Sync {
    fn load(&self) -> Result<Option<String>, ()>;
    fn store(&self, secret: &str) -> Result<(), ()>;
    fn clear(&self) -> Result<(), ()>;
}

#[derive(Debug, thiserror::Error)]
#[error("the Companion database could not be opened")]
pub struct EngineOpenError;

struct PendingHandoff {
    id: String,
    poll_secret: String,
}

struct SessionSecrets {
    access_token: String,
    account_id: String,
    refresh_token: String,
}

struct Store {
    connection: SqliteConnection,
}

impl Store {
    fn memory() -> Result<Self, EngineOpenError> {
        let connection = SqliteConnection::open_in_memory().map_err(|_| EngineOpenError)?;
        let store = Self { connection };
        store.migrate()?;
        Ok(store)
    }

    fn open(path: &Path) -> Result<Self, EngineOpenError> {
        let parent = path.parent().ok_or(EngineOpenError)?;
        fs::create_dir_all(parent).map_err(|_| EngineOpenError)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
                .map_err(|_| EngineOpenError)?;
        }
        if let Ok(metadata) = fs::symlink_metadata(path) {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(EngineOpenError);
            }
        }
        let mut options = OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        drop(options.open(path).map_err(|_| EngineOpenError)?);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o600))
                .map_err(|_| EngineOpenError)?;
        }
        let connection = SqliteConnection::open(path).map_err(|_| EngineOpenError)?;
        let store = Self { connection };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<(), EngineOpenError> {
        self.connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE IF NOT EXISTS settings (
                   key TEXT PRIMARY KEY NOT NULL,
                   value TEXT NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS receive_campaigns (
                   account TEXT NOT NULL, campaign TEXT NOT NULL, cursor INTEGER NOT NULL,
                   folder TEXT, PRIMARY KEY(account, campaign)
                 );
                 CREATE TABLE IF NOT EXISTS receive_cleanup (account TEXT NOT NULL, campaign TEXT NOT NULL, path TEXT PRIMARY KEY NOT NULL);
                 CREATE TABLE IF NOT EXISTS received_publications (
                   account TEXT NOT NULL, campaign TEXT NOT NULL, publication INTEGER NOT NULL,
                   revision INTEGER NOT NULL, hash TEXT NOT NULL, size INTEGER NOT NULL,
                   path TEXT NOT NULL, stage TEXT, state TEXT NOT NULL,
                   PRIMARY KEY(account, campaign, publication, revision)
                 );
                 CREATE INDEX IF NOT EXISTS received_hash ON received_publications(account, campaign, hash);
                 CREATE TABLE IF NOT EXISTS campaign_folders (
                   campaign_id TEXT PRIMARY KEY NOT NULL,
                   path TEXT NOT NULL UNIQUE
                 );",
            )
            .map_err(|_| EngineOpenError)
    }

    fn get(&self, key: &str) -> Result<Option<String>, CommandError> {
        self.connection
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|_| CommandError::StorageUnavailable)
    }

    fn set(&self, key: &str, value: &str) -> Result<(), CommandError> {
        self.connection
            .execute(
                "INSERT INTO settings(key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [key, value],
            )
            .map(|_| ())
            .map_err(|_| CommandError::StorageUnavailable)
    }

    fn reset_setup(&mut self) -> Result<(), CommandError> {
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| CommandError::StorageUnavailable)?;
        // Forget setup, not folder ownership or save/operation provenance.
        // The signed-out tombstone must commit with the reset: an unavailable
        // vault must never silently restore the previous account on restart.
        transaction
            .execute_batch(
                "DELETE FROM settings WHERE key IN (
                   'theme', 'automatic_uploads', 'paused',
                   'onboarding_complete', 'companion_root'
                 );
                 INSERT INTO settings(key, value) VALUES ('session_restore_enabled', 'false')
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
            )
            .map_err(|_| CommandError::StorageUnavailable)?;
        transaction
            .commit()
            .map_err(|_| CommandError::StorageUnavailable)
    }

    fn remember_campaign_folder(&self, campaign_id: &str, path: &Path) -> Result<(), CommandError> {
        let value = path.to_str().ok_or(CommandError::StorageUnavailable)?;
        self.connection
            .execute(
                "INSERT INTO campaign_folders(campaign_id, path) VALUES (?1, ?2)
                 ON CONFLICT(campaign_id) DO UPDATE SET path = excluded.path",
                [campaign_id, value],
            )
            .map(|_| ())
            .map_err(|_| CommandError::StorageUnavailable)
    }
}

struct UnavailableRemote;

#[async_trait]
impl CompanionRemote for UnavailableRemote {
    async fn create_handoff(&self) -> Result<Handoff, RemoteError> {
        Err(RemoteError::Offline)
    }
    async fn exchange_browser(&self, _: &str, _: &str) -> Result<ExchangeOutcome, RemoteError> {
        Err(RemoteError::Offline)
    }
    async fn exchange_token(&self, _: &str) -> Result<DeviceCredentials, RemoteError> {
        Err(RemoteError::Offline)
    }
    async fn refresh(&self, _: &str) -> Result<DeviceCredentials, RemoteError> {
        Err(RemoteError::Offline)
    }
    async fn revoke(&self, _: &str) -> Result<(), RemoteError> {
        Err(RemoteError::Offline)
    }
}

struct UnavailablePlatform;
impl CompanionPlatform for UnavailablePlatform {
    fn open_url(&self, _: &str) -> Result<(), ()> {
        Err(())
    }
    fn choose_directory(&self) -> Result<Option<PathBuf>, ()> {
        Ok(None)
    }
}

struct UnavailableVault;
impl SecretVault for UnavailableVault {
    fn load(&self) -> Result<Option<String>, ()> {
        Err(())
    }
    fn store(&self, _: &str) -> Result<(), ()> {
        Err(())
    }
    fn clear(&self) -> Result<(), ()> {
        Err(())
    }
}

/// One coordinator owns this value. No decision is made by the webview.
pub struct Engine {
    snapshot: Snapshot,
    revisions: tokio::sync::watch::Sender<Snapshot>,
    store: Store,
    remote: Arc<dyn CompanionRemote>,
    platform: Arc<dyn CompanionPlatform>,
    vault: Arc<dyn SecretVault>,
    pending_handoff: Option<PendingHandoff>,
    secrets: Option<SessionSecrets>,
    onboarding_complete: bool,
    furthest_onboarding_stage: OnboardingStage,
    session_restore_enabled: bool,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine {
    pub fn new() -> Self {
        Self::from_store(
            Store::memory().expect("in-memory Companion database failed"),
            Arc::new(UnavailableRemote),
            Arc::new(UnavailablePlatform),
            Arc::new(UnavailableVault),
        )
        .expect("in-memory Companion state failed")
    }

    pub fn open(
        database_path: &Path,
        remote: Arc<dyn CompanionRemote>,
        platform: Arc<dyn CompanionPlatform>,
        vault: Arc<dyn SecretVault>,
    ) -> Result<Self, EngineOpenError> {
        Self::from_store(Store::open(database_path)?, remote, platform, vault)
    }

    fn from_store(
        store: Store,
        remote: Arc<dyn CompanionRemote>,
        platform: Arc<dyn CompanionPlatform>,
        vault: Arc<dyn SecretVault>,
    ) -> Result<Self, EngineOpenError> {
        let theme = match store.get("theme").map_err(|_| EngineOpenError)?.as_deref() {
            Some("dark") => Theme::Dark,
            Some("light") => Theme::Light,
            _ => Theme::System,
        };
        let automatic_uploads = store
            .get("automatic_uploads")
            .map_err(|_| EngineOpenError)?
            .as_deref()
            != Some("false");
        let paused = store.get("paused").map_err(|_| EngineOpenError)?.as_deref() == Some("true");
        let onboarding_complete = store
            .get("onboarding_complete")
            .map_err(|_| EngineOpenError)?
            .as_deref()
            == Some("true");
        let session_restore_enabled = store
            .get("session_restore_enabled")
            .map_err(|_| EngineOpenError)?
            .as_deref()
            != Some("false");
        let root_path = store
            .get("companion_root")
            .map_err(|_| EngineOpenError)?
            .filter(|path| validate_root(Path::new(path)).is_ok());
        let onboarding_stage = if onboarding_complete {
            OnboardingStage::SignIn
        } else {
            OnboardingStage::Welcome
        };
        let snapshot = Snapshot {
            revision: 0,
            app_version: RELEASE.into(),
            protocol_version: RELEASE.into(),
            connection: Connection {
                state: ConnectionState::Checking,
                reachable: false,
                server_protocol_version: None,
            },
            session: SessionSnapshot {
                state: SessionState::SignedOut,
                authorization_url: None,
                handoff_expires_at: None,
                credential_storage: None,
            },
            onboarding: OnboardingSnapshot {
                stage: onboarding_stage.clone(),
                available_steps: if onboarding_complete {
                    vec![OnboardingStage::Welcome, OnboardingStage::SignIn]
                } else {
                    vec![OnboardingStage::Welcome]
                },
                can_send: false,
            },
            read_only: true,
            paused,
            display_name: None,
            root_path,
            preferences: Preferences {
                theme,
                automatic_uploads,
            },
            campaigns: vec![],
            activity: vec![],
        };
        let (revisions, _) = tokio::sync::watch::channel(snapshot.clone());
        Ok(Self {
            snapshot,
            revisions,
            store,
            remote,
            platform,
            vault,
            pending_handoff: None,
            secrets: None,
            onboarding_complete,
            furthest_onboarding_stage: onboarding_stage,
            session_restore_enabled,
        })
    }

    pub fn snapshot(&self) -> Snapshot {
        self.snapshot.clone()
    }

    pub fn subscribe(&self) -> tokio::sync::watch::Receiver<Snapshot> {
        self.revisions.subscribe()
    }

    pub async fn command(&mut self, command: Command) -> Result<Snapshot, CommandError> {
        let previous = self.snapshot.clone();
        match command {
            Command::ContinueOnboarding => match self.snapshot.onboarding.stage {
                OnboardingStage::Welcome => {
                    self.snapshot.onboarding.stage = OnboardingStage::SignIn
                }
                OnboardingStage::SignIn
                    if self.snapshot.session.state == SessionState::SignedIn =>
                {
                    self.snapshot.onboarding.stage =
                        if self.onboarding_complete && self.snapshot.root_path.is_some() {
                            OnboardingStage::Complete
                        } else {
                            OnboardingStage::CompanionRoot
                        }
                }
                OnboardingStage::CompanionRoot
                    if self.snapshot.session.state == SessionState::SignedIn
                        && self.snapshot.root_path.is_some() =>
                {
                    self.snapshot.onboarding.stage = OnboardingStage::AutomaticUploads
                }
                OnboardingStage::AutomaticUploads
                    if self.snapshot.session.state == SessionState::SignedIn
                        && self.snapshot.root_path.is_some() =>
                {
                    self.snapshot.onboarding.stage = OnboardingStage::Review
                }
                _ => return Err(CommandError::InvalidOnboardingStep),
            },
            Command::NavigateOnboarding { stage } => {
                if !self.snapshot.onboarding.available_steps.contains(&stage) {
                    return Err(CommandError::InvalidOnboardingStep);
                }
                self.snapshot.onboarding.stage = stage;
            }
            Command::StartBrowserSignIn => self.start_browser_sign_in().await?,
            Command::SubmitHandoffToken { token } => {
                if self.snapshot.onboarding.stage != OnboardingStage::SignIn
                    || self.snapshot.session.state == SessionState::SignedIn
                {
                    return Err(CommandError::InvalidOnboardingStep);
                }
                self.require_compatible_server()?;
                let credentials = self
                    .remote
                    .exchange_token(token.trim())
                    .await
                    .map_err(map_remote_error)?;
                self.accept_credentials(credentials)?;
            }
            Command::ChooseCompanionRoot => {
                if self.snapshot.session.state != SessionState::SignedIn {
                    return Err(CommandError::InvalidOnboardingStep);
                }
                let selected = self
                    .platform
                    .choose_directory()
                    .map_err(|_| CommandError::InvalidCompanionRoot)?
                    .ok_or(CommandError::FolderSelectionCancelled)?;
                let canonical = validate_root(&selected)?;
                let value = canonical
                    .to_str()
                    .ok_or(CommandError::InvalidCompanionRoot)?
                    .to_owned();
                self.store.set("companion_root", &value)?;
                self.snapshot.root_path = Some(value);
                self.snapshot.onboarding.stage = if self.onboarding_complete {
                    OnboardingStage::Complete
                } else {
                    OnboardingStage::CompanionRoot
                };
            }
            Command::CompleteOnboarding => {
                if self.snapshot.onboarding.stage != OnboardingStage::Review
                    || self.snapshot.session.state != SessionState::SignedIn
                    || self.snapshot.root_path.is_none()
                {
                    return Err(CommandError::InvalidOnboardingStep);
                }
                self.store.set("onboarding_complete", "true")?;
                self.onboarding_complete = true;
                self.snapshot.onboarding.stage = OnboardingStage::Complete;
            }
            Command::SignOut => {
                if let Err(error) = self.sign_out().await {
                    // Credential teardown is more important than reporting a
                    // successful settings write. Publish the signed-out state
                    // even when the durable tombstone could not be recorded.
                    self.finish_change(&previous);
                    return Err(error);
                }
            }
            Command::ResetCompanion => {
                // A failed transaction leaves the current setup and session
                // intact. Once committed, remote/vault failures cannot undo it.
                self.store.reset_setup()?;
                self.session_restore_enabled = false;
                self.clear_device_session().await;
                self.onboarding_complete = false;
                self.furthest_onboarding_stage = OnboardingStage::Welcome;
                self.snapshot.onboarding.stage = OnboardingStage::Welcome;
                self.snapshot.root_path = None;
                self.snapshot.preferences.theme = Theme::System;
                self.snapshot.preferences.automatic_uploads = true;
                self.snapshot.paused = false;
                self.snapshot.campaigns.clear();
                self.snapshot.activity.clear();
            }
            Command::SetTheme { theme } => {
                self.store.set("theme", theme.storage_value())?;
                self.snapshot.preferences.theme = theme;
            }
            Command::SetAutomaticUploads { enabled } => {
                if enabled && self.snapshot.connection.state == ConnectionState::UpdateRequired {
                    return Err(CommandError::UpdateRequired);
                }
                self.store
                    .set("automatic_uploads", if enabled { "true" } else { "false" })?;
                self.snapshot.preferences.automatic_uploads = enabled;
            }
            Command::SetPaused { paused } => {
                if !paused && self.snapshot.connection.state == ConnectionState::UpdateRequired {
                    return Err(CommandError::UpdateRequired);
                }
                self.store
                    .set("paused", if paused { "true" } else { "false" })?;
                self.snapshot.paused = paused;
            }
            Command::CampaignAction {
                campaign_id,
                action,
            } => {
                if !self.onboarding_complete
                    || self.snapshot.session.state != SessionState::SignedIn
                {
                    return Err(CommandError::OnboardingIncomplete);
                }
                self.require_compatible_server()?;
                self.receive_action(&campaign_id, action).await?;
            }
        }
        self.finish_change(&previous);
        Ok(self.snapshot())
    }

    pub async fn poll_browser_sign_in(&mut self) -> Result<Snapshot, CommandError> {
        let Some(pending) = self.pending_handoff.as_ref() else {
            return Ok(self.snapshot());
        };
        let previous = self.snapshot.clone();
        match self
            .remote
            .exchange_browser(&pending.id, &pending.poll_secret)
            .await
        {
            Ok(ExchangeOutcome::Pending) | Err(RemoteError::Offline) => {}
            Ok(ExchangeOutcome::Approved(credentials)) => self.accept_credentials(credentials)?,
            Err(RemoteError::Rejected) => {
                self.pending_handoff = None;
                self.snapshot.session = signed_out_session();
                self.finish_change(&previous);
                return Err(CommandError::AuthorizationExpired);
            }
        }
        self.finish_change(&previous);
        Ok(self.snapshot())
    }

    pub async fn restore_session(&mut self) -> Result<Snapshot, CommandError> {
        if self.snapshot.session.state == SessionState::SignedIn {
            return Ok(self.snapshot());
        }
        if !self.session_restore_enabled {
            // A failed credential-vault deletion must never undo an explicit
            // sign-out. Periodic startup recovery doubles as a safe cleanup
            // retry without presenting the retained secret to the server.
            let _ = self.vault.clear();
            return Ok(self.snapshot());
        }
        let previous = self.snapshot.clone();
        let Ok(Some(refresh_token)) = self.vault.load() else {
            return Ok(self.snapshot());
        };
        match self.remote.refresh(&refresh_token).await {
            Ok(credentials) => {
                self.accept_credentials(credentials)?;
                // A saved, completed setup resumes normally on startup. An
                // interactive sign-in never navigates away from Connect.
                if self.onboarding_complete && self.snapshot.root_path.is_some() {
                    self.snapshot.onboarding.stage = OnboardingStage::Complete;
                }
            }
            Err(RemoteError::Offline) => return Ok(self.snapshot()),
            Err(RemoteError::Rejected) => {
                let _ = self.vault.clear();
                self.secrets = None;
                self.snapshot.session = signed_out_session();
                self.snapshot.display_name = None;
            }
        }
        self.finish_change(&previous);
        Ok(self.snapshot())
    }

    pub fn ensure_campaign_folder(
        &mut self,
        identity: &CampaignIdentity,
    ) -> Result<CampaignFolder, CommandError> {
        let root = self
            .snapshot
            .root_path
            .as_ref()
            .ok_or(CommandError::InvalidCompanionRoot)?;
        let folder = ensure_campaign_folder(Path::new(root), identity)
            .map_err(|_| CommandError::InvalidCompanionRoot)?;
        self.store
            .remember_campaign_folder(&identity.id, &folder.path)?;
        Ok(folder)
    }

    /// A transport failure never proves a previously incompatible server is safe.
    pub fn observe_protocol(&mut self, result: Result<String, ()>) {
        let previous = self.snapshot.clone();
        match result {
            Ok(version) => {
                self.snapshot.connection.reachable = true;
                self.snapshot.connection.state = if version == RELEASE {
                    ConnectionState::Connected
                } else {
                    ConnectionState::UpdateRequired
                };
                self.snapshot.connection.server_protocol_version = Some(version);
            }
            Err(()) => {
                self.snapshot.connection.reachable = false;
                if self.snapshot.connection.state != ConnectionState::UpdateRequired {
                    self.snapshot.connection.state = ConnectionState::Offline;
                }
            }
        }
        self.finish_change(&previous);
    }

    async fn start_browser_sign_in(&mut self) -> Result<(), CommandError> {
        self.require_compatible_server()?;
        if self.snapshot.onboarding.stage != OnboardingStage::SignIn
            || self.snapshot.session.state == SessionState::SignedIn
        {
            return Err(CommandError::InvalidOnboardingStep);
        }
        let handoff = self
            .remote
            .create_handoff()
            .await
            .map_err(map_remote_error)?;
        self.pending_handoff = Some(PendingHandoff {
            id: handoff.id,
            poll_secret: handoff.poll_secret,
        });
        self.snapshot.session = SessionSnapshot {
            state: SessionState::WaitingForBrowser,
            authorization_url: Some(handoff.authorization_url.clone()),
            handoff_expires_at: Some(handoff.expires_at),
            credential_storage: None,
        };
        let _ = self.platform.open_url(&handoff.authorization_url);
        Ok(())
    }

    fn accept_credentials(&mut self, credentials: DeviceCredentials) -> Result<(), CommandError> {
        const SCOPES: [&str; 3] = ["campaigns:observe", "saves:download", "turns:submit"];
        if credentials.device_session.scopes.len() != SCOPES.len()
            || !SCOPES.iter().all(|scope| {
                credentials
                    .device_session
                    .scopes
                    .iter()
                    .any(|value| value == scope)
            })
        {
            return Err(CommandError::AuthenticationUnavailable);
        }
        let storage = if self.vault.store(&credentials.refresh_token).is_ok() {
            self.store.set("session_restore_enabled", "true")?;
            self.session_restore_enabled = true;
            CredentialStorage::Vault
        } else {
            // A memory-only session must never cause an older, temporarily
            // inaccessible vault credential to be restored after restart.
            self.store.set("session_restore_enabled", "false")?;
            self.session_restore_enabled = false;
            CredentialStorage::MemoryOnly
        };
        self.secrets = Some(SessionSecrets {
            access_token: credentials.access_token,
            account_id: credentials.device_session.user.id.clone(),
            refresh_token: credentials.refresh_token,
        });
        self.pending_handoff = None;
        self.snapshot.display_name = Some(credentials.device_session.user.display_name);
        self.snapshot.session = SessionSnapshot {
            state: SessionState::SignedIn,
            authorization_url: None,
            handoff_expires_at: None,
            credential_storage: Some(storage),
        };
        Ok(())
    }

    async fn sign_out(&mut self) -> Result<(), CommandError> {
        // Persist user intent before any fallible remote or vault operation.
        // This is non-secret state and prevents an uncleared vault credential
        // from being restored after an offline sign-out or process restart.
        self.session_restore_enabled = false;
        let tombstone = self.store.set("session_restore_enabled", "false");
        self.clear_device_session().await;
        self.snapshot.onboarding.stage = OnboardingStage::SignIn;
        tombstone
    }

    async fn clear_device_session(&mut self) {
        let refresh_token = self
            .secrets
            .take()
            .map(|secrets| secrets.refresh_token)
            .or_else(|| self.vault.load().ok().flatten());
        if let Some(refresh_token) = refresh_token {
            let _ = self.remote.revoke(&refresh_token).await;
        }
        let _ = self.vault.clear();
        self.pending_handoff = None;
        self.snapshot.session = signed_out_session();
        self.snapshot.display_name = None;
        self.snapshot.campaigns.clear();
        self.snapshot.activity.clear();
    }

    fn require_compatible_server(&self) -> Result<(), CommandError> {
        match self.snapshot.connection.state {
            ConnectionState::Connected => Ok(()),
            ConnectionState::UpdateRequired => Err(CommandError::UpdateRequired),
            _ => Err(CommandError::AuthenticationUnavailable),
        }
    }

    fn finish_change(&mut self, previous: &Snapshot) {
        // Navigation must not forget reached steps or bypass their prerequisites.
        if self.snapshot.onboarding.stage > self.furthest_onboarding_stage {
            self.furthest_onboarding_stage = self.snapshot.onboarding.stage.clone();
        }
        self.snapshot.onboarding.available_steps =
            if self.snapshot.onboarding.stage == OnboardingStage::Complete {
                vec![]
            } else {
                [
                    OnboardingStage::Welcome,
                    OnboardingStage::SignIn,
                    OnboardingStage::CompanionRoot,
                    OnboardingStage::AutomaticUploads,
                    OnboardingStage::Review,
                ]
                .into_iter()
                .filter(|stage| {
                    stage <= &self.furthest_onboarding_stage
                        && match stage {
                            OnboardingStage::CompanionRoot => {
                                self.snapshot.session.state == SessionState::SignedIn
                            }
                            OnboardingStage::AutomaticUploads | OnboardingStage::Review => {
                                self.snapshot.session.state == SessionState::SignedIn
                                    && self.snapshot.root_path.is_some()
                            }
                            _ => true,
                        }
                })
                .collect()
            };
        self.snapshot.onboarding.can_send = self.onboarding_complete
            && self.snapshot.onboarding.stage == OnboardingStage::Complete
            && self.snapshot.session.state == SessionState::SignedIn
            && self.snapshot.root_path.is_some()
            && self.snapshot.connection.state == ConnectionState::Connected
            && !self.snapshot.paused;
        self.snapshot.read_only = !self.snapshot.onboarding.can_send;
        if &self.snapshot != previous {
            self.snapshot.revision = self
                .snapshot
                .revision
                .checked_add(1)
                .expect("revision exhausted");
            self.revisions.send_replace(self.snapshot.clone());
        }
    }
}

fn validate_root(path: &Path) -> Result<PathBuf, CommandError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| CommandError::InvalidCompanionRoot)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(CommandError::InvalidCompanionRoot);
    }
    fs::canonicalize(path).map_err(|_| CommandError::InvalidCompanionRoot)
}

fn signed_out_session() -> SessionSnapshot {
    SessionSnapshot {
        state: SessionState::SignedOut,
        authorization_url: None,
        handoff_expires_at: None,
        credential_storage: None,
    }
}

fn map_remote_error(error: RemoteError) -> CommandError {
    match error {
        RemoteError::Offline => CommandError::AuthenticationUnavailable,
        RemoteError::Rejected => CommandError::AuthorizationExpired,
    }
}
