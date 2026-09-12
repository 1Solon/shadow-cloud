//! Native shell state; window, tray and login entries remain outside the webview.
use shadow_cloud_companion_engine::{
    Command, ConnectionState, DesktopCapabilities, Snapshot, SyncStatus,
};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIcon,
    Manager,
};

pub(crate) enum Action {
    Open,
    PauseAll,
    Quit,
}
type Dispatch = Arc<dyn Fn(Action) + Send + Sync>;

pub(crate) struct Desktop {
    app: tauri::AppHandle,
    tray: Option<TrayIcon>,
    status: Option<MenuItem<tauri::Wry>>,
    actions: Option<MenuItem<tauri::Wry>>,
    pause: Option<MenuItem<tauri::Wry>>,
    available: AtomicBool,
    #[cfg(target_os = "linux")]
    autostart: Result<linux::Autostart, ()>,
    #[cfg(target_os = "windows")]
    autostart: Result<windows::Autostart, ()>,
    #[cfg(target_os = "macos")]
    autostart: Result<macos::Autostart, ()>,
    #[cfg(target_os = "linux")]
    monitor: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    last_projection: Mutex<Option<(String, usize, bool)>>,
}

impl Desktop {
    pub(crate) fn new(app: tauri::AppHandle, dispatch: Dispatch) -> Arc<Self> {
        let native = Self::build_tray(&app, dispatch).ok();
        let (tray, status, actions, pause) = match native {
            Some((tray, status, actions, pause)) => {
                (Some(tray), Some(status), Some(actions), Some(pause))
            }
            None => (None, None, None, None),
        };
        let available = tray.is_some() && !cfg!(target_os = "linux");
        Arc::new(Self {
            #[cfg(target_os = "linux")]
            autostart: linux::Autostart::for_app(&app),
            #[cfg(target_os = "windows")]
            autostart: windows::Autostart::for_app(),
            #[cfg(target_os = "macos")]
            autostart: macos::Autostart::for_app(&app),
            app,
            tray,
            status,
            actions,
            pause,
            available: AtomicBool::new(available),
            #[cfg(target_os = "linux")]
            monitor: Mutex::new(None),
            last_projection: Mutex::new(None),
        })
    }

    fn build_tray(
        app: &tauri::AppHandle,
        dispatch: Dispatch,
    ) -> tauri::Result<(
        TrayIcon,
        MenuItem<tauri::Wry>,
        MenuItem<tauri::Wry>,
        MenuItem<tauri::Wry>,
    )> {
        let status = MenuItem::with_id(
            app,
            "companion-status",
            "Checking connection",
            false,
            None::<&str>,
        )?;
        let actions = MenuItem::with_id(
            app,
            "companion-action-count",
            "0 Campaigns need action",
            false,
            None::<&str>,
        )?;
        let open = MenuItem::with_id(app, "companion-open", "Open Companion", true, None::<&str>)?;
        let pause = MenuItem::with_id(app, "companion-pause", "Pause all", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "companion-quit", "Quit", true, None::<&str>)?;
        let separator = PredefinedMenuItem::separator(app)?;
        let menu = Menu::with_items(app, &[&status, &actions, &separator, &open, &pause, &quit])?;
        let click = dispatch.clone();
        let mut builder = tauri::tray::TrayIconBuilder::with_id("companion")
            .tooltip("Shadow Cloud Companion")
            .menu(&menu)
            .show_menu_on_left_click(true)
            .on_menu_event(move |_, event| match event.id.as_ref() {
                "companion-open" => dispatch(Action::Open),
                "companion-pause" => dispatch(Action::PauseAll),
                "companion-quit" => dispatch(Action::Quit),
                _ => {}
            })
            .on_tray_icon_event(move |_, event| {
                if matches!(event, tauri::tray::TrayIconEvent::DoubleClick { .. }) {
                    click(Action::Open);
                }
            });
        if let Some(icon) = app.default_window_icon() {
            builder = builder.icon(icon.clone());
        }
        let tray = builder.build(app)?;
        Ok((tray, status, actions, pause))
    }

    pub(crate) fn start_monitor(self: &Arc<Self>, changed: Arc<dyn Fn() + Send + Sync>) {
        #[cfg(target_os = "linux")]
        {
            if self.tray.is_none() {
                return;
            }
            let desktop = Arc::downgrade(self);
            let callback: Arc<dyn Fn(bool) + Send + Sync> = Arc::new(move |available| {
                if let Some(desktop) = desktop.upgrade() {
                    let previous = desktop.available.swap(available, Ordering::SeqCst);
                    if previous != available {
                        if !available
                            && desktop
                                .app
                                .get_webview_window("main")
                                .is_some_and(|window| {
                                    window.is_visible().is_ok_and(|visible| !visible)
                                })
                        {
                            desktop.show_main();
                        }
                        changed();
                    }
                }
            });
            *self.monitor.lock().unwrap() = Some(linux::monitor(callback));
        }
        #[cfg(not(target_os = "linux"))]
        changed();
    }

    pub(crate) fn capabilities(&self) -> DesktopCapabilities {
        DesktopCapabilities {
            tray_available: self.available.load(Ordering::SeqCst),
            start_at_login_available: self.start_at_login_enabled().is_ok(),
        }
    }
    pub(crate) fn start_at_login_enabled(&self) -> Result<bool, ()> {
        self.autostart.as_ref().map_err(|_| ())?.is_enabled()
    }
    pub(crate) fn set_start_at_login(&self, enabled: bool) -> Result<(), ()> {
        self.autostart
            .as_ref()
            .map_err(|_| ())?
            .set_enabled(enabled)
    }
    pub(crate) fn show_main(&self) {
        show_main(&self.app);
    }
    pub(crate) fn close_to_tray(&self, keep_running: bool) -> bool {
        if !keep_running || !self.available.load(Ordering::SeqCst) {
            return false;
        }
        self.app
            .get_webview_window("main")
            .is_some_and(|window| window.hide().is_ok())
    }
    pub(crate) fn update(&self, snapshot: &Snapshot) {
        let count = snapshot
            .campaigns
            .iter()
            .filter(|campaign| {
                matches!(
                    campaign.sync_status,
                    SyncStatus::Conflict | SyncStatus::NeedsAttention
                ) || campaign
                    .candidates
                    .iter()
                    .any(|candidate| candidate.can_send)
            })
            .count();
        let status = if snapshot.paused {
            "Paused"
        } else {
            match snapshot.connection.state {
                ConnectionState::Checking => "Checking connection",
                ConnectionState::Offline => "Offline",
                ConnectionState::UpdateRequired => "Update required",
                ConnectionState::Connected if count > 0 => "Needs attention",
                ConnectionState::Connected => "Connected",
            }
        }
        .to_owned();
        let projection = (status.clone(), count, snapshot.paused);
        let mut previous = self.last_projection.lock().unwrap();
        if previous.as_ref() == Some(&projection) {
            return;
        }
        *previous = Some(projection);
        if let Some(item) = &self.status {
            let _ = item.set_text(&status);
        }
        if let Some(item) = &self.actions {
            let _ = item.set_text(if count == 1 {
                "1 Campaign needs action".into()
            } else {
                format!("{count} Campaigns need action")
            });
        }
        if let Some(item) = &self.pause {
            let _ = item.set_text(if snapshot.paused {
                "Resume all"
            } else {
                "Pause all"
            });
        }
        if let Some(tray) = &self.tray {
            let _ = tray.set_tooltip(Some(format!("Shadow Cloud Companion — {status}")));
        }
    }
}
#[cfg(target_os = "linux")]
impl Drop for Desktop {
    fn drop(&mut self) {
        if let Some(monitor) = self.monitor.get_mut().unwrap().take() {
            monitor.abort();
        }
    }
}
pub(crate) fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
pub(crate) fn pause_command(snapshot: &Snapshot) -> Command {
    Command::SetPaused {
        paused: !snapshot.paused,
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use plist::{Dictionary, Value};
    use std::{
        fs::{self, OpenOptions},
        io::{ErrorKind, Read},
        os::unix::fs::OpenOptionsExt,
        path::{Path, PathBuf},
    };
    use tauri::Manager;

    pub(super) struct Autostart {
        entry: PathBuf,
        label: String,
        executable: String,
    }
    impl Autostart {
        pub(super) fn for_app(app: &tauri::AppHandle) -> Result<Self, ()> {
            Self::new(
                &app.path()
                    .home_dir()
                    .map_err(|_| ())?
                    .join("Library/LaunchAgents"),
                if tauri::is_dev() {
                    "com.shadowcloud.companion.development"
                } else {
                    "com.shadowcloud.companion"
                },
                &std::env::current_exe().map_err(|_| ())?,
            )
        }
        fn new(directory: &Path, label: &str, executable: &Path) -> Result<Self, ()> {
            let path = executable.to_str().ok_or(())?;
            if !directory.is_absolute()
                || !executable.is_absolute()
                || !executable.is_file()
                || path.chars().any(char::is_control)
            {
                return Err(());
            }
            Ok(Self {
                entry: directory.join(format!("{label}.plist")),
                label: label.into(),
                executable: path.into(),
            })
        }
        fn owned(&self) -> Result<Option<Dictionary>, ()> {
            match fs::symlink_metadata(&self.entry) {
                Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
                Ok(meta)
                    if meta.is_file()
                        && !meta.file_type().is_symlink()
                        && meta.len() <= 64 * 1024 => {}
                _ => return Err(()),
            }
            let mut bytes = Vec::new();
            fs::File::open(&self.entry)
                .map_err(|_| ())?
                .take(64 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| ())?;
            if bytes.len() > 64 * 1024 {
                return Err(());
            }
            let value = Value::from_reader(std::io::Cursor::new(bytes)).map_err(|_| ())?;
            let dictionary = value.into_dictionary().ok_or(())?;
            if dictionary.get("Label").and_then(Value::as_string) != Some(&self.label)
                || dictionary
                    .get("ShadowCloudCompanion")
                    .and_then(Value::as_boolean)
                    != Some(true)
            {
                return Err(());
            }
            Ok(Some(dictionary))
        }
        pub(super) fn is_enabled(&self) -> Result<bool, ()> {
            let Some(value) = self.owned()? else {
                return Ok(false);
            };
            // This checks the login registration, not whether launchd currently
            // runs this process or an external launchctl override disables it.
            Ok(
                value.get("RunAtLoad").and_then(Value::as_boolean) == Some(true)
                    && value.get("Disabled").and_then(Value::as_boolean) != Some(true)
                    && value
                        .get("ProgramArguments")
                        .and_then(Value::as_array)
                        .is_some_and(|args| {
                            args.len() == 1 && args[0].as_string() == Some(&self.executable)
                        }),
            )
        }
        pub(super) fn set_enabled(&self, enabled: bool) -> Result<(), ()> {
            let existing = self.owned()?.is_some();
            if !enabled {
                if existing {
                    fs::remove_file(&self.entry).map_err(|_| ())?;
                }
                return Ok(());
            }
            let directory = self.entry.parent().ok_or(())?;
            fs::create_dir_all(directory).map_err(|_| ())?;
            let mut dictionary = Dictionary::new();
            dictionary.insert("Label".into(), Value::String(self.label.clone()));
            dictionary.insert("ShadowCloudCompanion".into(), Value::Boolean(true));
            dictionary.insert("RunAtLoad".into(), Value::Boolean(true));
            dictionary.insert(
                "ProgramArguments".into(),
                Value::Array(vec![Value::String(self.executable.clone())]),
            );
            let mut nonce = [0u8; 12];
            getrandom::fill(&mut nonce).map_err(|_| ())?;
            let temp = directory.join(format!(
                ".{}.{}.tmp",
                self.label,
                nonce
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>()
            ));
            struct Temp(PathBuf);
            impl Drop for Temp {
                fn drop(&mut self) {
                    let _ = fs::remove_file(&self.0);
                }
            }
            let _cleanup = Temp(temp.clone());
            let file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&temp)
                .map_err(|_| ())?;
            Value::Dictionary(dictionary)
                .to_writer_xml(&file)
                .map_err(|_| ())?;
            file.sync_all().map_err(|_| ())?;
            self.owned()?;
            fs::rename(temp, &self.entry).map_err(|_| ())
        }
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn native_launch_agent_roundtrip_escapes_paths_and_preserves_unowned_files() {
            let directory = tempfile::tempdir().unwrap();
            let executable = directory.path().join("Companion & native test");
            fs::write(&executable, b"inert launch agent fixture").unwrap();
            let mut nonce = [0u8; 12];
            getrandom::fill(&mut nonce).unwrap();
            let label = format!(
                "com.shadowcloud.companion.native-test.{}",
                nonce
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>()
            );
            let home = PathBuf::from(objc2_foundation::NSHomeDirectory().to_string());
            let autostart =
                Autostart::new(&home.join("Library/LaunchAgents"), &label, &executable).unwrap();
            assert!(!autostart.entry.exists());
            struct Entry(PathBuf);
            impl Drop for Entry {
                fn drop(&mut self) {
                    let _ = fs::remove_file(&self.0);
                }
            }
            let _cleanup = Entry(autostart.entry.clone());
            assert!(!autostart.is_enabled().unwrap());
            autostart.set_enabled(true).unwrap();
            assert!(autostart.is_enabled().unwrap());
            let result = std::process::Command::new("/usr/bin/plutil")
                .args(["-convert", "json", "-o", "-"])
                .arg(&autostart.entry)
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "native plist parser must accept ampersands in paths"
            );
            let value: serde_json::Value = serde_json::from_slice(&result.stdout).unwrap();
            assert_eq!(value["Label"], label);
            assert_eq!(
                value["ProgramArguments"],
                serde_json::json!([executable.to_str().unwrap()])
            );
            assert_eq!(value["RunAtLoad"], true);
            fs::write(&autostart.entry, b"unrelated user's file").unwrap();
            assert!(autostart.set_enabled(true).is_err());
            assert!(autostart.set_enabled(false).is_err());
            assert_eq!(
                fs::read(&autostart.entry).unwrap(),
                b"unrelated user's file"
            );
            fs::remove_file(&autostart.entry).unwrap();
            std::os::unix::fs::symlink(&executable, &autostart.entry).unwrap();
            assert!(autostart.set_enabled(true).is_err());
            assert!(autostart.set_enabled(false).is_err());
            assert_eq!(
                fs::read(&executable).unwrap(),
                b"inert launch agent fixture"
            );
            fs::remove_file(&autostart.entry).unwrap();
            autostart.set_enabled(true).unwrap();
            autostart.set_enabled(false).unwrap();
            assert!(!autostart.is_enabled().unwrap());
            assert!(!autostart.entry.exists());
        }
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use std::{io::ErrorKind, path::Path};
    use winreg::{
        enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE, REG_BINARY},
        RegKey,
    };

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const APPROVED: &str =
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

    pub(super) struct Autostart {
        name: String,
        command: String,
    }
    impl Autostart {
        pub(super) fn for_app() -> Result<Self, ()> {
            Self::new(
                if tauri::is_dev() {
                    "com.shadowcloud.companion.development"
                } else {
                    "com.shadowcloud.companion"
                },
                &std::env::current_exe().map_err(|_| ())?,
            )
        }
        fn new(name: &str, executable: &Path) -> Result<Self, ()> {
            let path = executable.to_str().ok_or(())?;
            if !executable.is_absolute()
                || !executable.is_file()
                || path.chars().any(|c| c.is_control() || c == '"')
            {
                return Err(());
            }
            // Run stores a command line, not an executable path. Windows otherwise
            // interprets spaces in Program Files as an ambiguous executable name.
            let command = format!("\"{path}\"");
            if command.encode_utf16().count() > 260 {
                return Err(());
            }
            Ok(Self {
                name: name.into(),
                command,
            })
        }
        fn registration(&self) -> Result<Option<RegKey>, ()> {
            let key = match RegKey::predef(HKEY_CURRENT_USER).open_subkey(RUN) {
                Ok(key) => key,
                Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
                Err(_) => return Err(()),
            };
            match key.get_value::<String, _>(&self.name) {
                Ok(command) if command == self.command => Ok(Some(key)),
                Ok(_) => Err(()), // Never replace or remove another registration.
                Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
                Err(_) => Err(()),
            }
        }
        fn approval(&self) -> Result<Option<bool>, ()> {
            let key = match RegKey::predef(HKEY_CURRENT_USER).open_subkey(APPROVED) {
                Ok(key) => key,
                Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
                Err(_) => return Err(()),
            };
            match key.get_raw_value(&self.name) {
                Ok(value) if value.vtype == REG_BINARY && value.bytes.len() == 12 => {
                    // The pinned native backend recognizes the same Task Manager
                    // state. Unknown encodings fail closed instead of reporting on.
                    let state = u32::from_le_bytes(value.bytes[..4].try_into().map_err(|_| ())?);
                    match state {
                        2 | 6 if value.bytes[4..].iter().all(|byte| *byte == 0) => Ok(Some(true)),
                        3 | 7 => Ok(Some(false)),
                        _ => Err(()),
                    }
                }
                Ok(_) => Err(()),
                Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
                Err(_) => Err(()),
            }
        }
        pub(super) fn is_enabled(&self) -> Result<bool, ()> {
            if self.registration()?.is_none() {
                return Ok(false);
            }
            Ok(self.approval()?.unwrap_or(true))
        }
        pub(super) fn set_enabled(&self, enabled: bool) -> Result<(), ()> {
            let owned = self.registration()?.is_some();
            let approval = self.approval()?;
            if !owned && approval.is_some() {
                return if enabled { Err(()) } else { Ok(()) };
            }
            if enabled {
                let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
                    .create_subkey(RUN)
                    .map_err(|_| ())?;
                key.set_value(&self.name, &self.command).map_err(|_| ())?;
            }
            if !enabled && owned {
                // Remove the launch command before clearing its disabled override:
                // a denied Run write must never turn a disabled application on.
                RegKey::predef(HKEY_CURRENT_USER)
                    .open_subkey_with_flags(RUN, KEY_READ | KEY_SET_VALUE)
                    .map_err(|_| ())?
                    .delete_value(&self.name)
                    .map_err(|_| ())?;
            }
            // An explicit toggle may reset our own Task Manager override. Never
            // touch a same-named override unless the exact Run command is ours.
            if owned && approval.is_some() {
                RegKey::predef(HKEY_CURRENT_USER)
                    .open_subkey_with_flags(APPROVED, KEY_READ | KEY_SET_VALUE)
                    .map_err(|_| ())?
                    .delete_value(&self.name)
                    .map_err(|_| ())?;
            }
            Ok(())
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use ::windows::{
            core::PCWSTR,
            Win32::{
                Foundation::{LocalFree, HLOCAL},
                UI::Shell::CommandLineToArgvW,
            },
        };
        use winreg::RegValue;

        struct Entry(String);
        impl Drop for Entry {
            fn drop(&mut self) {
                for path in [RUN, APPROVED] {
                    if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER)
                        .open_subkey_with_flags(path, KEY_SET_VALUE)
                    {
                        let _ = key.delete_value(&self.0);
                    }
                }
            }
        }
        #[test]
        fn native_run_registration_quotes_spaces_honors_disabled_state_and_preserves_unowned_entries(
        ) {
            let mut nonce = [0u8; 12];
            getrandom::fill(&mut nonce).unwrap();
            let name = format!(
                "com.shadowcloud.companion.native-test.{}",
                nonce
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>()
            );
            let directory = tempfile::tempdir().unwrap();
            let executable = directory.path().join("Companion native test.exe");
            std::fs::write(&executable, b"inert native autostart test fixture").unwrap();
            let autostart = Autostart::new(&name, &executable).unwrap();
            let _cleanup = Entry(name.clone());
            assert!(!autostart.is_enabled().unwrap());
            autostart.set_enabled(true).unwrap();
            let key = RegKey::predef(HKEY_CURRENT_USER)
                .open_subkey_with_flags(RUN, KEY_READ | KEY_SET_VALUE)
                .unwrap();
            let command: String = key.get_value(&name).unwrap();
            let wide: Vec<u16> = command.encode_utf16().chain(Some(0)).collect();
            let mut count = 0;
            // SAFETY: null-terminated input and live output count; the returned
            // contiguous Windows allocation is released after reading argv[0].
            unsafe {
                let arguments = CommandLineToArgvW(PCWSTR(wide.as_ptr()), &mut count);
                assert!(!arguments.is_null());
                assert_eq!(count, 1);
                let parsed = (*arguments).to_string().unwrap();
                let _ = LocalFree(Some(HLOCAL(arguments.cast())));
                assert_eq!(parsed, executable.to_str().unwrap());
            }
            assert!(autostart.is_enabled().unwrap());
            let (approval, _) = RegKey::predef(HKEY_CURRENT_USER)
                .create_subkey(APPROVED)
                .unwrap();
            approval
                .set_raw_value(
                    &name,
                    &RegValue {
                        vtype: REG_BINARY,
                        bytes: vec![3, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
                    },
                )
                .unwrap();
            assert!(!autostart.is_enabled().unwrap());
            autostart.set_enabled(true).unwrap();
            assert!(autostart.is_enabled().unwrap());
            assert!(approval.get_raw_value(&name).is_err());
            key.set_value(&name, &"unrelated.exe").unwrap();
            assert!(autostart.is_enabled().is_err());
            assert!(autostart.set_enabled(true).is_err());
            assert!(autostart.set_enabled(false).is_err());
            assert_eq!(key.get_value::<String, _>(&name).unwrap(), "unrelated.exe");
            key.set_value(&name, &command).unwrap();
            autostart.set_enabled(false).unwrap();
            assert!(!autostart.is_enabled().unwrap());
            assert!(key.get_raw_value(&name).is_err());
        }
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use futures_util::StreamExt;
    use std::{
        fs,
        io::Write,
        path::{Path, PathBuf},
        time::Duration,
    };
    const MARKER: &str = "X-ShadowCloud-Companion=true";
    pub(super) struct Autostart {
        directory: PathBuf,
        entry: PathBuf,
        executable: PathBuf,
    }
    impl Autostart {
        pub(super) fn for_app(app: &tauri::AppHandle) -> Result<Self, ()> {
            let config = std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .filter(|path| path.is_absolute())
                .unwrap_or(app.path().home_dir().map_err(|_| ())?.join(".config"));
            let executable = app
                .env()
                .appimage
                .map(PathBuf::from)
                .unwrap_or(std::env::current_exe().map_err(|_| ())?);
            let name = if tauri::is_dev() {
                "com.shadowcloud.companion.development.desktop"
            } else {
                "com.shadowcloud.companion.desktop"
            };
            Ok(Self::new(config, executable, name))
        }
        fn new(config: PathBuf, executable: PathBuf, name: &str) -> Self {
            let directory = config.join("autostart");
            Self {
                entry: directory.join(name),
                directory,
                executable,
            }
        }
        fn owned_entry(&self) -> Result<Option<String>, ()> {
            let metadata = match fs::symlink_metadata(&self.entry) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                Err(_) => return Err(()),
            };
            if !metadata.is_file()
                || metadata.file_type().is_symlink()
                || metadata.len() > 16 * 1024
            {
                return Err(());
            }
            let entry = fs::read_to_string(&self.entry).map_err(|_| ())?;
            if !entry.lines().any(|line| line == MARKER) {
                return Err(());
            }
            Ok(Some(entry))
        }
        pub(super) fn is_enabled(&self) -> Result<bool, ()> {
            Ok(self
                .owned_entry()?
                .is_some_and(|entry| !entry.lines().any(|line| line == "Hidden=true")))
        }
        pub(super) fn set_enabled(&self, enabled: bool) -> Result<(), ()> {
            let exists = self.owned_entry()?.is_some();
            if !enabled {
                if exists {
                    fs::remove_file(&self.entry).map_err(|_| ())?;
                }
                return Ok(());
            }
            let executable = desktop_exec(&self.executable)?;
            let contents = format!("[Desktop Entry]\nType=Application\nVersion=1.0\nName=Shadow Cloud Companion\nComment=Receive and send Campaign saves\nExec={executable}\nTerminal=false\nStartupNotify=false\n{MARKER}\n");
            fs::create_dir_all(&self.directory).map_err(|_| ())?;
            let mut nonce = [0u8; 12];
            getrandom::fill(&mut nonce).map_err(|_| ())?;
            let temporary = self.directory.join(format!(
                ".shadow-cloud-autostart-{}",
                nonce
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>()
            ));
            let result = (|| {
                use std::os::unix::fs::OpenOptionsExt;
                let mut file = fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .mode(0o600)
                    .open(&temporary)
                    .map_err(|_| ())?;
                file.write_all(contents.as_bytes()).map_err(|_| ())?;
                file.sync_all().map_err(|_| ())?;
                // Recheck ownership immediately before replacing our own entry.
                if self.owned_entry()?.is_some() != exists {
                    return Err(());
                }
                fs::rename(&temporary, &self.entry).map_err(|_| ())?;
                Ok(())
            })();
            let _ = fs::remove_file(temporary);
            result
        }
    }
    fn desktop_exec(path: &Path) -> Result<String, ()> {
        let path = path.to_str().ok_or(())?;
        if path.chars().any(char::is_control) {
            return Err(());
        }
        let mut escaped = String::from("\"");
        for character in path.chars() {
            match character {
                '%' => escaped.push_str("%%"),
                '\\' => escaped.push_str("\\\\\\\\"),
                '"' | '$' | '`' => {
                    escaped.push_str("\\\\");
                    escaped.push(character);
                }
                _ => escaped.push(character),
            }
        }
        escaped.push('"');
        Ok(escaped)
    }

    pub(super) fn monitor(
        changed: Arc<dyn Fn(bool) + Send + Sync>,
    ) -> tauri::async_runtime::JoinHandle<()> {
        tauri::async_runtime::spawn(async move {
            loop {
                if let Ok(connection) = zbus::Connection::session().await {
                    let _ = observe_host(connection, changed.clone()).await;
                }
                changed(false);
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        })
    }
    async fn observe_host(
        connection: zbus::Connection,
        changed: Arc<dyn Fn(bool) + Send + Sync>,
    ) -> Result<(), ()> {
        let proxy: zbus::Proxy<'_> = zbus::proxy::Builder::new(&connection)
            .destination("org.kde.StatusNotifierWatcher")
            .map_err(|_| ())?
            .path("/StatusNotifierWatcher")
            .map_err(|_| ())?
            .interface("org.kde.StatusNotifierWatcher")
            .map_err(|_| ())?
            .cache_properties(zbus::proxy::CacheProperties::No)
            .build()
            .await
            .map_err(|_| ())?;
        let mut owners = proxy.receive_owner_changed().await.map_err(|_| ())?;
        let mut signals = proxy.receive_all_signals().await.map_err(|_| ())?;
        loop {
            let ready = tokio::time::timeout(
                Duration::from_secs(1),
                proxy.get_property::<bool>("IsStatusNotifierHostRegistered"),
            )
            .await
            .map_err(|_| ())?
            .map_err(|_| ())?;
            changed(ready);
            tokio::select! {
                biased;
                _ = owners.next() => { changed(false); return Err(()); },
                signal = signals.next() => if signal.is_none() { changed(false); return Err(()); },
                _ = tokio::time::sleep(Duration::from_secs(2)) => {},
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn linux_autostart_is_opt_in_isolated_and_quotes_the_appimage_path() {
            let temp = tempfile::tempdir().unwrap();
            let app = temp.path().join("My Companion 100%.AppImage");
            let autostart =
                Autostart::new(temp.path().join("config"), app.clone(), "companion.desktop");
            assert!(!autostart.is_enabled().unwrap());
            assert!(!autostart.directory.exists());
            autostart.set_enabled(true).unwrap();
            assert!(autostart.is_enabled().unwrap());
            let entry = fs::read_to_string(&autostart.entry).unwrap();
            assert!(entry.contains(&format!(
                "Exec=\"{}\"",
                app.display().to_string().replace('%', "%%")
            )));
            autostart.set_enabled(false).unwrap();
            assert!(!autostart.is_enabled().unwrap());
        }
        #[test]
        fn linux_autostart_never_replaces_or_removes_an_unowned_entry_or_symlink() {
            let temp = tempfile::tempdir().unwrap();
            let autostart = Autostart::new(
                temp.path().to_owned(),
                PathBuf::from("/synthetic/companion"),
                "companion.desktop",
            );
            fs::create_dir(&autostart.directory).unwrap();
            fs::write(&autostart.entry, b"another application").unwrap();
            for enabled in [true, false] {
                assert!(autostart.set_enabled(enabled).is_err());
            }
            assert_eq!(fs::read(&autostart.entry).unwrap(), b"another application");
            fs::remove_file(&autostart.entry).unwrap();
            let target = temp.path().join("outside");
            fs::write(&target, MARKER).unwrap();
            std::os::unix::fs::symlink(&target, &autostart.entry).unwrap();
            for enabled in [true, false] {
                assert!(autostart.set_enabled(enabled).is_err());
            }
            assert_eq!(fs::read_to_string(target).unwrap(), MARKER);
        }

        struct Watcher(Arc<AtomicBool>);
        #[zbus::interface(name = "org.kde.StatusNotifierWatcher")]
        impl Watcher {
            #[zbus(property)]
            fn is_status_notifier_host_registered(&self) -> bool {
                self.0.load(Ordering::SeqCst)
            }
        }
        #[tokio::test]
        async fn native_tray_host_signals_and_owner_loss_update_close_to_tray_availability() {
            let bus = crate::native_tests::PrivateBus::new();
            let host = Arc::new(AtomicBool::new(true));
            let server = zbus::connection::Builder::address(bus.address.as_str())
                .unwrap()
                .name("org.kde.StatusNotifierWatcher")
                .unwrap()
                .serve_at("/StatusNotifierWatcher", Watcher(host.clone()))
                .unwrap()
                .build()
                .await
                .unwrap();
            let client = zbus::connection::Builder::address(bus.address.as_str())
                .unwrap()
                .build()
                .await
                .unwrap();
            let (events, mut received) = tokio::sync::mpsc::unbounded_channel();
            let callback: Arc<dyn Fn(bool) + Send + Sync> = Arc::new(move |ready| {
                let _ = events.send(ready);
            });
            let observer = tokio::spawn(observe_host(client, callback));
            assert_eq!(
                tokio::time::timeout(Duration::from_secs(1), received.recv())
                    .await
                    .unwrap(),
                Some(true)
            );
            for ready in [false, true] {
                host.store(ready, Ordering::SeqCst);
                server
                    .emit_signal(
                        None::<&str>,
                        "/StatusNotifierWatcher",
                        "org.kde.StatusNotifierWatcher",
                        "StatusNotifierHostRegistered",
                        &(),
                    )
                    .await
                    .unwrap();
                assert_eq!(
                    tokio::time::timeout(Duration::from_secs(1), received.recv())
                        .await
                        .unwrap(),
                    Some(ready)
                );
            }
            server
                .release_name("org.kde.StatusNotifierWatcher")
                .await
                .unwrap();
            assert_eq!(
                tokio::time::timeout(Duration::from_secs(1), received.recv())
                    .await
                    .unwrap(),
                Some(false)
            );
            assert!(tokio::time::timeout(Duration::from_secs(1), observer)
                .await
                .unwrap()
                .unwrap()
                .is_err());
        }
    }
}
