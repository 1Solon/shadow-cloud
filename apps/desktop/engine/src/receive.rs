use super::*;
use rusqlite::params;
use std::io::Read;

// HTTP transport facts stay inside Rust. React receives only Campaign projections.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePublication {
    pub publication: u32,
    pub file_version_id: String,
    pub content_revision: u32,
    pub content_hash: String,
    pub size: u64,
    pub filename: String,
    pub published_at: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservedCampaign {
    #[serde(default)]
    pub baseline: String,
    #[serde(default)]
    pub can_submit: bool,
    pub id: String,
    pub number: u32,
    pub name: String,
    pub round: u32,
    pub active_lord: String,
    pub turn_started_at: Option<String>,
    pub current: Option<SavePublication>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicationPage {
    pub current: Option<SavePublication>,
    pub publications: Vec<SavePublication>,
}
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ReceiveError {
    #[error("The cloud save changed after local work began. Resolve the Save conflict first.")]
    SaveConflict,
    #[error("The turn changed. Review local work and authorize Send again.")]
    StaleSubmission,
    #[error("The submission was rejected. Review its filename and contents before trying again.")]
    RejectedSubmission,
    #[error("Receiving interrupted by a user command.")]
    Interrupted,
    #[error("Offline; receiving will retry.")]
    Offline,
    #[error("Sign in again to receive saves.")]
    Unauthorized,
    #[error("Campaign access was lost.")]
    Forbidden,
    #[error("Update required before receiving saves.")]
    UpdateRequired,
    #[error("The save changed; receiving will retry with its new identity.")]
    SaveChanged,
    #[error("Receiving saved publications; catch-up will continue.")]
    CatchingUp,
    #[error("The server returned an invalid publication.")]
    InvalidResponse,
    #[error("The Companion could not record receive progress. No publication was skipped.")]
    Storage,
    #[error("The Campaign folder or save could not be safely read or written.")]
    FileSystem,
}
impl From<rusqlite::Error> for ReceiveError {
    fn from(_: rusqlite::Error) -> Self {
        Self::Storage
    }
}
impl From<std::io::Error> for ReceiveError {
    fn from(_: std::io::Error) -> Self {
        Self::FileSystem
    }
}
const MAX_SAVE_BYTES: u64 = 25 * 1024 * 1024;

impl Engine {
    pub(super) async fn receive_action(
        &mut self,
        campaign: &str,
        action: CampaignAction,
    ) -> Result<(), CommandError> {
        if self.snapshot.paused || self.snapshot.onboarding.stage != OnboardingStage::Complete {
            return Err(CommandError::NotAvailable);
        }
        if !matches!(
            action,
            CampaignAction::OpenFolder | CampaignAction::RedownloadCurrent
        ) {
            return Err(CommandError::NotAvailable);
        }
        if !self
            .snapshot
            .campaigns
            .iter()
            .any(|c| c.id == campaign && c.actions.contains(&action))
        {
            return Err(CommandError::NotAvailable);
        }
        let root = PathBuf::from(
            self.snapshot
                .root_path
                .as_ref()
                .ok_or(CommandError::InvalidCompanionRoot)?,
        );
        let folder =
            recover_folder(&root, campaign).map_err(|_| CommandError::InvalidCompanionRoot)?;
        if action == CampaignAction::OpenFolder {
            return self
                .platform
                .open_folder(&folder)
                .map_err(|_| CommandError::NotAvailable);
        }
        self.require_receive_effects(campaign)
            .map_err(|_| CommandError::NotAvailable)?;
        let observations = self
            .observe_campaigns()
            .await
            .map_err(|_| CommandError::AuthenticationUnavailable)?;
        let observation = observations
            .iter()
            .find(|c| c.id == campaign)
            .ok_or(CommandError::NotAvailable)?;
        self.scan_campaign(observation)
            .await
            .map_err(|_| CommandError::StorageUnavailable)?;
        self.refresh_recovery(observation)
            .map_err(|_| CommandError::StorageUnavailable)?;
        self.require_receive_effects(campaign)
            .map_err(|_| CommandError::NotAvailable)?;
        let current = observation
            .current
            .as_ref()
            .ok_or(CommandError::NotAvailable)?;
        let secrets = self
            .secrets
            .as_ref()
            .ok_or(CommandError::AuthenticationUnavailable)?;
        let account = secrets.account_id.clone();
        let access = secrets.access_token.clone();
        let cursor: u32 = self
            .store
            .connection
            .query_row(
                "SELECT cursor FROM receive_campaigns WHERE account=?1 AND campaign=?2",
                params![account, campaign],
                |r| r.get(0),
            )
            .map_err(|_| CommandError::StorageUnavailable)?;
        // Catch-up owns advancing the cursor. Redownload cannot jump over it.
        if cursor != current.publication {
            return Err(CommandError::NotAvailable);
        }
        self.receive_save(&account, &access, observation, &folder, current, true)
            .await
            .map_err(|_| CommandError::StorageUnavailable)?;
        self.reconcile().await?;
        Ok(())
    }

    /// Native coordinator's polling seam. Pausing allows observation, never file effects.
    pub async fn reconcile(&mut self) -> Result<Snapshot, CommandError> {
        self.check_reconciliation_gap();
        self.require_compatible_server()?;
        if self.snapshot.session.state != SessionState::SignedIn {
            return Ok(self.snapshot());
        }
        let previous = self.snapshot.clone();
        let observed = match self.observe_campaigns().await {
            Ok(campaigns) => campaigns,
            Err(error) => {
                self.receive_connection_error(&error).await;
                self.finish_change(&previous);
                return Ok(self.snapshot());
            }
        };
        self.recover_submissions(&observed).await;
        if self.snapshot.connection.state != ConnectionState::Connected
            || self.snapshot.session.state != SessionState::SignedIn
        {
            self.finish_change(&previous);
            return Ok(self.snapshot());
        }
        let mut campaigns = Vec::new();
        for observation in observed {
            let mut campaign = Campaign {
                paused: self.campaign_paused(&observation.id),
                recovery: None,
                recovery_token: None,
                countdown: None,
                automatic_mode: self.campaign_automatic_mode(&observation.id)?,
                candidates: vec![],
                id: observation.id.clone(),
                number: observation.number,
                name: observation.name.clone(),
                round: observation.round,
                active_lord: observation.active_lord.clone(),
                sync_status: SyncStatus::Receiving,
                status_label: "Waiting for setup".into(),
                detail: "Complete setup before receiving saves.".into(),
                automatic_uploads: self.snapshot.preferences.automatic_uploads,
                turn_started_at: observation.turn_started_at.clone(),
                last_transfer: "Never".into(),
                archive_bytes: 0,
                actions: vec![],
            };
            if self.onboarding_complete
                && self.snapshot.onboarding.stage == OnboardingStage::Complete
            {
                let scanned = self.scan_campaign(&observation).await;
                self.refresh_recovery(&observation)
                    .map_err(|_| CommandError::StorageUnavailable)?;
                match self.receive_campaign(&observation).await {
                    Ok((current, missing)) => {
                        campaign.sync_status = if self.snapshot.paused {
                            SyncStatus::Receiving
                        } else if missing {
                            SyncStatus::NeedsAttention
                        } else {
                            SyncStatus::Synchronized
                        };
                        campaign.status_label = if self.snapshot.paused {
                            "Paused"
                        } else if missing {
                            "Current save missing"
                        } else {
                            "Synchronized"
                        }
                        .into();
                        campaign.detail = if missing { "The received contents were moved or deleted. Redownload the current save when needed." } else { "Campaign saves are retained locally. New local work appears here as a Turn candidate." }.into();
                        campaign.last_transfer = current
                            .as_ref()
                            .map(|s| s.published_at.clone())
                            .unwrap_or_else(|| "No save yet".into());
                        if missing {
                            campaign.actions.push(CampaignAction::RedownloadCurrent);
                        }
                        if !self.snapshot.paused {
                            campaign.actions.push(CampaignAction::OpenFolder);
                        }
                    }
                    Err(ReceiveError::Interrupted) => {
                        self.finish_change(&previous);
                        return Ok(self.snapshot());
                    }
                    Err(error) => {
                        self.receive_connection_error(&error).await;
                        campaign.sync_status = if error == ReceiveError::CatchingUp {
                            SyncStatus::Receiving
                        } else {
                            SyncStatus::NeedsAttention
                        };
                        campaign.status_label = if error == ReceiveError::CatchingUp {
                            "Receiving publications"
                        } else {
                            "Receive needs attention"
                        }
                        .into();
                        campaign.detail = error.to_string();
                    }
                }
                if scanned.is_ok() {
                    campaign.candidates = self
                        .project_candidates(&observation)
                        .map_err(|_| CommandError::StorageUnavailable)?;
                } else {
                    campaign.candidates = self
                        .project_candidates(&observation)
                        .map_err(|_| CommandError::StorageUnavailable)?;
                    for candidate in &mut campaign.candidates {
                        candidate.can_send = false;
                        candidate.stable = false;
                    }
                    if campaign.sync_status != SyncStatus::NeedsAttention {
                        campaign.sync_status = SyncStatus::NeedsAttention;
                        campaign.status_label = "Folder scan incomplete".into();
                    }
                    campaign.detail = "The folder scan is incomplete. Local work is preserved; sending is blocked.".into();
                }
                if self
                    .has_pending_submission(&observation.id)
                    .map_err(|_| CommandError::StorageUnavailable)?
                {
                    campaign.sync_status = SyncStatus::Sending;
                    campaign.status_label = "Checking submission receipt".into();
                    campaign.detail="The exact submission is retained. Checking its server receipt before any new send.".into();
                    for candidate in &mut campaign.candidates {
                        candidate.can_send = false;
                    }
                }
            }
            if let Some(secrets) = &self.secrets {
                campaign.archive_bytes=self.store.connection.query_row("SELECT COALESCE(SUM(size),0) FROM (SELECT hash,MAX(size) AS size FROM received_publications WHERE account=?1 AND campaign=?2 AND state='published' GROUP BY hash)",params![secrets.account_id,observation.id],|r|r.get::<_,i64>(0)).map_err(|_|CommandError::StorageUnavailable)? as u64;
            }
            self.project_recovery(&mut campaign)?;
            campaign.automatic_uploads = self.automatic_enabled(&campaign.automatic_mode);
            campaigns.push(campaign);
            if self.snapshot.session.state != SessionState::SignedIn
                || self.snapshot.connection.state != ConnectionState::Connected
            {
                break;
            }
        }
        for id in self
            .pending_submission_campaigns()
            .map_err(|_| CommandError::StorageUnavailable)?
        {
            if campaigns.iter().any(|campaign| campaign.id == id) {
                continue;
            }
            let mut campaign = previous
                .campaigns
                .iter()
                .find(|campaign| campaign.id == id)
                .cloned()
                .unwrap_or_else(|| Campaign {
                    id: id.clone(),
                    number: 0,
                    name: "Unavailable Campaign".into(),
                    round: 0,
                    active_lord: "Unavailable".into(),
                    candidates: vec![],
                    countdown: None,
                    automatic_mode: AutomaticMode::Manual,
                    automatic_uploads: false,
                    paused: false,
                    recovery: None,
                    recovery_token: None,
                    sync_status: SyncStatus::Sending,
                    status_label: String::new(),
                    detail: String::new(),
                    turn_started_at: None,
                    last_transfer: "Unknown".into(),
                    archive_bytes: 0,
                    actions: vec![],
                });
            campaign.sync_status = SyncStatus::Sending;
            campaign.status_label = "Checking submission receipt".into();
            campaign.detail="Campaign access is unavailable. The original submission receipt is still being checked; no new send will start.".into();
            campaign.countdown = None;
            campaign.recovery = None;
            campaign.recovery_token = None;
            campaign.actions = vec![CampaignAction::OpenWeb];
            for candidate in &mut campaign.candidates {
                candidate.can_send = false;
            }
            campaigns.push(campaign);
        }
        self.snapshot.campaigns = if self.snapshot.session.state == SessionState::SignedIn {
            campaigns
        } else {
            vec![]
        };
        if !self.check_reconciliation_gap() {
            self.advance_automatic().await?;
        }
        self.finish_change(&previous);
        Ok(self.snapshot())
    }

    pub(super) async fn observe_campaigns(
        &mut self,
    ) -> Result<Vec<ObservedCampaign>, ReceiveError> {
        let access = self
            .secrets
            .as_ref()
            .ok_or(ReceiveError::Unauthorized)?
            .access_token
            .clone();
        match self.remote.observe(&access).await {
            Err(ReceiveError::Unauthorized) => {
                let access = self.refresh_receive_access().await?;
                self.remote.observe(&access).await
            }
            result => result,
        }
    }

    pub(super) async fn refresh_receive_access(&mut self) -> Result<String, ReceiveError> {
        let secrets = self.secrets.as_ref().ok_or(ReceiveError::Unauthorized)?;
        let account = secrets.account_id.clone();
        let credentials = self
            .remote
            .refresh(&secrets.refresh_token)
            .await
            .map_err(|e| {
                if e == RemoteError::Offline {
                    ReceiveError::Offline
                } else {
                    ReceiveError::Unauthorized
                }
            })?;
        if credentials.device_session.user.id != account {
            return Err(ReceiveError::Unauthorized);
        }
        self.accept_credentials(credentials)
            .map_err(|_| ReceiveError::Storage)?;
        Ok(self
            .secrets
            .as_ref()
            .ok_or(ReceiveError::Unauthorized)?
            .access_token
            .clone())
    }

    pub(super) async fn receive_connection_error(&mut self, error: &ReceiveError) {
        match error {
            ReceiveError::Unauthorized => {
                let _ = self.sign_out().await;
                self.snapshot.campaigns.clear();
            }
            ReceiveError::UpdateRequired => {
                self.observe_protocol(Ok("incompatible".into()));
            }
            ReceiveError::Offline => {
                self.observe_protocol(Err(()));
            }
            _ => {}
        }
    }

    async fn receive_campaign(
        &mut self,
        campaign: &ObservedCampaign,
    ) -> Result<(Option<SavePublication>, bool), ReceiveError> {
        if self.remote.receive_interrupted() {
            return Err(ReceiveError::Interrupted);
        }
        if self.has_save_conflict(&campaign.id) {
            return Err(ReceiveError::SaveConflict);
        }
        let secrets = self.secrets.as_ref().ok_or(ReceiveError::Unauthorized)?;
        let account = secrets.account_id.clone();
        let mut access = secrets.access_token.clone();
        if let Some(current) = &campaign.current {
            validate(current)?;
        }
        validate_campaign_id(&campaign.id).map_err(|_| ReceiveError::InvalidResponse)?;
        // Pin activation before network/file work. A restart must not choose a
        // newer baseline and silently lose publications that arrived meanwhile.
        self.store.connection.execute(
            "INSERT OR IGNORE INTO receive_campaigns(account,campaign,cursor) VALUES(?1,?2,?3)",
            params![
                account,
                campaign.id,
                campaign
                    .current
                    .as_ref()
                    .map(|s| s.publication.saturating_sub(1))
                    .unwrap_or(0)
            ],
        )?;
        let (mut cursor, binding): (u32, Option<String>) = self.store.connection.query_row(
            "SELECT cursor,folder FROM receive_campaigns WHERE account=?1 AND campaign=?2",
            params![account, campaign.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if self.snapshot.paused || self.campaign_paused(&campaign.id) {
            return Ok((campaign.current.clone(), false));
        }
        // The page can be newer than the observation used to classify local
        // work. Establish a coherent identity before creating folders, cleaning
        // stages, or publishing any received contents.
        let page = match self
            .remote
            .publications(&access, &campaign.id, cursor)
            .await
        {
            Err(ReceiveError::Unauthorized) => {
                access = self.refresh_receive_access().await?;
                self.remote
                    .publications(&access, &campaign.id, cursor)
                    .await?
            }
            result => result?,
        };
        if let Some(current) = &page.current {
            validate(current)?;
        }
        let mut expected = cursor;
        for publication in &page.publications {
            validate(publication)?;
            expected = expected
                .checked_add(1)
                .ok_or(ReceiveError::InvalidResponse)?;
            if publication.publication != expected {
                return Err(ReceiveError::InvalidResponse);
            }
        }
        if page.current.as_ref().map_or(0, |save| save.publication) < expected {
            return Err(ReceiveError::InvalidResponse);
        }
        if !same_publication_identity(page.current.as_ref(), campaign.current.as_ref()) {
            self.refresh_receive_identity(campaign).await?;
            return Err(ReceiveError::SaveChanged);
        }
        self.require_receive_effects(&campaign.id)?;
        let root = PathBuf::from(
            self.snapshot
                .root_path
                .as_ref()
                .ok_or(ReceiveError::FileSystem)?,
        );
        let identity = CampaignIdentity {
            id: campaign.id.clone(),
            number: campaign.number,
            name: campaign.name.clone(),
        };
        let previously_bound: bool = self.store.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM campaign_folders WHERE campaign_id=?1)",
            [&campaign.id],
            |row| row.get(0),
        )?;
        let folder = if binding.is_some() || previously_bound {
            recover_folder(&root, &identity.id)?
        } else {
            ensure_campaign_folder(&root, &identity)
                .map_err(|_| ReceiveError::FileSystem)?
                .path
        };
        self.store.connection.execute(
            "UPDATE receive_campaigns SET folder=?3 WHERE account=?1 AND campaign=?2",
            params![
                account,
                campaign.id,
                folder.to_str().ok_or(ReceiveError::FileSystem)?
            ],
        )?;
        self.store
            .remember_campaign_folder(&campaign.id, &folder)
            .map_err(|_| ReceiveError::Storage)?;
        self.cleanup_received_stages(&account, &identity.id, &folder)?;
        // One bounded page per tick keeps large catch-up work restartable.
        for publication in &page.publications {
            if self.remote.receive_interrupted() {
                return Err(ReceiveError::Interrupted);
            }
            validate(publication)?;
            if publication.publication != cursor + 1 {
                return Err(ReceiveError::InvalidResponse);
            }
            self.receive_save(&account, &access, campaign, &folder, publication, false)
                .await?;
            cursor = publication.publication;
        }
        if let Some(current) = &page.current {
            validate(current)?;
            if current.publication < cursor {
                return Err(ReceiveError::InvalidResponse);
            }
            if current.publication > cursor {
                return Err(ReceiveError::CatchingUp);
            }
            self.receive_save(&account, &access, campaign, &folder, current, false)
                .await?;
            let exists = self
                .find_received_content(&account, &identity.id, &folder, &current.content_hash)
                .await?
                .is_some();
            return Ok((page.current, !exists));
        }
        if cursor != 0 {
            return Err(ReceiveError::InvalidResponse);
        }
        Ok((None, false))
    }

    fn require_receive_effects(&self, campaign: &str) -> Result<(), ReceiveError> {
        if self.has_save_conflict(campaign) {
            return Err(ReceiveError::SaveConflict);
        }
        if self.remote.receive_interrupted() || self.campaign_effects_blocked(campaign) {
            return Err(ReceiveError::Interrupted);
        }
        Ok(())
    }

    async fn refresh_receive_identity(
        &mut self,
        previous: &ObservedCampaign,
    ) -> Result<(), ReceiveError> {
        self.require_receive_effects(&previous.id)?;
        let observations = self.observe_campaigns().await?;
        let current = observations
            .iter()
            .find(|campaign| campaign.id == previous.id)
            .ok_or(ReceiveError::Forbidden)?;
        if !same_publication_identity(previous.current.as_ref(), current.current.as_ref()) {
            // Capture work created during the request against the identity that
            // preceded it, never against the new canonical save.
            self.scan_campaign(previous).await?;
            self.refresh_recovery(current)?;
            self.require_receive_effects(&previous.id)?;
            return Err(ReceiveError::SaveChanged);
        }
        self.refresh_recovery(current)?;
        self.require_receive_effects(&previous.id)
    }

    fn received_content_record(
        &self,
        account: &str,
        campaign: &str,
        hash: &str,
    ) -> Result<Option<(String, i64)>, ReceiveError> {
        Ok(self.store.connection.query_row("SELECT path,size FROM received_publications WHERE campaign=?2 AND hash=?3 AND state='published' UNION ALL SELECT json_extract(submission,'$.filename'),json_extract(submission,'$.size') FROM turn_submissions WHERE campaign=?2 AND state='accepted' AND json_extract(submission,'$.contentHash')=?3 LIMIT 1",params![account,campaign,hash],|r|Ok((r.get(0)?,r.get(1)?))).optional()?)
    }

    async fn find_received_content(
        &mut self,
        account: &str,
        campaign: &str,
        folder: &Path,
        hash: &str,
    ) -> Result<Option<PathBuf>, ReceiveError> {
        let Some((preferred, expected_size)) =
            self.received_content_record(account, campaign, hash)?
        else {
            return Ok(None);
        };
        let preferred = checked_file_path(folder, &preferred)?;
        let folder = folder.to_owned();
        let hash = hash.to_owned();
        let remote = self.remote.clone();
        // Hashing uses one bounded blocking worker. Native commands request
        // interruption between files; snapshot reads never wait on this worker.
        tokio::task::spawn_blocking(move || {
            let matches = |path: &Path| -> Result<bool, ReceiveError> {
                if remote.receive_interrupted() {
                    return Err(ReceiveError::Interrupted);
                }
                Ok(regular_file(path)
                    && fs::metadata(path)?.len() == expected_size as u64
                    && file_hash(path)? == hash)
            };
            if matches(&preferred)? {
                return Ok(Some(preferred));
            }
            for entry in fs::read_dir(folder)? {
                let path = entry?.path();
                if path
                    .file_name()
                    .is_some_and(|n| n.to_string_lossy().starts_with('.'))
                {
                    continue;
                }
                if matches(&path)? {
                    return Ok(Some(path));
                }
            }
            Ok(None)
        })
        .await
        .map_err(|_| ReceiveError::FileSystem)?
    }

    async fn receive_save(
        &mut self,
        account: &str,
        access: &str,
        observation: &ObservedCampaign,
        folder: &Path,
        save: &SavePublication,
        force: bool,
    ) -> Result<(), ReceiveError> {
        let campaign = observation.id.as_str();
        self.require_receive_effects(campaign)?;
        validate(save)?;
        let row: Option<(String, Option<String>, String)> = self.store.connection.query_row("SELECT path,stage,state FROM received_publications WHERE account=?1 AND campaign=?2 AND publication=?3 AND revision=?4", params![account,campaign,save.publication,save.content_revision], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
        check_owned_folder(folder, campaign)?;
        if !force && row.as_ref().is_some_and(|r| r.2 == "published") {
            return Ok(());
        }
        if let Some((path, stage, state)) = &row {
            if state == "staged" || state == "planned" {
                if let Some(stage_path) = stage {
                    let local = checked_file_path(folder, stage_path)?;
                    if regular_file(&local)
                        && fs::metadata(&local).is_ok_and(|m| m.len() == save.size)
                        && file_hash(&local).is_ok_and(|hash| hash == save.content_hash)
                    {
                        return self
                            .publish_staged(account, campaign, folder, save, path, stage_path);
                    }
                }
                // The stage was deleted or its visible hardlink was edited.
                // Preserve user contents; authorize a fresh staging copy below.
            }
        }
        let known_path = self
            .received_content_record(account, campaign, &save.content_hash)?
            .map(|r| r.0);
        if !force {
            if let Some(old) = known_path {
                let path = self
                    .find_received_content(account, campaign, folder, &save.content_hash)
                    .await?
                    .and_then(|p| p.to_str().map(str::to_owned))
                    .unwrap_or(old);
                return self.finish_received(account, campaign, save, &path);
            }
        }
        let current_access = self
            .secrets
            .as_ref()
            .map(|s| s.access_token.clone())
            .unwrap_or_else(|| access.to_owned());
        let bytes = match self.remote.download(&current_access, campaign, save).await {
            Err(ReceiveError::Unauthorized) => {
                let access = self.refresh_receive_access().await?;
                self.remote.download(&access, campaign, save).await?
            }
            result => result?,
        };
        if bytes.len() as u64 != save.size || content_hash(&bytes) != save.content_hash {
            return Err(ReceiveError::InvalidResponse);
        }
        // Downloads are immutable and may remain valid after a newer cloud save
        // appears. Check current identity again before exposing those bytes.
        self.refresh_receive_identity(observation).await?;
        check_owned_folder(folder, campaign)?;
        let target = available_target(folder, &save.filename)?;
        let stage = unique_stage(folder)?;
        let path = target.to_str().ok_or(ReceiveError::FileSystem)?;
        let stage_path = stage.to_str().ok_or(ReceiveError::FileSystem)?;
        let tx = self.store.connection.transaction()?;
        if let Some((_, Some(old), _)) = &row {
            tx.execute(
                "INSERT OR IGNORE INTO receive_cleanup(account,campaign,path) VALUES(?1,?2,?3)",
                params![account, campaign, old],
            )?;
        }
        // The durable intent precedes stage creation. Failed/partial writes have
        // an owner and retry uses the same immutable publication, never skips it.
        tx.execute("INSERT INTO received_publications(account,campaign,publication,revision,hash,size,path,stage,state) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'planned') ON CONFLICT(account,campaign,publication,revision) DO UPDATE SET path=excluded.path,stage=excluded.stage,state='planned'", params![account,campaign,save.publication,save.content_revision,save.content_hash,save.size as i64,path,stage_path])?;
        tx.commit()?;
        self.require_receive_effects(campaign)?;
        check_owned_folder(folder, campaign)?;
        let mut staged = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&stage)?;
        staged.write_all(&bytes)?;
        staged.sync_all()?;
        drop(staged);
        sync_directory(folder)?;
        self.store.connection.execute("UPDATE received_publications SET state='staged' WHERE account=?1 AND campaign=?2 AND publication=?3 AND revision=?4",params![account,campaign,save.publication,save.content_revision])?;
        self.publish_staged(account, campaign, folder, save, path, stage_path)
    }

    fn publish_staged(
        &mut self,
        account: &str,
        campaign: &str,
        folder: &Path,
        save: &SavePublication,
        path: &str,
        stage_path: &str,
    ) -> Result<(), ReceiveError> {
        self.require_receive_effects(campaign)?;
        check_owned_folder(folder, campaign)?;
        let stage = checked_file_path(folder, stage_path)?;
        let mut target = checked_file_path(folder, path)?;
        if !regular_file(&stage) || file_hash(&stage)? != save.content_hash {
            return Err(ReceiveError::FileSystem);
        }
        // A crash after the hard link but before SQLite commit is recoverable.
        if !(regular_file(&target)
            && fs::metadata(&target).is_ok_and(|m| m.len() == save.size)
            && file_hash(&target).is_ok_and(|hash| hash == save.content_hash))
        {
            loop {
                self.require_receive_effects(campaign)?;
                match fs::hard_link(&stage, &target) {
                    Ok(()) => break,
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                        target = available_target(folder, &save.filename)?;
                        self.store.connection.execute("UPDATE received_publications SET path=?5 WHERE account=?1 AND campaign=?2 AND publication=?3 AND revision=?4", params![account,campaign,save.publication,save.content_revision,target.to_str().ok_or(ReceiveError::FileSystem)?])?;
                    }
                    Err(_) => return Err(ReceiveError::FileSystem),
                }
            }
        }
        sync_directory(folder)?;
        self.finish_received(
            account,
            campaign,
            save,
            target.to_str().ok_or(ReceiveError::FileSystem)?,
        )?;
        // This is only the resolved engine-owned staging copy, never a user save.
        self.cleanup_received_stages(account, campaign, folder)?;
        Ok(())
    }

    fn cleanup_received_stages(
        &self,
        account: &str,
        campaign: &str,
        folder: &Path,
    ) -> Result<(), ReceiveError> {
        self.require_receive_effects(campaign)?;
        check_owned_folder(folder, campaign)?;
        let mut query = self.store.connection.prepare(
            "SELECT path FROM receive_cleanup WHERE account=?1 AND campaign=?2 LIMIT 100",
        )?;
        let paths = query
            .query_map(params![account, campaign], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        for original in paths {
            self.require_receive_effects(campaign)?;
            let path = checked_file_path(folder, &original)?;
            if !path
                .file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with(".shadow-cloud-receive-"))
            {
                return Err(ReceiveError::Storage);
            }
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => continue,
            }
            self.store
                .connection
                .execute("DELETE FROM receive_cleanup WHERE path=?1", [original])?;
        }
        Ok(())
    }

    fn finish_received(
        &mut self,
        account: &str,
        campaign: &str,
        save: &SavePublication,
        path: &str,
    ) -> Result<(), ReceiveError> {
        let tx = self.store.connection.transaction()?;
        tx.execute("INSERT INTO received_publications(account,campaign,publication,revision,hash,size,path,state) VALUES(?1,?2,?3,?4,?5,?6,?7,'published') ON CONFLICT(account,campaign,publication,revision) DO UPDATE SET state='published',path=excluded.path", params![account,campaign,save.publication,save.content_revision,save.content_hash,save.size as i64,path])?;
        tx.execute("INSERT OR IGNORE INTO receive_cleanup(account,campaign,path) SELECT account,campaign,stage FROM received_publications WHERE account=?1 AND campaign=?2 AND publication=?3 AND revision=?4 AND stage IS NOT NULL",params![account,campaign,save.publication,save.content_revision])?;
        tx.execute("INSERT OR IGNORE INTO receive_cleanup(account,campaign,path) SELECT account,campaign,stage FROM received_publications WHERE account=?1 AND campaign=?2 AND publication=?3 AND revision<?4 AND stage IS NOT NULL",params![account,campaign,save.publication,save.content_revision])?;
        tx.execute("UPDATE received_publications SET state='superseded',stage=NULL WHERE account=?1 AND campaign=?2 AND publication=?3 AND revision<?4 AND state IN ('planned','staged')",params![account,campaign,save.publication,save.content_revision])?;
        tx.execute("UPDATE received_publications SET stage=NULL WHERE account=?1 AND campaign=?2 AND publication=?3 AND revision=?4",params![account,campaign,save.publication,save.content_revision])?;
        tx.execute(
            "UPDATE receive_campaigns SET cursor=MAX(cursor,?3) WHERE account=?1 AND campaign=?2",
            params![account, campaign, save.publication],
        )?;
        tx.commit()?;
        Ok(())
    }
}

fn same_publication_identity(
    left: Option<&SavePublication>,
    right: Option<&SavePublication>,
) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => {
            left.publication == right.publication
                && left.file_version_id == right.file_version_id
                && left.content_revision == right.content_revision
                && left.content_hash == right.content_hash
        }
        (None, None) => true,
        _ => false,
    }
}

fn validate(save: &SavePublication) -> Result<(), ReceiveError> {
    if save.publication == 0
        || save.size > MAX_SAVE_BYTES
        || save.content_hash.len() != 71
        || !save.content_hash.starts_with("sha256:")
        || !save.content_hash[7..]
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(ReceiveError::InvalidResponse);
    }
    if !valid_save_filename(&save.filename) {
        return Err(ReceiveError::InvalidResponse);
    }
    Ok(())
}
pub(super) fn valid_save_filename(filename: &str) -> bool {
    if filename.is_empty()
        || filename.starts_with('.')
        || filename.len() > 180
        || filename.contains(['/', '\\', ':', '<', '>', '"', '|', '?', '*'])
        || filename.chars().any(char::is_control)
        || filename.ends_with(['.', ' '])
    {
        return false;
    }
    let stem = filename
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ]
    .contains(&stem.as_str())
    {
        return false;
    }
    true
}
pub(super) fn content_hash(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}
pub(super) fn regular_file(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.is_file() && !m.file_type().is_symlink())
}
fn file_hash(path: &Path) -> Result<String, ReceiveError> {
    let mut reader = fs::File::open(path)?.take(MAX_SAVE_BYTES + 1);
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut size = 0;
    loop {
        let n = reader.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        size += n as u64;
        if size > MAX_SAVE_BYTES {
            return Err(ReceiveError::FileSystem);
        }
        hash.update(&buffer[..n]);
    }
    Ok(format!("sha256:{:x}", hash.finalize()))
}
fn sync_directory(path: &Path) -> Result<(), ReceiveError> {
    #[cfg(unix)]
    fs::File::open(path)?.sync_all()?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}
fn checked_file_path(folder: &Path, path: &str) -> Result<PathBuf, ReceiveError> {
    let name = Path::new(path)
        .file_name()
        .ok_or(ReceiveError::FileSystem)?;
    Ok(folder.join(name))
}
pub(super) fn recover_folder(root: &Path, campaign: &str) -> Result<PathBuf, ReceiveError> {
    if !fs::symlink_metadata(root)?.is_dir() || fs::symlink_metadata(root)?.file_type().is_symlink()
    {
        return Err(ReceiveError::FileSystem);
    }
    let canonical = fs::canonicalize(root)?;
    let mut found = None;
    for entry in fs::read_dir(&canonical)? {
        let path = entry?.path();
        let meta = fs::symlink_metadata(&path)?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            continue;
        }
        if marker_matches(&path, campaign).map_err(|_| ReceiveError::FileSystem)? {
            if found.is_some() {
                return Err(ReceiveError::FileSystem);
            }
            found = Some(checked_child(&canonical, &path).map_err(|_| ReceiveError::FileSystem)?);
        }
    }
    found.ok_or(ReceiveError::FileSystem)
}
fn unique_stage(folder: &Path) -> Result<PathBuf, ReceiveError> {
    use std::time::{SystemTime, UNIX_EPOCH};
    Ok(folder.join(format!(
        ".shadow-cloud-receive-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| ReceiveError::FileSystem)?
            .as_nanos()
    )))
}
fn available_target(folder: &Path, filename: &str) -> Result<PathBuf, ReceiveError> {
    let original = Path::new(filename);
    let stem = original
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or(ReceiveError::InvalidResponse)?;
    let ext = original
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| format!(".{s}"))
        .unwrap_or_default();
    for n in 0..10_000 {
        let path = folder.join(if n == 0 {
            filename.to_owned()
        } else {
            format!("{stem}-received-{n}{ext}")
        });
        match fs::symlink_metadata(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(path),
            Ok(_) => {}
            Err(_) => return Err(ReceiveError::FileSystem),
        }
    }
    Err(ReceiveError::FileSystem)
}

pub(super) fn check_owned_folder(folder: &Path, campaign: &str) -> Result<(), ReceiveError> {
    let metadata = fs::symlink_metadata(folder)?;
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || fs::canonicalize(folder)? != folder
        || !marker_matches(folder, campaign).map_err(|_| ReceiveError::FileSystem)?
    {
        return Err(ReceiveError::FileSystem);
    }
    Ok(())
}
