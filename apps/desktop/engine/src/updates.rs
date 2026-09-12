use super::*;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateChannel {
    #[default]
    Stable,
    Preview,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpdateOffer {
    pub offer_id: String,
    pub version: String,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCapabilities {
    pub tray_available: bool,
    pub start_at_login_available: bool,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateState {
    #[default]
    Idle,
    Checking,
    Current,
    Available,
    Installing,
    Error,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateBlocker {
    Countdown,
    Transfer,
    UncertainSubmission,
    Conflict,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSnapshot {
    pub state: UpdateState,
    pub version: Option<String>,
    pub offer_id: Option<String>,
    pub install_blockers: Vec<UpdateBlocker>,
    pub detail: Option<String>,
}
impl Engine {
    pub fn refresh_desktop_capabilities(&mut self) -> Snapshot {
        let previous = self.snapshot.clone();
        self.snapshot.desktop = self.platform.desktop_capabilities();
        self.snapshot.preferences.start_at_login =
            self.platform.start_at_login_enabled().unwrap_or(false);
        self.finish_change(&previous);
        self.snapshot()
    }
}

impl Engine {
    pub(super) fn set_update_channel(
        &mut self,
        channel: UpdateChannel,
    ) -> Result<(), CommandError> {
        self.store.set(
            "update_channel",
            match channel {
                UpdateChannel::Stable => "stable",
                UpdateChannel::Preview => "preview",
            },
        )?;
        self.snapshot.preferences.update_channel = channel;
        self.snapshot.updates = UpdateSnapshot::default();
        Ok(())
    }
    pub(super) async fn check_for_updates(&mut self) -> Result<(), CommandError> {
        let previous = self.snapshot.clone();
        self.snapshot.updates = UpdateSnapshot {
            state: UpdateState::Checking,
            ..Default::default()
        };
        self.finish_change(&previous);
        match self
            .platform
            .check_update(self.snapshot.preferences.update_channel)
            .await
        {
            Ok(Some(offer)) => {
                self.snapshot.updates.state = UpdateState::Available;
                self.snapshot.updates.version = Some(offer.version);
                self.snapshot.updates.offer_id = Some(offer.offer_id);
            }
            Ok(None) => self.snapshot.updates.state = UpdateState::Current,
            Err(()) => {
                self.snapshot.updates.state = UpdateState::Error;
                self.snapshot.updates.detail = Some(
                    "Updates could not be checked. Try again when the update service is reachable."
                        .into(),
                );
                return Err(CommandError::NotAvailable);
            }
        }
        Ok(())
    }
    pub(super) async fn install_update(&mut self, offer_id: &str) -> Result<(), CommandError> {
        if self.snapshot.updates.state != UpdateState::Available
            || self.snapshot.updates.offer_id.as_deref() != Some(offer_id)
        {
            return Err(CommandError::NotAvailable);
        }
        self.refresh_update_blockers()?;
        if !self.snapshot.updates.install_blockers.is_empty() {
            return Err(CommandError::NotAvailable);
        }
        let previous = self.snapshot.clone();
        self.snapshot.updates.state = UpdateState::Installing;
        self.snapshot.updates.offer_id = None;
        self.finish_change(&previous);
        match self.platform.install_update(offer_id).await {
            Ok(()) => {
                self.snapshot.updates.state = UpdateState::Current;
                self.snapshot.updates.detail =
                    Some("Update installed. Restart Companion to use it.".into());
            }
            Err(()) => {
                self.snapshot.updates.state = UpdateState::Error;
                self.snapshot.updates.detail = Some(
                    "The update was not installed. Check again before reviewing another install."
                        .into(),
                );
                return Err(CommandError::NotAvailable);
            }
        }
        Ok(())
    }
    pub(super) fn set_start_at_login(&mut self, enabled: bool) -> Result<(), CommandError> {
        if !self
            .platform
            .desktop_capabilities()
            .start_at_login_available
        {
            return Err(CommandError::NotAvailable);
        }
        let changed = self.platform.set_start_at_login(enabled);
        // An OS adapter can change registration before a later cleanup fails.
        // Publish its observed state even when the command reports that error.
        self.snapshot.preferences.start_at_login = self
            .platform
            .start_at_login_enabled()
            .map_err(|_| CommandError::NotAvailable)?;
        changed.map_err(|_| CommandError::NotAvailable)?;
        if self.snapshot.preferences.start_at_login != enabled {
            return Err(CommandError::NotAvailable);
        }
        Ok(())
    }
    pub(super) fn set_keep_running_in_tray(&mut self, enabled: bool) -> Result<(), CommandError> {
        if enabled && !self.platform.desktop_capabilities().tray_available {
            return Err(CommandError::NotAvailable);
        }
        self.store.set(
            "keep_running_in_tray",
            if enabled { "true" } else { "false" },
        )?;
        self.snapshot.preferences.keep_running_in_tray = enabled;
        Ok(())
    }
}

impl Engine {
    pub(super) fn refresh_update_blockers(&mut self) -> Result<(), CommandError> {
        let exists = |sql: &str| {
            self.store
                .connection
                .query_row(sql, [], |row| row.get::<_, bool>(0))
                .map_err(|_| CommandError::StorageUnavailable)
        };
        // Installation changes the executable for every account on this device.
        // Signing out must never conceal an unfinished operation or conflict.
        let mut blockers = Vec::new();
        if !self.countdowns.is_empty() {
            blockers.push(UpdateBlocker::Countdown);
        }
        if self.active_transfer || exists("SELECT EXISTS(SELECT 1 FROM received_publications WHERE state IN ('planned','staged'))")? {blockers.push(UpdateBlocker::Transfer);}
        if exists("SELECT EXISTS(SELECT 1 FROM turn_submissions WHERE state IN ('prepared','dispatched'))")? {blockers.push(UpdateBlocker::UncertainSubmission);}
        if exists("SELECT EXISTS(SELECT 1 FROM campaign_recovery WHERE state='conflict')")? {
            blockers.push(UpdateBlocker::Conflict);
        }
        self.snapshot.updates.install_blockers = blockers;
        Ok(())
    }
    pub(super) fn set_transfer_active(&mut self, active: bool) {
        let previous = self.snapshot.clone();
        self.active_transfer = active;
        self.finish_change(&previous);
    }
}
