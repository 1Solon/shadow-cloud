use super::*;
use rusqlite::params;

struct ActivityEvent {
    scope: String,
    fingerprint: String,
    campaign_name: String,
    description: String,
}

fn campaign_event(campaign: &Campaign) -> ActivityEvent {
    let candidates = campaign
        .candidates
        .iter()
        .filter(|candidate| !candidate.ignored)
        .count();
    let stable = campaign
        .candidates
        .iter()
        .filter(|candidate| !candidate.ignored && candidate.stable)
        .count();
    let ignored = campaign
        .candidates
        .iter()
        .filter(|candidate| candidate.ignored)
        .count();
    let countdown = campaign.countdown.is_some();
    let fingerprint = serde_json::json!([
        campaign.sync_status,
        candidates,
        stable,
        ignored,
        countdown,
        campaign.last_transfer.chars().take(64).collect::<String>()
    ])
    .to_string();
    let description = if countdown {
        "Automatic Send started; Cancel is available."
    } else {
        match campaign.sync_status {
            SyncStatus::Conflict => "Save conflict needs attention. Local work is preserved.",
            SyncStatus::Sending => "Turn submission is awaiting confirmation.",
            SyncStatus::NeedsAttention => "Campaign needs attention. Local work is preserved.",
            SyncStatus::Archived => "Campaign is archived.",
            SyncStatus::Receiving => {
                "Observing Campaign and receiving Save publications when available."
            }
            SyncStatus::Synchronized if candidates > 0 => {
                "Turn candidates are available for review."
            }
            SyncStatus::Synchronized => "Campaign Save publications are synchronized.",
        }
    };
    ActivityEvent {
        scope: campaign.id.clone(),
        fingerprint,
        campaign_name: format!(
            "{} : {}",
            campaign.number,
            campaign.name.chars().take(160).collect::<String>()
        ),
        description: description.into(),
    }
}

impl Engine {
    /// This report is generated only by an explicit command, never persisted or sent.
    pub(super) fn generate_diagnostics(&mut self) -> Result<(), CommandError> {
        let count = |query: &str| {
            self.store
                .connection
                .query_row(query, [], |row| row.get::<_, i64>(0))
                .map_err(|_| CommandError::StorageUnavailable)
        };
        let candidates = self
            .snapshot
            .campaigns
            .iter()
            .flat_map(|campaign| &campaign.candidates);
        let report = serde_json::json!({
            "schemaVersion": 1,
            "appVersion": RELEASE,
            "protocolVersion": RELEASE,
            "platform": std::env::consts::OS,
            "architecture": std::env::consts::ARCH,
            "connection": self.snapshot.connection.state,
            // Server protocol text is untrusted and may contain private response data.
            "serverProtocolMatches": self.snapshot.connection.server_protocol_version.as_ref().map(|value| value == RELEASE),
            "session": self.snapshot.session.state,
            "credentialStorage": self.snapshot.session.credential_storage,
            "paused": self.snapshot.paused,
            "readOnly": self.snapshot.read_only,
            "desktop": self.snapshot.desktop,
            "updates": {
                "state": self.snapshot.updates.state,
                "channel": self.snapshot.preferences.update_channel,
                "blockedBy": self.snapshot.updates.install_blockers,
            },
            "counts": {
                "campaigns": self.snapshot.campaigns.len(),
                "turnCandidates": candidates.clone().count(),
                "ignoredCandidates": candidates.filter(|candidate| candidate.ignored).count(),
                "countdowns": self.snapshot.campaigns.iter().filter(|campaign| campaign.countdown.is_some()).count(),
                "conflicts": self.snapshot.campaigns.iter().filter(|campaign| campaign.sync_status == SyncStatus::Conflict).count(),
                "pendingSubmissions": count("SELECT COUNT(*) FROM turn_submissions WHERE state IN ('prepared','dispatched')")?,
            },
            "history": {
                "activityRows": count("SELECT COUNT(*) FROM recent_activity")?,
                "receivedPublicationRows": count("SELECT COUNT(*) FROM received_publications")?,
                "submissionRows": count("SELECT COUNT(*) FROM turn_submissions")?,
                "candidateRows": count("SELECT COUNT(*) FROM turn_candidates")?,
                "campaignFolderBindings": count("SELECT COUNT(*) FROM campaign_folders")?,
            },
        });
        self.snapshot.diagnostics = Some(
            serde_json::to_string_pretty(&report).map_err(|_| CommandError::StorageUnavailable)?,
        );
        Ok(())
    }

    pub(super) fn record_activity(&mut self, previous: &Snapshot) {
        let Some(account) = self
            .secrets
            .as_ref()
            .map(|secrets| secrets.account_id.clone())
        else {
            self.snapshot.activity.clear();
            return;
        };
        let fingerprint = format!(
            "{:?}:{}",
            self.snapshot.connection.state, self.snapshot.paused
        );
        let description = match self.snapshot.connection.state {
            ConnectionState::Checking => "Checking the connection to Shadow Cloud.",
            ConnectionState::Offline => "Shadow Cloud is offline. Local work is preserved.",
            ConnectionState::UpdateRequired => "Update required before transfers can resume.",
            ConnectionState::Connected if self.snapshot.paused => "All Campaigns paused.",
            ConnectionState::Connected => "Connected to Shadow Cloud. Observation is active.",
        };
        let mut events = vec![ActivityEvent {
            scope: "$companion".into(),
            fingerprint,
            campaign_name: "Companion".into(),
            description: description.into(),
        }];
        events.extend(self.snapshot.campaigns.iter().map(campaign_event));
        events.extend(
            previous
                .campaigns
                .iter()
                .filter(|campaign| {
                    !self
                        .snapshot
                        .campaigns
                        .iter()
                        .any(|current| current.id == campaign.id)
                })
                .map(|campaign| ActivityEvent {
                    fingerprint: "not-observed".into(),
                    description: "Campaign is no longer observed. Local files are preserved."
                        .into(),
                    ..campaign_event(campaign)
                }),
        );
        let occurred_at = self.platform.now_millis() as f64 / 1_000.0;
        // Recent activity is presentation history. A failed write must not turn a
        // committed transfer into an error or discard its durable safety record.
        let result = (|| -> Result<Vec<Activity>, rusqlite::Error> {
            let tx = self.store.connection.transaction()?;
            for event in events {
                let last: Option<String> = tx.query_row(
                    "SELECT fingerprint FROM recent_activity WHERE account=?1 AND scope=?2 ORDER BY id DESC LIMIT 1",
                    params![account, event.scope],
                    |row| row.get(0),
                ).optional()?;
                if last.as_deref() != Some(&event.fingerprint) {
                    tx.execute(
                        "INSERT INTO recent_activity(account,scope,fingerprint,campaign_name,description,occurred_at)
                         VALUES(?1,?2,?3,?4,?5,COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',?6,'unixepoch'),'1970-01-01T00:00:00.000Z'))",
                        params![account, event.scope, event.fingerprint, event.campaign_name, event.description, occurred_at],
                    )?;
                }
            }
            tx.execute(
                "DELETE FROM recent_activity WHERE id NOT IN (SELECT id FROM recent_activity ORDER BY id DESC LIMIT 500)",
                [],
            )?;
            let activities = {
                let mut query = tx.prepare(
                    "SELECT id,campaign_name,description,occurred_at FROM recent_activity WHERE account=?1 ORDER BY id DESC LIMIT 100",
                )?;
                let rows = query
                    .query_map([&account], |row| {
                        Ok(Activity {
                            id: row.get::<_, i64>(0)?.to_string(),
                            campaign_name: row.get(1)?,
                            description: row.get(2)?,
                            occurred_at: row.get(3)?,
                        })
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                rows
            };
            tx.commit()?;
            Ok(activities)
        })();
        if let Ok(activities) = result {
            self.snapshot.activity = activities;
        }
    }
}
