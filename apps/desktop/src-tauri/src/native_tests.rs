//! These tests exercise installed OS services using temporary, private state.
use super::*;

fn vault_roundtrip() {
    let mut nonce = [0u8; 12];
    getrandom::fill(&mut nonce).unwrap();
    let service = format!(
        "com.shadowcloud.companion.native-test.{}",
        nonce
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    );
    let vault = SystemVault { service };
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while vault.store("synthetic-native-vault-value").is_err() {
        assert!(
            std::time::Instant::now() < deadline,
            "native credential service unavailable"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(
        vault.load().unwrap().as_deref(),
        Some("synthetic-native-vault-value")
    );
    vault.clear().unwrap();
    assert!(vault.load().is_err());
}

#[cfg(not(target_os = "linux"))]
#[test]
fn system_vault_roundtrips_through_the_native_credential_backend() {
    vault_roundtrip();
}

#[cfg(target_os = "linux")]
pub(super) struct PrivateBus {
    pub(super) address: String,
    _directory: tempfile::TempDir,
    daemon: std::process::Child,
}
#[cfg(target_os = "linux")]
impl PrivateBus {
    pub(super) fn new() -> Self {
        use std::{
            io::BufRead,
            process::{Command, Stdio},
        };
        let directory = tempfile::tempdir().unwrap();
        let config = directory.path().join("bus.conf");
        std::fs::write(&config, b"<busconfig><type>session</type><listen>unix:tmpdir=/tmp</listen><auth>EXTERNAL</auth><policy context=\"default\"><allow send_destination=\"*\"/><allow own=\"*\"/><allow eavesdrop=\"true\"/></policy></busconfig>").unwrap();
        let mut daemon = Command::new("dbus-daemon")
            .args(["--nofork", "--print-address=1", "--config-file"])
            .arg(config)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let mut address = String::new();
        std::io::BufReader::new(daemon.stdout.take().unwrap())
            .read_line(&mut address)
            .unwrap();
        Self {
            address: address.trim().into(),
            _directory: directory,
            daemon,
        }
    }
}
#[cfg(target_os = "linux")]
impl Drop for PrivateBus {
    fn drop(&mut self) {
        let _ = self.daemon.kill();
        let _ = self.daemon.wait();
    }
}

#[cfg(target_os = "linux")]
#[test]
fn system_vault_roundtrips_through_an_isolated_gnome_secret_service() {
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    let bus = PrivateBus::new();
    let directory = tempfile::tempdir().unwrap();
    for name in ["data", "config", "runtime", "control"] {
        std::fs::create_dir(directory.path().join(name)).unwrap();
    }
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(
        directory.path().join("runtime"),
        std::fs::Permissions::from_mode(0o700),
    )
    .unwrap();
    struct SecretService(std::process::Child);
    impl Drop for SecretService {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let mut service = SecretService(
        Command::new("gnome-keyring-daemon")
            .args([
                "--foreground",
                "--unlock",
                "--components=secrets",
                "--control-directory",
            ])
            .arg(directory.path().join("control"))
            .env("DBUS_SESSION_BUS_ADDRESS", &bus.address)
            .env("XDG_DATA_HOME", directory.path().join("data"))
            .env("XDG_CONFIG_HOME", directory.path().join("config"))
            .env("XDG_RUNTIME_DIR", directory.path().join("runtime"))
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    service
        .0
        .stdin
        .take()
        .unwrap()
        .write_all(b"isolated-native-test-password\n")
        .unwrap();
    let result = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "native_tests::isolated_secret_service_child",
            "--ignored",
            "--nocapture",
        ])
        .env("DBUS_SESSION_BUS_ADDRESS", &bus.address)
        .env("SHADOW_CLOUD_NATIVE_VAULT_CHILD", "true")
        .env("XDG_DATA_HOME", directory.path().join("data"))
        .env("XDG_CONFIG_HOME", directory.path().join("config"))
        .env("XDG_RUNTIME_DIR", directory.path().join("runtime"))
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
}
#[cfg(target_os = "linux")]
#[test]
#[ignore = "only invoked by the parent test inside a private Secret Service session"]
fn isolated_secret_service_child() {
    assert_eq!(
        std::env::var("SHADOW_CLOUD_NATIVE_VAULT_CHILD").as_deref(),
        Ok("true")
    );
    // Production commands call the synchronous vault from the engine's Tokio
    // coordinator. Exercise first-use initialization in that same context.
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            tokio::spawn(async { vault_roundtrip() }).await.unwrap();
        });
    // Startup also reads the vault before entering the coordinator.
    vault_roundtrip();
}

#[cfg(target_os = "linux")]
mod tray_host {
    use super::*;
    use std::sync::{atomic::AtomicBool, Mutex};
    struct HostState {
        items: Mutex<Vec<String>>,
        available: AtomicBool,
    }
    struct Watcher(Arc<HostState>);
    #[zbus::interface(name = "org.kde.StatusNotifierWatcher")]
    impl Watcher {
        async fn register_status_notifier_item(
            &self,
            service: &str,
            #[zbus(header)] header: zbus::message::Header<'_>,
            #[zbus(signal_emitter)] emitter: zbus::object_server::SignalEmitter<'_>,
        ) -> zbus::fdo::Result<()> {
            let item = if service.starts_with('/') {
                format!(
                    "{}{service}",
                    header
                        .sender()
                        .ok_or_else(|| zbus::fdo::Error::Failed("missing sender".into()))?
                )
            } else {
                format!("{service}/StatusNotifierItem")
            };
            self.0.items.lock().unwrap().push(item.clone());
            Self::status_notifier_item_registered(&emitter, &item)
                .await
                .map_err(|error| zbus::fdo::Error::Failed(error.to_string()))
        }
        fn register_status_notifier_host(&self, _service: &str) {}
        #[zbus(property)]
        fn registered_status_notifier_items(&self) -> Vec<String> {
            self.0.items.lock().unwrap().clone()
        }
        #[zbus(property)]
        fn is_status_notifier_host_registered(&self) -> bool {
            self.0.available.load(Ordering::SeqCst)
        }
        #[zbus(property)]
        fn protocol_version(&self) -> i32 {
            0
        }
        #[zbus(signal)]
        async fn status_notifier_item_registered(
            emitter: &zbus::object_server::SignalEmitter<'_>,
            service: &str,
        ) -> zbus::Result<()>;
    }
    struct Control(Arc<HostState>);
    #[zbus::interface(name = "com.shadowcloud.NativeTrayTest")]
    impl Control {
        async fn set_host_available(
            &self,
            available: bool,
            #[zbus(signal_emitter)] emitter: zbus::object_server::SignalEmitter<'_>,
        ) -> zbus::fdo::Result<()> {
            self.0.available.store(available, Ordering::SeqCst);
            emitter
                .connection()
                .emit_signal(
                    None::<&str>,
                    "/StatusNotifierWatcher",
                    "org.kde.StatusNotifierWatcher",
                    if available {
                        "StatusNotifierHostRegistered"
                    } else {
                        "StatusNotifierHostUnregistered"
                    },
                    &(),
                )
                .await
                .map_err(|error| zbus::fdo::Error::Failed(error.to_string()))
        }
    }

    #[tokio::test]
    #[ignore = "explicit helper process for an isolated native WebDriver session"]
    async fn isolated_status_notifier_host() {
        assert_eq!(
            std::env::var("SHADOW_CLOUD_NATIVE_TRAY_HOST").as_deref(),
            Ok("true")
        );
        assert!(std::env::var("DBUS_SESSION_BUS_ADDRESS").is_ok());
        let state = Arc::new(HostState {
            items: Mutex::new(vec![]),
            available: AtomicBool::new(true),
        });
        let _connection = zbus::connection::Builder::session()
            .unwrap()
            .name("org.kde.StatusNotifierWatcher")
            .unwrap()
            .serve_at("/StatusNotifierWatcher", Watcher(state.clone()))
            .unwrap()
            .serve_at("/StatusNotifierWatcher", Control(state))
            .unwrap()
            .build()
            .await
            .unwrap();
        println!("SHADOW_CLOUD_TRAY_HOST_READY");
        // Closing stdin terminates this fixture. Native app and OS objects live
        // exclusively on the private session bus supplied by its parent runner.
        tokio::task::spawn_blocking(|| {
            use std::io::Read;
            let mut byte = [0u8; 1];
            while std::io::stdin().read(&mut byte).unwrap_or(0) != 0 {}
        })
        .await
        .unwrap();
    }
}
