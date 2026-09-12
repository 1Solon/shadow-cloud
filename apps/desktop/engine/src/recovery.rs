use super::receive::{check_owned_folder, content_hash, recover_folder, regular_file};
use super::submit::read_owned_save;
use super::*;
use rusqlite::params;
use std::io::Read;

struct PendingSubmission {
    row: i64,
    campaign: String,
    operation: String,
    payload: String,
    stage: String,
    state: String,
    automatic: bool,
}

impl Engine {
    pub(super) fn pending_submission_campaigns(&self) -> Result<Vec<String>, ReceiveError> {
        let Some(secrets) = &self.secrets else {
            return Ok(vec![]);
        };
        let mut query = self.store.connection.prepare("SELECT DISTINCT campaign FROM turn_submissions WHERE account=?1 AND state IN ('prepared','dispatched') ORDER BY campaign")?;
        let campaigns = query
            .query_map([&secrets.account_id], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(campaigns)
    }

    fn next_submissions(&self, account: &str) -> Result<Vec<PendingSubmission>, ReceiveError> {
        let cursor = self
            .store
            .get(&format!("submission-recovery-cursor:{account}"))
            .map_err(|_| ReceiveError::Storage)?
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(0);
        let mut query = self.store.connection.prepare("SELECT rowid,campaign,operation,submission,stage,state,EXISTS(SELECT 1 FROM automatic_submissions a WHERE a.account=turn_submissions.account AND a.operation=turn_submissions.operation) FROM turn_submissions WHERE account=?1 AND state IN ('planned','prepared','dispatched') AND rowid>?2 ORDER BY rowid LIMIT 100")?;
        let mut read = |cursor| {
            query
                .query_map(params![account, cursor], |row| {
                    Ok(PendingSubmission {
                        row: row.get(0)?,
                        campaign: row.get(1)?,
                        operation: row.get(2)?,
                        payload: row.get(3)?,
                        stage: row.get(4)?,
                        state: row.get(5)?,
                        automatic: row.get(6)?,
                    })
                })?
                .collect::<Result<Vec<_>, rusqlite::Error>>()
        };
        let rows = read(cursor)?;
        Ok(if rows.is_empty() && cursor != 0 {
            read(0)?
        } else {
            rows
        })
    }

    fn abandon_submission(&self, account: &str, operation: &str) {
        // Only operations proved never dispatched can lose authorization. An
        // uncertain request keeps its key until the server supplies its receipt.
        let _ = self.store.connection.execute("UPDATE turn_submissions SET state='abandoned' WHERE account=?1 AND operation=?2 AND state IN ('planned','prepared')", params![account, operation]);
    }

    pub(super) async fn recover_submissions(&mut self, observations: &[ObservedCampaign]) {
        let Some(account) = self
            .secrets
            .as_ref()
            .map(|secrets| secrets.account_id.clone())
        else {
            return;
        };
        let Ok(pending) = self.next_submissions(&account) else {
            return;
        };
        for pending in pending {
            if self.remote.receive_interrupted()
                || self.snapshot.connection.state != ConnectionState::Connected
                || self
                    .secrets
                    .as_ref()
                    .is_none_or(|secrets| secrets.account_id != account)
            {
                break;
            }
            // A rotating cursor prevents an unresolved early request from starving
            // other Campaigns, while each reconciliation performs bounded work.
            let _ = self.store.set(
                &format!("submission-recovery-cursor:{account}"),
                &pending.row.to_string(),
            );
            if pending.state == "planned" || (pending.state == "prepared" && pending.automatic) {
                self.abandon_submission(&account, &pending.operation);
                continue;
            }
            let Ok(submission) = serde_json::from_str::<TurnSubmission>(&pending.payload) else {
                continue;
            };
            if submission.campaign_id != pending.campaign
                || submission.operation_key != pending.operation
            {
                continue;
            }
            let fresh_authorization = observations.iter().any(|campaign| {
                campaign.id == submission.campaign_id
                    && campaign.can_submit
                    && campaign.baseline == submission.baseline
            });
            if pending.state == "prepared" {
                if !fresh_authorization {
                    self.abandon_submission(&account, &submission.operation_key);
                    continue;
                }
                // The user can still change or remove an undispatched candidate.
                // That withdraws authorization rather than silently sending a stage.
                match self.recovery_bytes(&submission, &pending.stage, true).await {
                    Ok(bytes) if !self.campaign_effects_blocked(&submission.campaign_id) => {
                        self.dispatch_submission(&account, &submission, bytes).await
                    }
                    Err(_) => self.abandon_submission(&account, &submission.operation_key),
                    _ => {}
                }
                continue;
            }
            // Receipt lookup is read-only and account-scoped. It must continue
            // despite pause, missing local folders, or lost Campaign membership.
            let Some(secrets) = &self.secrets else {
                break;
            };
            let mut receipt = self
                .remote
                .receipt(&secrets.access_token, &submission.operation_key)
                .await;
            if receipt == Err(ReceiveError::Unauthorized) {
                if let Ok(access) = self.refresh_receive_access().await {
                    receipt = self
                        .remote
                        .receipt(&access, &submission.operation_key)
                        .await;
                }
            }
            match receipt {
                Ok(Some(receipt)) => {
                    let _ = self.accept_receipt(&account, &submission, &receipt);
                }
                Ok(None)
                    if fresh_authorization
                        && !self.campaign_effects_blocked(&submission.campaign_id) =>
                {
                    // Once dispatched, only staged bytes and the existing key can
                    // be retried. Later changes to the live save are separate work.
                    if let Ok(bytes) = self
                        .recovery_bytes(&submission, &pending.stage, false)
                        .await
                    {
                        if !self.campaign_effects_blocked(&submission.campaign_id) {
                            self.dispatch_submission(&account, &submission, bytes).await;
                        }
                    }
                }
                Err(error) => self.receive_connection_error(&error).await,
                _ => {}
            }
        }
        self.cleanup_submissions(&account).await;
    }

    async fn recovery_bytes(
        &mut self,
        submission: &TurnSubmission,
        stage: &str,
        check_live: bool,
    ) -> Result<Vec<u8>, ReceiveError> {
        let expected = format!(".shadow-cloud-send-{}", submission.operation_key);
        if Path::new(stage).file_name().and_then(|name| name.to_str()) != Some(expected.as_str()) {
            return Err(ReceiveError::FileSystem);
        }
        let root = PathBuf::from(
            self.snapshot
                .root_path
                .as_ref()
                .ok_or(ReceiveError::FileSystem)?,
        );
        let campaign = submission.campaign_id.clone();
        let folder = tokio::task::spawn_blocking(move || recover_folder(&root, &campaign))
            .await
            .map_err(|_| ReceiveError::FileSystem)??;
        if check_live {
            let (live, _, hash) = read_owned_save(
                folder.clone(),
                submission.campaign_id.clone(),
                submission.filename.clone(),
            )
            .await?;
            if hash != submission.content_hash || live.len() as u64 != submission.size {
                return Err(ReceiveError::FileSystem);
            }
        }
        let (bytes, _, hash) =
            read_owned_save(folder, submission.campaign_id.clone(), expected).await?;
        if hash != submission.content_hash || bytes.len() as u64 != submission.size {
            return Err(ReceiveError::FileSystem);
        }
        Ok(bytes)
    }

    async fn cleanup_submissions(&mut self, account: &str) {
        let Some(root) = self.snapshot.root_path.as_ref().map(PathBuf::from) else {
            return;
        };
        let cursor_key = format!("submission-cleanup-cursor:{account}");
        let cursor = self
            .store
            .get(&cursor_key)
            .ok()
            .flatten()
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(0);
        let rows = (|| -> Result<Vec<(i64, String, String, String, String)>, rusqlite::Error> {
            let mut query = self.store.connection.prepare("SELECT rowid,campaign,operation,stage,submission FROM turn_submissions WHERE account=?1 AND state IN ('accepted','rejected','abandoned') AND stage<>'' AND rowid>?2 ORDER BY rowid LIMIT 100")?;
            let mut read = |cursor| {
                query
                    .query_map(params![account, cursor], |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                        ))
                    })?
                    .collect::<Result<Vec<_>, _>>()
            };
            let rows = read(cursor)?;
            if rows.is_empty() && cursor != 0 {
                read(0)
            } else {
                Ok(rows)
            }
        })();
        let Ok(rows) = rows else {
            return;
        };
        for (row, campaign, operation, stage, payload) in rows {
            if self.remote.receive_interrupted() {
                break;
            }
            let _ = self.store.set(&cursor_key, &row.to_string());
            if self.campaign_effects_blocked(&campaign) {
                continue;
            }
            let Ok(submission) = serde_json::from_str::<TurnSubmission>(&payload) else {
                continue;
            };
            if submission.operation_key != operation || submission.campaign_id != campaign {
                continue;
            }
            let expected = format!(".shadow-cloud-send-{operation}");
            if Path::new(&stage).file_name().and_then(|name| name.to_str())
                != Some(expected.as_str())
            {
                continue;
            }
            let root = root.clone();
            let remote = self.remote.clone();
            let removed = tokio::task::spawn_blocking(move || -> Result<(), ReceiveError> {
                let folder = recover_folder(&root, &campaign)?;
                check_owned_folder(&folder, &campaign)?;
                let stage = folder.join(expected);
                if remote.receive_interrupted() {
                    return Err(ReceiveError::Interrupted);
                }
                match fs::symlink_metadata(&stage) {
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                    Err(error) => return Err(error.into()),
                    Ok(_) if !regular_file(&stage) => return Err(ReceiveError::FileSystem),
                    _ => {}
                }
                // A reused staging pathname alone does not prove the bytes are
                // ours. Preserve altered or partial copies for explicit diagnosis.
                let file = fs::File::open(&stage)?;
                let before = file.metadata()?;
                if before.len() != submission.size || before.len() > 25 * 1024 * 1024 {
                    return Err(ReceiveError::FileSystem);
                }
                let mut bytes = Vec::new();
                file.take(25 * 1024 * 1024 + 1).read_to_end(&mut bytes)?;
                let after = fs::symlink_metadata(&stage)?;
                if !after.is_file()
                    || after.file_type().is_symlink()
                    || before.len() != after.len()
                    || before.modified()? != after.modified()?
                    || content_hash(&bytes) != submission.content_hash
                {
                    return Err(ReceiveError::FileSystem);
                }
                check_owned_folder(&folder, &campaign)?;
                if remote.receive_interrupted() {
                    return Err(ReceiveError::Interrupted);
                }
                fs::remove_file(stage)?;
                Ok(())
            })
            .await;
            if matches!(removed, Ok(Ok(()))) {
                let _ = self.store.connection.execute("UPDATE turn_submissions SET stage='' WHERE account=?1 AND operation=?2 AND state IN ('accepted','rejected','abandoned')", params![account,operation]);
            }
        }
    }
}
