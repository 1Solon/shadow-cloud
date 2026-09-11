//! The Companion's webview-independent snapshot/command boundary.
use serde::{Deserialize, Serialize};

pub const RELEASE: &str = env!("COMPANION_RELEASE");

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Theme {
    Dark,
    Light,
    System,
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
    pub actions: Vec<CampaignAction>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CampaignAction {
    ResolveConflict,
    CancelAutomaticSend,
    OpenFolder,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: String,
    pub campaign_name: String,
    pub description: String,
    pub occurred_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u32,
    pub app_version: String,
    pub protocol_version: String,
    pub connection: Connection,
    pub read_only: bool,
    pub paused: bool,
    pub display_name: Option<String>,
    pub root_path: Option<String>,
    pub preferences: Preferences,
    pub campaigns: Vec<Campaign>,
    pub activity: Vec<Activity>,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Command {
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

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CommandError {
    UpdateRequired,
    NotAvailable,
}

/// One coordinator owns this value. No decision is made by the webview.
pub struct Engine {
    snapshot: Snapshot,
    revisions: tokio::sync::watch::Sender<Snapshot>,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine {
    pub fn new() -> Self {
        let snapshot = Snapshot {
            revision: 0,
            app_version: RELEASE.into(),
            protocol_version: RELEASE.into(),
            connection: Connection {
                state: ConnectionState::Checking,
                reachable: false,
                server_protocol_version: None,
            },
            read_only: true,
            paused: false,
            display_name: None,
            root_path: None,
            preferences: Preferences {
                theme: Theme::System,
                automatic_uploads: true,
            },
            campaigns: vec![],
            activity: vec![],
        };
        let (revisions, _) = tokio::sync::watch::channel(snapshot.clone());
        Self {
            snapshot,
            revisions,
        }
    }

    pub fn snapshot(&self) -> Snapshot {
        self.snapshot.clone()
    }

    pub fn subscribe(&self) -> tokio::sync::watch::Receiver<Snapshot> {
        self.revisions.subscribe()
    }

    pub fn command(&mut self, command: Command) -> Result<Snapshot, CommandError> {
        let previous = self.snapshot.clone();
        match command {
            Command::SetTheme { theme } => self.snapshot.preferences.theme = theme,
            Command::SetAutomaticUploads { enabled } => {
                if enabled && self.snapshot.connection.state == ConnectionState::UpdateRequired {
                    return Err(CommandError::UpdateRequired);
                }
                self.snapshot.preferences.automatic_uploads = enabled;
            }
            Command::SetPaused { paused } => {
                if !paused && self.snapshot.connection.state == ConnectionState::UpdateRequired {
                    return Err(CommandError::UpdateRequired);
                }
                self.snapshot.paused = paused;
            }
            Command::CampaignAction { .. } => {
                return Err(
                    if self.snapshot.connection.state == ConnectionState::UpdateRequired {
                        CommandError::UpdateRequired
                    } else {
                        // Authentication, campaign observation and transfers arrive in later slices.
                        CommandError::NotAvailable
                    },
                );
            }
        }
        self.advance_if_changed(&previous);
        Ok(self.snapshot())
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
        self.snapshot.read_only = self.snapshot.connection.state != ConnectionState::Connected;
        self.advance_if_changed(&previous);
    }

    fn advance_if_changed(&mut self, previous: &Snapshot) {
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
