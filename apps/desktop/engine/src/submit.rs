use super::receive::{check_owned_folder, content_hash, recover_folder, regular_file};
use super::*;
use rusqlite::params;
use std::{
    collections::{HashMap, HashSet},
    io::Read,
    time::UNIX_EPOCH,
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CandidateAction {
    Send,
    Ignore,
    Restore,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnSubmission {
    pub operation_key: String,
    pub campaign_id: String,
    pub baseline: String,
    pub content_hash: String,
    pub filename: String,
    pub size: u64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmissionReceipt {
    #[serde(flatten)]
    pub submission: TurnSubmission,
    pub file_version_id: String,
    pub publication: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnCandidate {
    pub content_hash: String,
    pub filename: String,
    pub size: u64,
    pub modified_at: u64,
    pub stable: bool,
    pub ignored: bool,
    pub can_send: bool,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ScannedFile {
    filename: String,
    hash: String,
    size: u64,
    modified: u64,
}

pub(super) fn canonical(campaign: &ObservedCampaign) -> String {
    campaign
        .current
        .as_ref()
        .map(|s| {
            format!(
                "{}:{}:{}",
                s.file_version_id, s.content_revision, s.content_hash
            )
        })
        .unwrap_or_default()
}
pub(super) fn read_save(path: &Path) -> Result<(Vec<u8>, u64), ReceiveError> {
    if !regular_file(path) {
        return Err(ReceiveError::FileSystem);
    }
    let mut file = fs::File::open(path)?;
    let before = file.metadata()?;
    let modified = before
        .modified()?
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ReceiveError::FileSystem)?
        .as_millis() as u64;
    if before.len() == 0 || before.len() > 25 * 1024 * 1024 {
        return Err(ReceiveError::FileSystem);
    }
    let mut bytes = Vec::new();
    (&mut file)
        .take(25 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    let after = file.metadata()?;
    let path_after = fs::symlink_metadata(path)?;
    if !path_after.is_file()
        || path_after.file_type().is_symlink()
        || before.len() != after.len()
        || before.modified()? != after.modified()?
        || path_after.modified()? != after.modified()?
        || bytes.len() as u64 != before.len()
    {
        return Err(ReceiveError::FileSystem);
    }
    Ok((bytes, modified))
}

pub(super) async fn read_owned_save(
    folder: PathBuf,
    campaign: String,
    filename: String,
) -> Result<(Vec<u8>, u64, String), ReceiveError> {
    tokio::task::spawn_blocking(move || {
        check_owned_folder(&folder, &campaign)?;
        let (bytes, modified) = read_save(&folder.join(filename))?;
        let hash = content_hash(&bytes);
        check_owned_folder(&folder, &campaign)?;
        Ok((bytes, modified, hash))
    })
    .await
    .map_err(|_| ReceiveError::FileSystem)?
}

impl Engine {
    pub(super) async fn scan_campaign(
        &mut self,
        observation: &ObservedCampaign,
    ) -> Result<(), ReceiveError> {
        if self.snapshot.paused || self.campaign_paused(&observation.id) {
            return Ok(());
        }
        let account = self
            .secrets
            .as_ref()
            .ok_or(ReceiveError::Unauthorized)?
            .account_id
            .clone();
        let campaign = observation.id.clone();
        let root = Path::new(
            self.snapshot
                .root_path
                .as_ref()
                .ok_or(ReceiveError::FileSystem)?,
        );
        let folder = match recover_folder(root, &campaign) {
            Ok(folder) => folder,
            Err(error) => {
                let bound:bool=self.store.connection.query_row("SELECT EXISTS(SELECT 1 FROM receive_campaigns WHERE account=?1 AND campaign=?2 AND folder IS NOT NULL)",params![account,campaign],|r|r.get(0))?;
                if bound {
                    return Err(error);
                } else {
                    self.store.connection.execute("INSERT OR IGNORE INTO observed_campaigns(account,campaign,baseline,canonical) VALUES(?1,?2,?3,?4)",params![account,campaign,observation.baseline,canonical(observation)])?;
                    return Ok(());
                }
            }
        };
        let remote = self.remote.clone();
        let scan_campaign = campaign.clone();
        let scan = tokio::task::spawn_blocking(move || {
            check_owned_folder(&folder, &scan_campaign)?;
            let mut files = Vec::new();
            for entry in fs::read_dir(&folder)? {
                if remote.receive_interrupted() {
                    return Err(ReceiveError::Interrupted);
                }
                let path = entry?.path();
                if !path
                    .extension()
                    .is_some_and(|e| e.eq_ignore_ascii_case("se1"))
                    || path
                        .file_name()
                        .is_some_and(|n| n.to_string_lossy().starts_with('.'))
                {
                    continue;
                }
                if !regular_file(&path) {
                    return Err(ReceiveError::FileSystem);
                }
                let (bytes, modified) = read_save(&path)?;
                files.push(ScannedFile {
                    filename: path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .ok_or(ReceiveError::FileSystem)?
                        .to_owned(),
                    hash: content_hash(&bytes),
                    size: bytes.len() as u64,
                    modified,
                });
            }
            check_owned_folder(&folder, &scan_campaign)?;
            files.sort_by(|a, b| a.filename.cmp(&b.filename));
            Ok::<_, ReceiveError>(files)
        })
        .await
        .map_err(|_| ReceiveError::FileSystem)?;
        let files = match scan {
            Ok(files) => files,
            Err(error) => {
                self.scan_observations
                    .retain(|(a, c, _), _| a != &account || c != &campaign);
                return Err(error);
            }
        };
        let old:Option<(String,String)>=self.store.connection.query_row("SELECT baseline,canonical FROM observed_campaigns WHERE account=?1 AND campaign=?2",params![account,campaign],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
        let (baseline, base_save) =
            old.unwrap_or_else(|| (observation.baseline.clone(), canonical(observation)));
        let known: HashSet<String> = {
            let mut q=self.store.connection.prepare("SELECT hash FROM received_publications WHERE campaign=?1 UNION SELECT json_extract(submission,'$.contentHash') FROM turn_submissions WHERE campaign=?1 AND state='accepted'")?;
            let v = q
                .query_map(params![campaign], |r| r.get(0))?
                .collect::<Result<_, _>>()?;
            v
        };
        // New contents are still part of existing local work. A changed hash
        // must not silently acquire a newer turn/Seat baseline after it goes stale.
        let local_origin = {
            let mut query = self.store.connection.prepare("SELECT hash,baseline,canonical FROM turn_candidates WHERE account=?1 AND campaign=?2 AND present=1 AND ignored=0 ORDER BY rowid")?;
            let rows = query.query_map(params![account, campaign], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?;
            let mut origin = None;
            for row in rows {
                let (hash, baseline, canonical) = row?;
                if !known.contains(&hash) {
                    origin = Some((baseline, canonical));
                    break;
                }
            }
            origin
        };
        let (baseline, base_save) = local_origin.unwrap_or((baseline, base_save));
        let last_account: Option<String> = self
            .store
            .connection
            .query_row(
                "SELECT account FROM candidate_scan_accounts WHERE campaign=?1",
                params![campaign],
                |row| row.get(0),
            )
            .optional()?;
        let last_account = match last_account { Some(account)=>Some(account), None=>self.store.connection.query_row("SELECT account FROM observed_campaigns WHERE campaign=?1 ORDER BY rowid DESC LIMIT 1",params![campaign],|row|row.get(0)).optional()? };
        let changed_account = last_account.is_some_and(|previous| previous != account);
        let tx = self.store.connection.transaction()?;
        tx.execute(
            "UPDATE turn_candidates SET present=0,stable=0 WHERE account=?1 AND campaign=?2",
            params![account, campaign],
        )?;
        let mut seen = HashSet::new();
        let mut next = HashMap::new();
        for file in files {
            let key = (account.clone(), campaign.clone(), file.filename.clone());
            let stable = self.scan_observations.get(&key) == Some(&file);
            next.insert(key, file.clone());
            if known.contains(&file.hash) || !seen.insert(file.hash.clone()) {
                continue;
            }
            if changed_account {
                tx.execute("INSERT OR IGNORE INTO automatic_cancelled(account,campaign,hash) VALUES(?1,?2,?3)",params![account,campaign,file.hash])?;
            }
            tx.execute("INSERT INTO turn_candidates(account,campaign,hash,filename,size,modified,baseline,canonical,stable,present) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,1) ON CONFLICT(account,campaign,hash) DO UPDATE SET filename=excluded.filename,size=excluded.size,modified=excluded.modified,stable=excluded.stable,present=1",params![account,campaign,file.hash,file.filename,file.size as i64,file.modified as i64,baseline,base_save,stable])?;
        }
        tx.execute("INSERT INTO observed_campaigns(account,campaign,baseline,canonical) VALUES(?1,?2,?3,?4) ON CONFLICT(account,campaign) DO UPDATE SET baseline=excluded.baseline,canonical=excluded.canonical",params![account,campaign,observation.baseline,canonical(observation)])?;
        tx.execute("INSERT INTO candidate_scan_accounts(campaign,account) VALUES(?1,?2) ON CONFLICT(campaign) DO UPDATE SET account=excluded.account",params![campaign,account])?;
        tx.commit()?;
        self.scan_observations
            .retain(|(a, c, _), _| a != &account || c != &campaign);
        self.scan_observations.extend(next);
        Ok(())
    }

    pub(super) fn project_candidates(
        &self,
        observation: &ObservedCampaign,
    ) -> Result<Vec<TurnCandidate>, ReceiveError> {
        let account = &self
            .secrets
            .as_ref()
            .ok_or(ReceiveError::Unauthorized)?
            .account_id;
        let mut q=self.store.connection.prepare("SELECT hash,filename,size,modified,stable,ignored,canonical,baseline FROM turn_candidates WHERE account=?1 AND campaign=?2 AND present=1 ORDER BY filename")?;
        let candidates = q
            .query_map(params![account, observation.id], |r| {
                let stable: bool = r.get(4)?;
                let ignored: bool = r.get(5)?;
                Ok(TurnCandidate {
                    content_hash: r.get(0)?,
                    filename: r.get(1)?,
                    size: r.get::<_, i64>(2)? as u64,
                    modified_at: r.get::<_, i64>(3)? as u64,
                    stable,
                    ignored,
                    can_send: !self.campaign_sending_blocked(&observation.id)
                        && stable
                        && !ignored
                        && !self.snapshot.paused
                        && observation.can_submit
                        && super::receive::valid_save_filename(&r.get::<_, String>(1)?)
                        && r.get::<_, String>(6)? == canonical(observation)
                        && r.get::<_, String>(7)? == observation.baseline,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(candidates)
    }

    pub(super) async fn candidate_action(
        &mut self,
        campaign: &str,
        hash: &str,
        action: CandidateAction,
    ) -> Result<(), CommandError> {
        if !self.onboarding_complete
            || self.snapshot.onboarding.stage != OnboardingStage::Complete
            || self.snapshot.session.state != SessionState::SignedIn
            || self.snapshot.paused
        {
            return Err(CommandError::NotAvailable);
        }
        let account = self
            .secrets
            .as_ref()
            .ok_or(CommandError::AuthenticationUnavailable)?
            .account_id
            .clone();
        if !self
            .snapshot
            .campaigns
            .iter()
            .any(|c| c.id == campaign && c.candidates.iter().any(|v| v.content_hash == hash))
        {
            return Err(CommandError::NotAvailable);
        }
        match action {
            CandidateAction::Send => {
                self.authorize_submission(campaign, hash, false).await?;
            }
            CandidateAction::Ignore | CandidateAction::Restore => {
                let tx = self
                    .store
                    .connection
                    .transaction()
                    .map_err(|_| CommandError::StorageUnavailable)?;
                tx.execute("UPDATE turn_candidates SET ignored=?4 WHERE account=?1 AND campaign=?2 AND hash=?3",params![account,campaign,hash,action==CandidateAction::Ignore]).map_err(|_|CommandError::StorageUnavailable)?;
                if action == CandidateAction::Ignore {
                    // Ignoring exact contents withdraws any authorization that has
                    // not reached the server. Dispatched keys still need receipts.
                    tx.execute("UPDATE turn_submissions SET state='abandoned' WHERE account=?1 AND campaign=?2 AND state IN ('planned','prepared') AND json_extract(submission,'$.contentHash')=?3",params![account,campaign,hash]).map_err(|_|CommandError::StorageUnavailable)?;
                }
                tx.commit().map_err(|_| CommandError::StorageUnavailable)?;
                for c in &mut self.snapshot.campaigns {
                    if c.id == campaign {
                        for v in &mut c.candidates {
                            if v.content_hash == hash {
                                v.ignored = action == CandidateAction::Ignore;
                                v.can_send = false;
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }
}

impl Engine {
    pub(super) fn has_pending_submission(&self, campaign: &str) -> Result<bool, ReceiveError> {
        let Some(secrets) = &self.secrets else {
            return Ok(false);
        };
        Ok(self.store.connection.query_row("SELECT EXISTS(SELECT 1 FROM turn_submissions WHERE account=?1 AND campaign=?2 AND state IN ('prepared','dispatched'))",params![secrets.account_id,campaign],|r|r.get(0))?)
    }
    pub(super) async fn authorize_submission(
        &mut self,
        campaign: &str,
        hash: &str,
        automatic: bool,
    ) -> Result<(), CommandError> {
        let authorized_at = self.platform.now_millis();
        self.require_compatible_server()?;
        if self
            .has_pending_submission(campaign)
            .map_err(|_| CommandError::StorageUnavailable)?
        {
            return Err(CommandError::NotAvailable);
        }
        let observations = match self.observe_campaigns().await {
            Ok(observations) => observations,
            Err(error) => {
                self.receive_connection_error(&error).await;
                return Err(CommandError::AuthenticationUnavailable);
            }
        };
        let observation = observations
            .iter()
            .find(|c| c.id == campaign)
            .ok_or(CommandError::NotAvailable)?;
        self.scan_campaign(observation)
            .await
            .map_err(|_| CommandError::StorageUnavailable)?;
        self.refresh_recovery(observation)
            .map_err(|_| CommandError::StorageUnavailable)?;
        let candidates = self
            .project_candidates(observation)
            .map_err(|_| CommandError::StorageUnavailable)?;
        if automatic
            && candidates
                .iter()
                .filter(|candidate| !candidate.ignored)
                .count()
                != 1
        {
            return Err(CommandError::NotAvailable);
        }
        let candidate = candidates
            .into_iter()
            .find(|c| c.content_hash == hash && c.can_send)
            .ok_or(CommandError::NotAvailable)?;
        let folder = recover_folder(
            Path::new(
                self.snapshot
                    .root_path
                    .as_ref()
                    .ok_or(CommandError::InvalidCompanionRoot)?,
            ),
            campaign,
        )
        .map_err(|_| CommandError::InvalidCompanionRoot)?;
        let (bytes, modified, read_hash) =
            read_owned_save(folder.clone(), campaign.into(), candidate.filename.clone())
                .await
                .map_err(|_| CommandError::StorageUnavailable)?;
        if read_hash != hash || modified != candidate.modified_at {
            return Err(CommandError::NotAvailable);
        }
        let mut random = [0u8; 24];
        getrandom::fill(&mut random).map_err(|_| CommandError::StorageUnavailable)?;
        let operation = random
            .iter()
            .map(|n| format!("{n:02x}"))
            .collect::<String>();
        let submission = TurnSubmission {
            operation_key: operation.clone(),
            campaign_id: campaign.into(),
            baseline: observation.baseline.clone(),
            content_hash: hash.into(),
            filename: candidate.filename,
            size: candidate.size,
        };
        let account = self
            .secrets
            .as_ref()
            .ok_or(CommandError::AuthenticationUnavailable)?
            .account_id
            .clone();
        let stage = folder.join(format!(".shadow-cloud-send-{operation}"));
        self.store.connection.execute("INSERT INTO turn_submissions(account,campaign,operation,submission,stage,state) VALUES(?1,?2,?3,?4,?5,'planned')",params![account,campaign,operation,serde_json::to_string(&submission).map_err(|_|CommandError::StorageUnavailable)?,stage.to_str().ok_or(CommandError::StorageUnavailable)?]).map_err(|_|CommandError::StorageUnavailable)?;
        if automatic {
            self.store
                .connection
                .execute(
                    "INSERT INTO automatic_submissions(account,operation) VALUES(?1,?2)",
                    params![account, operation],
                )
                .map_err(|_| CommandError::StorageUnavailable)?;
        }
        let owned_campaign = campaign.to_owned();
        let bytes = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, ReceiveError> {
            check_owned_folder(&folder, &owned_campaign)?;
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&stage)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            #[cfg(unix)]
            fs::File::open(&folder)?.sync_all()?;
            check_owned_folder(&folder, &owned_campaign)?;
            Ok(bytes)
        })
        .await
        .map_err(|_| CommandError::StorageUnavailable)?
        .map_err(|_| CommandError::StorageUnavailable)?;
        if automatic
            && (self.remote.receive_interrupted()
                || self
                    .platform
                    .now_millis()
                    .checked_sub(authorized_at)
                    .is_none_or(|elapsed| elapsed > 5_000))
        {
            self.store.connection.execute("UPDATE turn_submissions SET state='abandoned' WHERE account=?1 AND operation=?2", params![account,operation]).map_err(|_|CommandError::StorageUnavailable)?;
            return Err(CommandError::NotAvailable);
        }
        self.store
            .connection
            .execute(
                "UPDATE turn_submissions SET state='prepared' WHERE account=?1 AND operation=?2",
                params![account, operation],
            )
            .map_err(|_| CommandError::StorageUnavailable)?;
        self.dispatch_submission(&account, &submission, bytes).await;
        let state: String = self
            .store
            .connection
            .query_row(
                "SELECT state FROM turn_submissions WHERE account=?1 AND operation=?2",
                params![account, operation],
                |r| r.get(0),
            )
            .map_err(|_| CommandError::StorageUnavailable)?;
        if automatic && state == "prepared" {
            // Cancel/Pause can arrive between completing the stage and dispatch.
            // An undispatched automatic operation must not be retried by recovery.
            self.store.connection.execute("UPDATE turn_submissions SET state='abandoned' WHERE account=?1 AND operation=?2", params![account,operation]).map_err(|_|CommandError::StorageUnavailable)?;
            return Err(CommandError::NotAvailable);
        }
        for c in &mut self.snapshot.campaigns {
            if c.id == campaign {
                match state.as_str() {
                    "accepted" => {
                        c.sync_status = SyncStatus::Synchronized;
                        c.status_label = "Submission accepted".into();
                        c.detail =
                            "The server accepted the exact turn. Your original file is preserved."
                                .into();
                        c.candidates.retain(|v| v.content_hash != hash);
                    }
                    "rejected" => {
                        c.sync_status = SyncStatus::NeedsAttention;
                        c.status_label = "Submission rejected".into();
                        c.detail="Review the current turn, filename and contents before authorizing another Send.".into();
                    }
                    _ => {
                        c.sync_status = SyncStatus::Sending;
                        c.status_label = "Checking submission receipt".into();
                        c.detail =
                            "The exact submission is retained while its receipt is checked.".into();
                    }
                }
                for candidate in &mut c.candidates {
                    candidate.can_send = false;
                }
            }
        }
        Ok(())
    }
    pub(super) async fn dispatch_submission(
        &mut self,
        account: &str,
        submission: &TurnSubmission,
        bytes: Vec<u8>,
    ) {
        if self.snapshot.paused
            || self.remote.receive_interrupted()
            || self.snapshot.connection.state != ConnectionState::Connected
            || self.snapshot.onboarding.stage != OnboardingStage::Complete
            || !self
                .secrets
                .as_ref()
                .is_some_and(|s| s.account_id == account)
        {
            return;
        }
        if self
            .store
            .connection
            .execute(
                "UPDATE turn_submissions SET state='dispatched' WHERE account=?1 AND operation=?2",
                params![account, submission.operation_key],
            )
            .is_err()
        {
            return;
        }
        let access = self.secrets.as_ref().unwrap().access_token.clone();
        let mut result = self.remote.submit(&access, submission, bytes.clone()).await;
        if result == Err(ReceiveError::Unauthorized) {
            if let Ok(access) = self.refresh_receive_access().await {
                result = self.remote.submit(&access, submission, bytes).await;
            }
        }
        match result {
            Ok(receipt) => {
                let _ = self.accept_receipt(account, submission, &receipt);
            }
            Err(
                ReceiveError::StaleSubmission
                | ReceiveError::Forbidden
                | ReceiveError::RejectedSubmission,
            ) => {
                let _=self.store.connection.execute("UPDATE turn_submissions SET state='rejected' WHERE account=?1 AND operation=?2",params![account,submission.operation_key]);
            }
            Err(error) => {
                self.receive_connection_error(&error).await;
            }
        }
    }
    pub(super) fn accept_receipt(
        &mut self,
        account: &str,
        submission: &TurnSubmission,
        receipt: &SubmissionReceipt,
    ) -> Result<(), ReceiveError> {
        if receipt.submission != *submission
            || receipt.publication == 0
            || receipt.file_version_id.is_empty()
        {
            return Err(ReceiveError::InvalidResponse);
        }
        let tx = self.store.connection.transaction()?;
        tx.execute(
            "UPDATE turn_submissions SET state='accepted' WHERE account=?1 AND operation=?2",
            params![account, submission.operation_key],
        )?;
        tx.execute("UPDATE campaign_recovery SET state='',token='' WHERE account=?1 AND campaign=?2 AND state='reviewed'", params![account,submission.campaign_id])?;
        tx.commit()?;
        Ok(())
    }
}
