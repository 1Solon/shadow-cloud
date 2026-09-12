use super::*;
use rusqlite::params;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RecoveryState {
    Conflict,
    Stale,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResolutionAction {
    UseLatest,
    KeepLocalAndPause,
    ReviewCurrentTurn,
}

impl Engine {
    pub(super) fn campaign_paused(&self, campaign: &str) -> bool {
        let Some(account) = self.secrets.as_ref().map(|s| &s.account_id) else {
            return true;
        };
        if self
            .pending_campaign_pauses
            .contains(&(account.clone(), campaign.to_owned()))
        {
            return true;
        }
        self.store.connection.query_row("SELECT EXISTS(SELECT 1 FROM campaign_recovery WHERE account=?1 AND campaign=?2 AND paused=1)",params![account,campaign],|r|r.get(0)).unwrap_or(true)
    }
    pub(super) fn has_save_conflict(&self, campaign: &str) -> bool {
        let Some(account) = self.secrets.as_ref().map(|s| &s.account_id) else {
            return true;
        };
        self.store.connection.query_row("SELECT EXISTS(SELECT 1 FROM campaign_recovery WHERE account=?1 AND campaign=?2 AND state='conflict')",params![account,campaign],|r|r.get(0)).unwrap_or(true)
    }
    pub(super) fn campaign_effects_blocked(&self, campaign: &str) -> bool {
        self.snapshot.paused
            || self.campaign_paused(campaign)
            || self.has_save_conflict(campaign)
            || self.snapshot.connection.state != ConnectionState::Connected
            || self.snapshot.onboarding.stage != OnboardingStage::Complete
            || self.snapshot.session.state != SessionState::SignedIn
    }
    pub(super) fn campaign_sending_blocked(&self, campaign: &str) -> bool {
        if self.campaign_effects_blocked(campaign) {
            return true;
        }
        let account = &self.secrets.as_ref().unwrap().account_id;
        self.store.connection.query_row("SELECT EXISTS(SELECT 1 FROM campaign_recovery WHERE account=?1 AND campaign=?2 AND state IN ('conflict','stale'))",params![account,campaign],|r|r.get(0)).unwrap_or(true)
    }
    pub(super) fn campaign_automatic_blocked(&self, campaign: &str) -> bool {
        if self.campaign_effects_blocked(campaign) {
            return true;
        }
        let account = &self.secrets.as_ref().unwrap().account_id;
        self.store.connection.query_row("SELECT EXISTS(SELECT 1 FROM campaign_recovery WHERE account=?1 AND campaign=?2 AND state<>'')", params![account,campaign], |r|r.get(0)).unwrap_or(true)
    }
    pub(super) fn refresh_recovery(
        &mut self,
        observation: &ObservedCampaign,
    ) -> Result<(), ReceiveError> {
        let account = &self
            .secrets
            .as_ref()
            .ok_or(ReceiveError::Unauthorized)?
            .account_id;
        let pause_key = (account.clone(), observation.id.clone());
        if self.pending_campaign_pauses.contains(&pause_key) {
            self.store.connection.execute("INSERT INTO campaign_recovery(account,campaign,paused) VALUES(?1,?2,1) ON CONFLICT(account,campaign) DO UPDATE SET paused=1",params![account,observation.id])?;
            self.pending_campaign_pauses.remove(&pause_key);
        }
        let canonical = submit::canonical(observation);
        let old:Option<(String,String,String,String)>=self.store.connection.query_row("SELECT state,baseline,canonical,token FROM campaign_recovery WHERE account=?1 AND campaign=?2",params![account,observation.id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
        let conflicts:bool=self.store.connection.query_row("SELECT EXISTS(SELECT 1 FROM turn_candidates WHERE account=?1 AND campaign=?2 AND present=1 AND ignored=0 AND canonical<>?3)",params![account,observation.id,canonical],|r|r.get(0))?;
        let stale:bool=self.store.connection.query_row("SELECT EXISTS(SELECT 1 FROM turn_candidates WHERE account=?1 AND campaign=?2 AND present=1 AND ignored=0 AND baseline<>?3)",params![account,observation.id,observation.baseline],|r|r.get(0))?;
        let state = if conflicts
            || old
                .as_ref()
                .is_some_and(|r| r.0 == "conflict" || (r.0 == "stale" && r.2 != canonical))
        {
            "conflict"
        } else if stale || old.as_ref().is_some_and(|r| r.0 == "stale") {
            "stale"
        } else if old.as_ref().is_some_and(|r| r.0 == "reviewed") {
            "reviewed"
        } else {
            ""
        };
        let token = if old
            .as_ref()
            .is_some_and(|r| r.0 == state && r.1 == observation.baseline && r.2 == canonical)
        {
            old.unwrap().3
        } else if state.is_empty() {
            String::new()
        } else {
            let mut bytes = [0u8; 24];
            getrandom::fill(&mut bytes).map_err(|_| ReceiveError::Storage)?;
            bytes.iter().map(|b| format!("{b:02x}")).collect()
        };
        self.store.connection.execute("INSERT INTO campaign_recovery(account,campaign,state,baseline,canonical,token) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(account,campaign) DO UPDATE SET state=excluded.state,baseline=excluded.baseline,canonical=excluded.canonical,token=excluded.token",params![account,observation.id,state,observation.baseline,canonical,token])?;
        Ok(())
    }
    pub(super) fn project_recovery(&self, campaign: &mut Campaign) -> Result<(), CommandError> {
        let Some(account) = self.secrets.as_ref().map(|s| &s.account_id) else {
            return Ok(());
        };
        let row: Option<(String, String, bool)> = self
            .store
            .connection
            .query_row(
                "SELECT state,token,paused FROM campaign_recovery WHERE account=?1 AND campaign=?2",
                params![account, campaign.id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(|_| CommandError::StorageUnavailable)?;
        let Some((state, token, paused)) = row else {
            return Ok(());
        };
        let checking_receipt = self
            .has_pending_submission(&campaign.id)
            .map_err(|_| CommandError::StorageUnavailable)?;
        let receipt_detail = campaign.detail.clone();
        let paused = paused || self.campaign_paused(&campaign.id);
        campaign.paused = paused;
        campaign.recovery = match state.as_str() {
            "conflict" => Some(RecoveryState::Conflict),
            "stale" => Some(RecoveryState::Stale),
            _ => None,
        };
        campaign.recovery_token = if campaign.recovery.is_some() {
            Some(token)
        } else {
            None
        };
        if state == "conflict" {
            campaign.sync_status = SyncStatus::Conflict;
            campaign.status_label = "Save conflict".into();
            campaign.detail="The cloud save changed after local work began. Preserve local work before using the latest cloud save.".into();
            campaign
                .actions
                .retain(|a| *a != CampaignAction::RedownloadCurrent);
            campaign.actions.push(CampaignAction::ResolveConflict);
        } else if state == "stale" {
            campaign.sync_status = SyncStatus::NeedsAttention;
            campaign.status_label = "Turn authorization changed".into();
            campaign.detail="The save is unchanged, but the turn or Seat changed. Review the current turn before authorizing Send again.".into();
        } else if state == "reviewed" {
            campaign.status_label = "Ready for manual Send".into();
            campaign.detail =
                "The current turn has been reviewed. Choose Send to authorize this local work."
                    .into();
        } else if paused {
            campaign.status_label = "Campaign paused".into();
            campaign.detail =
                "Receiving and sending are paused for this Campaign. Local files are preserved."
                    .into();
        }
        if checking_receipt {
            campaign.sync_status = SyncStatus::Sending;
            campaign.status_label = "Checking submission receipt".into();
            campaign.detail = receipt_detail;
        }
        if !campaign.actions.contains(&CampaignAction::OpenWeb) {
            campaign.actions.push(CampaignAction::OpenWeb);
        }
        if campaign.recovery.is_some() || paused {
            for candidate in &mut campaign.candidates {
                candidate.can_send = false;
            }
        }
        Ok(())
    }
    pub(super) fn set_campaign_paused(
        &mut self,
        campaign: &str,
        paused: bool,
    ) -> Result<(), CommandError> {
        if !self.snapshot.campaigns.iter().any(|c| c.id == campaign) {
            return Err(CommandError::NotAvailable);
        }
        let account = &self
            .secrets
            .as_ref()
            .ok_or(CommandError::AuthenticationUnavailable)?
            .account_id;
        let key = (account.clone(), campaign.to_owned());
        if paused {
            self.pending_campaign_pauses.insert(key.clone());
            for current in &mut self.snapshot.campaigns {
                if current.id == campaign {
                    current.paused = true;
                    for candidate in &mut current.candidates {
                        candidate.can_send = false;
                    }
                }
            }
        }
        self.store.connection.execute("INSERT INTO campaign_recovery(account,campaign,paused) VALUES(?1,?2,?3) ON CONFLICT(account,campaign) DO UPDATE SET paused=excluded.paused",params![account,campaign,paused]).map_err(|_|CommandError::StorageUnavailable)?;
        self.pending_campaign_pauses.remove(&key);
        for c in &mut self.snapshot.campaigns {
            if c.id == campaign {
                c.paused = paused;
                for candidate in &mut c.candidates {
                    candidate.can_send = false;
                }
            }
        }
        Ok(())
    }
    async fn reviewed_campaign(
        &mut self,
        campaign: &str,
        token: Option<&str>,
    ) -> Result<ObservedCampaign, CommandError> {
        self.require_compatible_server()?;
        if self.snapshot.paused
            || self.campaign_paused(campaign)
            || self.snapshot.onboarding.stage != OnboardingStage::Complete
        {
            return Err(CommandError::NotAvailable);
        }
        let observation = self
            .observe_campaigns()
            .await
            .map_err(|_| CommandError::AuthenticationUnavailable)?
            .into_iter()
            .find(|c| c.id == campaign)
            .ok_or(CommandError::NotAvailable)?;
        self.scan_campaign(&observation)
            .await
            .map_err(|_| CommandError::StorageUnavailable)?;
        self.refresh_recovery(&observation)
            .map_err(|_| CommandError::StorageUnavailable)?;
        let account = &self
            .secrets
            .as_ref()
            .ok_or(CommandError::AuthenticationUnavailable)?
            .account_id;
        let expected: String = self
            .store
            .connection
            .query_row(
                "SELECT token FROM campaign_recovery WHERE account=?1 AND campaign=?2",
                params![account, campaign],
                |r| r.get(0),
            )
            .map_err(|_| CommandError::StorageUnavailable)?;
        if token.is_none_or(|token| token.is_empty() || token != expected) {
            return Err(CommandError::NotAvailable);
        }
        Ok(observation)
    }
    pub(super) async fn resolve_campaign(
        &mut self,
        campaign: &str,
        action: ResolutionAction,
        review_token: Option<&str>,
    ) -> Result<(), CommandError> {
        if matches!(action, ResolutionAction::KeepLocalAndPause) {
            return self.set_campaign_paused(campaign, true);
        }
        let observation = self.reviewed_campaign(campaign, review_token).await?;
        let account = self
            .secrets
            .as_ref()
            .ok_or(CommandError::AuthenticationUnavailable)?
            .account_id
            .clone();
        let token = review_token.unwrap().to_owned();
        let state: String = self
            .store
            .connection
            .query_row(
                "SELECT state FROM campaign_recovery WHERE account=?1 AND campaign=?2",
                params![account, campaign],
                |r| r.get(0),
            )
            .map_err(|_| CommandError::StorageUnavailable)?;
        if self
            .has_pending_submission(campaign)
            .map_err(|_| CommandError::StorageUnavailable)?
        {
            return Err(CommandError::NotAvailable);
        }
        if matches!(action, ResolutionAction::ReviewCurrentTurn) {
            if state != "stale" {
                return Err(CommandError::NotAvailable);
            }
            {
                let tx = self
                    .store
                    .connection
                    .transaction()
                    .map_err(|_| CommandError::StorageUnavailable)?;
                tx.execute("UPDATE turn_candidates SET baseline=?3 WHERE account=?1 AND campaign=?2 AND present=1 AND ignored=0 AND canonical=?4",params![account,campaign,observation.baseline,submit::canonical(&observation)]).map_err(|_|CommandError::StorageUnavailable)?;
                tx.execute("INSERT OR IGNORE INTO automatic_cancelled(account,campaign,hash) SELECT account,campaign,hash FROM turn_candidates WHERE account=?1 AND campaign=?2 AND present=1",params![account,campaign]).map_err(|_|CommandError::StorageUnavailable)?;
                tx.execute("UPDATE campaign_recovery SET state='reviewed',token='' WHERE account=?1 AND campaign=?2",params![account,campaign]).map_err(|_|CommandError::StorageUnavailable)?;
                tx.commit().map_err(|_| CommandError::StorageUnavailable)?;
            }
            self.reconcile().await?;
            return Ok(());
        }
        if state != "conflict" {
            return Err(CommandError::NotAvailable);
        }
        let candidates = self
            .project_candidates(&observation)
            .map_err(|_| CommandError::StorageUnavailable)?;
        let folder = receive::recover_folder(
            Path::new(
                self.snapshot
                    .root_path
                    .as_ref()
                    .ok_or(CommandError::InvalidCompanionRoot)?,
            ),
            campaign,
        )
        .map_err(|_| CommandError::InvalidCompanionRoot)?;
        for candidate in &candidates {
            if self.remote.receive_interrupted() {
                return Err(CommandError::NotAvailable);
            }
            self.store.connection.execute("INSERT OR IGNORE INTO conflict_preservations(account,campaign,token,hash,filename,size) VALUES(?1,?2,?3,?4,?5,?6)",params![account,campaign,token,candidate.content_hash,candidate.filename,candidate.size as i64]).map_err(|_|CommandError::StorageUnavailable)?;
            let (bytes, _, hash) = submit::read_owned_save(
                folder.clone(),
                campaign.to_owned(),
                candidate.filename.clone(),
            )
            .await
            .map_err(|_| CommandError::StorageUnavailable)?;
            if hash != candidate.content_hash || bytes.len() as u64 != candidate.size {
                return Err(CommandError::NotAvailable);
            }
            let owned_folder = folder.clone();
            let owned_campaign = campaign.to_owned();
            let owned_token = token.clone();
            let remote = self.remote.clone();
            let path = tokio::task::spawn_blocking(move || {
                preserve_copy(
                    &owned_folder,
                    &owned_campaign,
                    &owned_token,
                    &hash,
                    &bytes,
                    &*remote,
                )
            })
            .await
            .map_err(|_| CommandError::StorageUnavailable)?
            .map_err(|_| CommandError::StorageUnavailable)?;
            self.store.connection.execute("UPDATE conflict_preservations SET path=?5,state='preserved' WHERE account=?1 AND campaign=?2 AND token=?3 AND hash=?4",params![account,campaign,token,candidate.content_hash,path.to_str().ok_or(CommandError::StorageUnavailable)?]).map_err(|_|CommandError::StorageUnavailable)?;
        }
        // Only the exact reviewed cloud identity and still-present contents can
        // complete this resolution. A second change leaves every copy preserved.
        let fresh = self.reviewed_campaign(campaign, Some(&token)).await?;
        let now = self
            .project_candidates(&fresh)
            .map_err(|_| CommandError::StorageUnavailable)?;
        let hashes = |candidates: &[TurnCandidate]| {
            candidates
                .iter()
                .map(|c| c.content_hash.clone())
                .collect::<std::collections::BTreeSet<_>>()
        };
        if hashes(&now) != hashes(&candidates) || self.remote.receive_interrupted() {
            return Err(CommandError::NotAvailable);
        }
        {
            let tx = self
                .store
                .connection
                .transaction()
                .map_err(|_| CommandError::StorageUnavailable)?;
            for candidate in &candidates {
                tx.execute("UPDATE turn_candidates SET ignored=1 WHERE account=?1 AND campaign=?2 AND hash=?3",params![account,campaign,candidate.content_hash]).map_err(|_|CommandError::StorageUnavailable)?;
                tx.execute("INSERT OR IGNORE INTO automatic_cancelled(account,campaign,hash) VALUES(?1,?2,?3)",params![account,campaign,candidate.content_hash]).map_err(|_|CommandError::StorageUnavailable)?;
            }
            tx.execute("UPDATE campaign_recovery SET state='',token='' WHERE account=?1 AND campaign=?2 AND token=?3",params![account,campaign,token]).map_err(|_|CommandError::StorageUnavailable)?;
            tx.commit().map_err(|_| CommandError::StorageUnavailable)?;
        }
        self.reconcile().await?;
        Ok(())
    }
}

fn preserve_copy(
    folder: &Path,
    campaign: &str,
    token: &str,
    hash: &str,
    bytes: &[u8],
    remote: &dyn CompanionRemote,
) -> Result<PathBuf, ReceiveError> {
    receive::check_owned_folder(folder, campaign)?;
    if remote.receive_interrupted() {
        return Err(ReceiveError::Interrupted);
    }
    // Unmarked or unexpected directories are preserved and skipped, including
    // an empty directory left by a crash before its ownership marker committed.
    let mut selected = None;
    for suffix in 0..1000 {
        let area = folder.join(if suffix == 0 {
            ".shadow-cloud-conflicts".into()
        } else {
            format!(".shadow-cloud-conflicts-{suffix}")
        });
        match fs::create_dir(&area) {
            Ok(()) => {
                write_marker(&area, campaign).map_err(|_| ReceiveError::FileSystem)?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err(ReceiveError::FileSystem),
        }
        if receive::check_owned_folder(&area, campaign).is_ok() {
            selected = Some(area);
            break;
        }
    }
    let area = selected.ok_or(ReceiveError::FileSystem)?;
    for suffix in 0..1000 {
        if remote.receive_interrupted() {
            return Err(ReceiveError::Interrupted);
        }
        receive::check_owned_folder(folder, campaign)?;
        receive::check_owned_folder(&area, campaign)?;
        let target = area.join(format!(
            "{token}-{}-{suffix}.se1",
            hash.trim_start_matches("sha256:")
        ));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&target) {
            Ok(mut file) => {
                file.write_all(bytes)?;
                file.sync_all()?;
                drop(file);
                #[cfg(unix)]
                {
                    fs::File::open(&area)?.sync_all()?;
                    fs::File::open(folder)?.sync_all()?;
                }
                receive::check_owned_folder(folder, campaign)?;
                receive::check_owned_folder(&area, campaign)?;
                return Ok(target);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if submit::read_save(&target).is_ok_and(|(existing, _)| existing == bytes) {
                    return Ok(target);
                }
            }
            Err(_) => return Err(ReceiveError::FileSystem),
        }
    }
    Err(ReceiveError::FileSystem)
}
