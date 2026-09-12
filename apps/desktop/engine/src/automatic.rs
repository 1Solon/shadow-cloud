use super::*;
use rusqlite::params;

#[derive(Clone, Debug)]
pub struct AutomaticNotification {
    pub campaign_id: String,
    pub campaign_name: String,
    pub filename: String,
    pub authorization_id: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum AutomaticMode {
    #[default]
    Inherit,
    Automatic,
    Manual,
}
impl AutomaticMode {
    fn enabled(&self, global: bool) -> bool {
        match self {
            Self::Inherit => global,
            Self::Automatic => true,
            Self::Manual => false,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Countdown {
    pub authorization_id: String,
    pub content_hash: String,
    pub remaining_seconds: u64,
}
#[derive(Clone)]
pub(super) struct Authorization {
    campaign: String,
    account: String,
    hash: String,
    id: String,
    deadline: u64,
}

impl Engine {
    /// Native power events invalidate authorization even for a short sleep.
    pub fn resume(&mut self) -> Snapshot {
        let previous = self.snapshot.clone();
        for id in self.countdowns.keys().cloned().collect::<Vec<_>>() {
            self.drop_countdown(&id);
        }
        self.scan_observations.clear();
        self.last_reconciliation = None;
        self.finish_change(&previous);
        self.snapshot()
    }

    pub(super) fn automatic_enabled(&self, mode: &AutomaticMode) -> bool {
        mode.enabled(self.snapshot.preferences.automatic_uploads)
    }
    pub(super) fn campaign_automatic_mode(
        &self,
        campaign: &str,
    ) -> Result<AutomaticMode, CommandError> {
        let account = self
            .secrets
            .as_ref()
            .ok_or(CommandError::AuthenticationUnavailable)?;
        Ok(
            match self
                .store
                .get(&format!("automatic:{}:{campaign}", account.account_id))?
                .as_deref()
            {
                Some("automatic") => AutomaticMode::Automatic,
                Some("manual") => AutomaticMode::Manual,
                _ => AutomaticMode::Inherit,
            },
        )
    }
    pub(super) fn set_campaign_automatic(
        &mut self,
        campaign: &str,
        mode: AutomaticMode,
    ) -> Result<(), CommandError> {
        if !self.snapshot.campaigns.iter().any(|c| c.id == campaign) {
            return Err(CommandError::NotAvailable);
        }
        let account = self
            .secrets
            .as_ref()
            .ok_or(CommandError::AuthenticationUnavailable)?;
        self.store.set(
            &format!("automatic:{}:{campaign}", account.account_id),
            match mode {
                AutomaticMode::Inherit => "inherit",
                AutomaticMode::Automatic => "automatic",
                AutomaticMode::Manual => "manual",
            },
        )?;
        let enabled = self.automatic_enabled(&mode);
        for c in &mut self.snapshot.campaigns {
            if c.id == campaign {
                c.automatic_mode = mode.clone();
                c.automatic_uploads = enabled;
            }
        }
        Ok(())
    }
    fn eligible_hash(&self, campaign: &Campaign) -> Option<String> {
        if self.snapshot.paused
            || self.campaign_automatic_blocked(&campaign.id)
            || !self.onboarding_complete
            || self.snapshot.onboarding.stage != OnboardingStage::Complete
            || self.snapshot.connection.state != ConnectionState::Connected
            || self.snapshot.session.state != SessionState::SignedIn
            || !self.automatic_enabled(&campaign.automatic_mode)
            || campaign.sync_status != SyncStatus::Synchronized
        {
            return None;
        }
        let candidates: Vec<_> = campaign.candidates.iter().filter(|c| !c.ignored).collect();
        if candidates.len() != 1 || !candidates[0].can_send {
            return None;
        }
        let account = self.secrets.as_ref()?;
        if self.pending_cancellations.contains(&(
            account.account_id.clone(),
            campaign.id.clone(),
            candidates[0].content_hash.clone(),
        )) {
            return None;
        }
        Some(candidates[0].content_hash.clone())
    }
    fn drop_countdown(&mut self, campaign: &str) {
        if let Some(authorization) = self.countdowns.remove(campaign) {
            self.platform.dismiss_automatic(&authorization.id);
            self.retired_countdowns.push_back(authorization);
            while self.retired_countdowns.len() > 200 {
                self.retired_countdowns.pop_front();
            }
        }
        for c in &mut self.snapshot.campaigns {
            if c.id == campaign {
                c.countdown = None;
                c.actions
                    .retain(|a| *a != CampaignAction::CancelAutomaticSend);
                if c.status_label.starts_with("Sends in ") {
                    c.status_label = "Turn candidate ready".into();
                    c.detail = "Choose Send when this file is your completed turn.".into();
                }
            }
        }
    }
    pub(super) fn cancel_automatic(
        &mut self,
        campaign: &str,
        id: Option<&str>,
    ) -> Result<(), CommandError> {
        let authorization = self
            .countdowns
            .get(campaign)
            .filter(|a| id.is_none_or(|id| id == a.id))
            .cloned()
            .or_else(|| {
                id.and_then(|id| {
                    self.retired_countdowns
                        .iter()
                        .rev()
                        .find(|a| a.id == id && a.campaign == campaign)
                        .cloned()
                })
            });
        let Some(authorization) = authorization else {
            return Ok(());
        };
        if self
            .secrets
            .as_ref()
            .is_none_or(|s| s.account_id != authorization.account)
        {
            return Ok(());
        }
        let previous = self.snapshot.clone();
        let key = (
            authorization.account.clone(),
            campaign.to_owned(),
            authorization.hash.clone(),
        );
        // Cancel takes effect before storage. If persistence fails, keep this
        // suppression in memory and retry its durable write during reconciliation.
        self.pending_cancellations.insert(key.clone());
        if self
            .countdowns
            .get(campaign)
            .is_some_and(|a| a.hash == authorization.hash && a.account == authorization.account)
        {
            self.drop_countdown(campaign);
        }
        if self
            .store
            .connection
            .execute(
                "INSERT OR IGNORE INTO automatic_cancelled(account,campaign,hash) VALUES(?1,?2,?3)",
                params![authorization.account, campaign, authorization.hash],
            )
            .is_err()
        {
            self.finish_change(&previous);
            return Err(CommandError::StorageUnavailable);
        }
        self.pending_cancellations.remove(&key);
        Ok(())
    }
    pub(super) fn clear_invalid_countdowns(&mut self) {
        let invalid: Vec<_> = self
            .countdowns
            .iter()
            .filter(|(id, a)| {
                self.secrets
                    .as_ref()
                    .is_none_or(|s| s.account_id != a.account)
                    || self
                        .snapshot
                        .campaigns
                        .iter()
                        .find(|c| c.id == **id)
                        .and_then(|c| self.eligible_hash(c))
                        .as_ref()
                        != Some(&a.hash)
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in invalid {
            self.drop_countdown(&id);
        }
        let global = self.snapshot.preferences.automatic_uploads;
        for c in &mut self.snapshot.campaigns {
            c.automatic_uploads = c.automatic_mode.enabled(global);
        }
    }
    pub(super) fn check_reconciliation_gap(&mut self) -> bool {
        let now = self.platform.now_millis();
        // No elapsed deadline survives suspension, a clock change, or a stalled worker.
        let interrupted = self
            .last_reconciliation
            .is_some_and(|last| now < last || now - last > 5_000);
        if interrupted {
            for id in self.countdowns.keys().cloned().collect::<Vec<_>>() {
                self.drop_countdown(&id);
            }
            self.scan_observations.clear();
        }
        self.last_reconciliation = Some(now);
        interrupted
    }
    pub(super) async fn advance_automatic(&mut self) -> Result<(), CommandError> {
        for key in self.pending_cancellations.clone() {
            if self.store.connection.execute("INSERT OR IGNORE INTO automatic_cancelled(account,campaign,hash) VALUES(?1,?2,?3)",params![key.0,key.1,key.2]).is_ok() { self.pending_cancellations.remove(&key); }
        }
        self.clear_invalid_countdowns();
        let Some(account) = self.secrets.as_ref().map(|s| s.account_id.clone()) else {
            return Ok(());
        };
        let eligible: Vec<_> = self
            .snapshot
            .campaigns
            .iter()
            .filter_map(|c| self.eligible_hash(c).map(|hash| (c.clone(), hash)))
            .collect();
        for (campaign, hash) in eligible {
            if self.remote.receive_interrupted() {
                break;
            }
            let cancelled: bool=self.store.connection.query_row("SELECT EXISTS(SELECT 1 FROM automatic_cancelled WHERE account=?1 AND campaign=?2 AND hash=?3)",params![account,campaign.id,hash],|r|r.get(0)).map_err(|_|CommandError::StorageUnavailable)?;
            if cancelled {
                continue;
            }
            if !self.countdowns.contains_key(&campaign.id) {
                let mut random = [0u8; 24];
                getrandom::fill(&mut random).map_err(|_| CommandError::StorageUnavailable)?;
                let id = random
                    .iter()
                    .map(|n| format!("{n:02x}"))
                    .collect::<String>();
                let filename = campaign
                    .candidates
                    .iter()
                    .find(|c| c.content_hash == hash)
                    .unwrap()
                    .filename
                    .clone();
                let notification = AutomaticNotification {
                    campaign_id: campaign.id.clone(),
                    campaign_name: campaign.name.clone(),
                    filename,
                    authorization_id: id.clone(),
                };
                if self.platform.notify_automatic(notification).await.is_err() {
                    if let Some(c) = self
                        .snapshot
                        .campaigns
                        .iter_mut()
                        .find(|c| c.id == campaign.id)
                    {
                        c.detail="Automatic sending needs native notifications with Cancel and sleep detection. Choose Send manually if either is unavailable.".into();
                    }
                    continue;
                }
                self.countdowns.insert(
                    campaign.id.clone(),
                    Authorization {
                        campaign: campaign.id.clone(),
                        account: account.clone(),
                        hash: hash.clone(),
                        id,
                        deadline: self.platform.now_millis() + 15_000,
                    },
                );
            }
            let authorization = self.countdowns.get(&campaign.id).unwrap();
            let now = self.platform.now_millis();
            if now >= authorization.deadline {
                if self
                    .authorize_submission(&campaign.id, &hash, true)
                    .await
                    .is_ok()
                {
                    self.cancel_automatic(&campaign.id, None)?;
                } else {
                    // No POST was dispatched: recover with a fresh full window.
                    self.drop_countdown(&campaign.id);
                }
            } else if let Some(c) = self
                .snapshot
                .campaigns
                .iter_mut()
                .find(|c| c.id == campaign.id)
            {
                let remaining = (authorization.deadline - now).div_ceil(1000);
                c.countdown = Some(Countdown {
                    authorization_id: authorization.id.clone(),
                    content_hash: hash,
                    remaining_seconds: remaining,
                });
                c.status_label = format!("Sends in 00:{remaining:02}");
                c.detail = "Cancel to keep this file as an ordinary Turn candidate.".into();
                c.actions.push(CampaignAction::CancelAutomaticSend);
            }
        }
        Ok(())
    }
}
