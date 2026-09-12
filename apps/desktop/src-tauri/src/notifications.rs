//! Native action callbacks stay in Rust and carry the engine's exact authorization.
use async_trait::async_trait;
use shadow_cloud_companion_engine::{AutomaticNotification, Command};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::watch;

#[async_trait]
trait Presented: Send {
    async fn cancelled(&mut self) -> bool;
    async fn close(&mut self);
}

#[async_trait]
trait Backend: Send + Sync {
    async fn show(
        &self,
        notification: &AutomaticNotification,
        cancel: Arc<dyn Fn() + Send + Sync>,
    ) -> Result<Box<dyn Presented>, ()>;
}

pub(crate) struct Notifications {
    backend: Arc<dyn Backend>,
    active: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
    cancel: Arc<dyn Fn(Command) + Send + Sync>,
}

impl Notifications {
    pub(crate) fn new(cancel: impl Fn(Command) + Send + Sync + 'static) -> Self {
        Self::with_backend(Arc::new(platform::Native::default()), Arc::new(cancel))
    }

    fn with_backend(backend: Arc<dyn Backend>, cancel: Arc<dyn Fn(Command) + Send + Sync>) -> Self {
        Self {
            backend,
            active: Arc::new(Mutex::new(HashMap::new())),
            cancel,
        }
    }

    pub(crate) async fn show(&self, notification: AutomaticNotification) -> Result<(), ()> {
        let id = notification.authorization_id.clone();
        let (dismiss, mut dismissed) = watch::channel(false);
        {
            let mut active = self.active.lock().map_err(|_| ())?;
            // One notification per active Campaign, bounded by the supported scale.
            if active.len() >= 100 || active.contains_key(&id) {
                return Err(());
            }
            active.insert(id.clone(), dismiss);
        }
        let cancel = self.cancel.clone();
        let binding = notification.clone();
        let cancellation_guard = dismissed.clone();
        let cancel: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
            if !*cancellation_guard.borrow() {
                cancel(Command::CancelAutomaticSend {
                    campaign_id: binding.campaign_id.clone(),
                    authorization_id: binding.authorization_id.clone(),
                });
            }
        });
        let presented = tokio::time::timeout(
            Duration::from_secs(2),
            self.backend.show(&notification, cancel.clone()),
        )
        .await;
        let mut presented = match presented {
            Ok(Ok(presented)) => presented,
            _ => {
                self.dismiss(&id);
                return Err(());
            }
        };
        if *dismissed.borrow() {
            let _ = tokio::time::timeout(Duration::from_secs(2), presented.close()).await;
            return Err(());
        }
        let active = self.active.clone();
        tokio::spawn(async move {
            let cancelled = tokio::select! {
                biased;
                _ = dismissed.changed() => false,
                cancelled = presented.cancelled() => cancelled,
                _ = tokio::time::sleep(Duration::from_secs(30)) => false,
            };
            if cancelled && !*dismissed.borrow() {
                cancel();
            }
            let _ = tokio::time::timeout(Duration::from_secs(2), presented.close()).await;
            if let Ok(mut active) = active.lock() {
                active.remove(&id);
            }
        });
        Ok(())
    }

    pub(crate) fn dismiss(&self, id: &str) {
        if let Ok(mut active) = self.active.lock() {
            if let Some(dismiss) = active.remove(id) {
                let _ = dismiss.send(true);
            }
        }
    }
}

impl Drop for Notifications {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active.lock() {
            for (_, dismiss) in active.drain() {
                let _ = dismiss.send(true);
            }
        }
    }
}

fn body(notification: &AutomaticNotification) -> String {
    format!(
        "{} — {} will be sent in 15 seconds.",
        notification.campaign_name, notification.filename
    )
}

#[cfg(any(target_os = "windows", test))]
struct BlockingSetup(Arc<tokio::sync::Semaphore>);
#[cfg(any(target_os = "windows", test))]
impl Default for BlockingSetup {
    fn default() -> Self {
        Self(Arc::new(tokio::sync::Semaphore::new(1)))
    }
}
#[cfg(any(target_os = "windows", test))]
impl BlockingSetup {
    async fn run<T: Send + 'static>(
        &self,
        action: impl FnOnce() -> Result<T, ()> + Send + 'static,
    ) -> Result<T, ()> {
        // A timeout drops the JoinHandle, but cannot stop an OS call. The worker
        // retains its permit so retries cannot start additional blocked calls.
        let permit = self.0.clone().try_acquire_owned().map_err(|_| ())?;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            action()
        })
        .await
        .map_err(|_| ())?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    struct Fake {
        unavailable: AtomicBool,
        actions: watch::Sender<bool>,
        closes: Arc<AtomicUsize>,
        callbacks: Mutex<Vec<Arc<dyn Fn() + Send + Sync>>>,
    }
    struct Display {
        actions: watch::Receiver<bool>,
        closes: Arc<AtomicUsize>,
    }
    #[async_trait]
    impl Backend for Fake {
        async fn show(
            &self,
            _: &AutomaticNotification,
            cancel: Arc<dyn Fn() + Send + Sync>,
        ) -> Result<Box<dyn Presented>, ()> {
            if self.unavailable.load(Ordering::SeqCst) {
                return Err(());
            }
            self.callbacks.lock().unwrap().push(cancel);
            Ok(Box::new(Display {
                actions: self.actions.subscribe(),
                closes: self.closes.clone(),
            }))
        }
    }
    #[async_trait]
    impl Presented for Display {
        async fn cancelled(&mut self) -> bool {
            self.actions.changed().await.is_ok() && *self.actions.borrow()
        }
        async fn close(&mut self) {
            self.closes.fetch_add(1, Ordering::SeqCst);
        }
    }
    fn message(id: &str) -> AutomaticNotification {
        AutomaticNotification {
            campaign_id: "campaign-1".into(),
            campaign_name: "Synthetic Campaign".into(),
            filename: "Turn.se1".into(),
            authorization_id: id.into(),
        }
    }
    fn setup() -> (
        Notifications,
        Arc<Fake>,
        tokio::sync::mpsc::UnboundedReceiver<Command>,
    ) {
        let (commands, received) = tokio::sync::mpsc::unbounded_channel();
        let backend = Arc::new(Fake {
            unavailable: AtomicBool::new(false),
            actions: watch::channel(false).0,
            closes: Arc::new(AtomicUsize::new(0)),
            callbacks: Mutex::new(Vec::new()),
        });
        (
            Notifications::with_backend(
                backend.clone(),
                Arc::new(move |command| {
                    let _ = commands.send(command);
                }),
            ),
            backend,
            received,
        )
    }
    #[tokio::test]
    async fn native_cancel_carries_the_exact_campaign_and_authorization() {
        let (notifications, backend, mut commands) = setup();
        notifications
            .show(message("authorization-1"))
            .await
            .unwrap();
        backend.actions.send(true).unwrap();
        let command = tokio::time::timeout(Duration::from_secs(1), commands.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(
            matches!(command, Command::CancelAutomaticSend { campaign_id, authorization_id } if campaign_id=="campaign-1" && authorization_id=="authorization-1")
        );
        tokio::task::yield_now().await;
        assert_eq!(backend.closes.load(Ordering::SeqCst), 1);
        assert!(notifications.active.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn denied_or_unavailable_native_notifications_never_arm_a_countdown() {
        let (notifications, backend, mut commands) = setup();
        backend.unavailable.store(true, Ordering::SeqCst);
        assert!(notifications
            .show(message("authorization-1"))
            .await
            .is_err());
        assert!(notifications.active.lock().unwrap().is_empty());
        assert!(commands.try_recv().is_err());
    }
    #[tokio::test]
    async fn dismiss_and_teardown_close_notifications_without_late_cancel_commands() {
        let (notifications, backend, mut commands) = setup();
        notifications
            .show(message("authorization-1"))
            .await
            .unwrap();
        notifications.dismiss("authorization-1");
        notifications
            .show(message("authorization-2"))
            .await
            .unwrap();
        drop(notifications);
        for _ in 0..10 {
            tokio::task::yield_now().await;
        }
        assert_eq!(backend.closes.load(Ordering::SeqCst), 2);
        assert!(commands.try_recv().is_err());
    }
    #[tokio::test]
    async fn an_os_callback_for_a_dismissed_authorization_never_cancels_its_replacement() {
        let (notifications, backend, mut commands) = setup();
        notifications
            .show(message("old-authorization"))
            .await
            .unwrap();
        notifications.dismiss("old-authorization");
        notifications
            .show(message("new-authorization"))
            .await
            .unwrap();
        let callbacks = backend.callbacks.lock().unwrap();
        callbacks[0]();
        assert!(commands.try_recv().is_err());
        callbacks[1]();
        assert!(
            matches!(commands.try_recv().unwrap(), Command::CancelAutomaticSend { authorization_id, .. } if authorization_id=="new-authorization")
        );
    }
    #[tokio::test]
    async fn notifications_cannot_accumulate_beyond_supported_campaign_scale() {
        let (notifications, backend, _) = setup();
        for id in 0..100 {
            notifications
                .show(message(&format!("authorization-{id}")))
                .await
                .unwrap();
        }
        assert!(notifications
            .show(message("authorization-100"))
            .await
            .is_err());
        assert!(notifications
            .show(message("authorization-0"))
            .await
            .is_err());
        assert_eq!(backend.callbacks.lock().unwrap().len(), 100);
        drop(notifications);
        for _ in 0..100 {
            tokio::task::yield_now().await;
        }
        assert_eq!(backend.closes.load(Ordering::SeqCst), 100);
    }
    #[tokio::test]
    async fn a_timed_out_native_setup_keeps_its_worker_slot_until_the_os_call_finishes() {
        let setup = BlockingSetup::default();
        let (release, blocked) = std::sync::mpsc::channel();
        let timeout = tokio::time::timeout(
            Duration::from_millis(20),
            setup.run(move || blocked.recv_timeout(Duration::from_secs(2)).map_err(|_| ())),
        )
        .await;
        assert!(timeout.is_err());
        let extra_call = Arc::new(AtomicBool::new(false));
        let recorded = extra_call.clone();
        let next = setup
            .run(move || {
                recorded.store(true, Ordering::SeqCst);
                Ok(())
            })
            .await;
        release.send(()).unwrap();
        assert!(next.is_err());
        assert!(!extra_call.load(Ordering::SeqCst));
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use futures_util::StreamExt;
    use zbus::{
        proxy::{OwnerChangedStream, SignalStream},
        Connection, Proxy,
    };

    #[derive(Default)]
    pub(super) struct Native {
        connection: Option<Connection>,
    }
    struct Notification {
        proxy: Proxy<'static>,
        actions: SignalStream<'static>,
        owners: OwnerChangedStream<'static>,
        id: u32,
    }

    #[async_trait]
    impl Backend for Native {
        async fn show(
            &self,
            notification: &AutomaticNotification,
            _cancel: Arc<dyn Fn() + Send + Sync>,
        ) -> Result<Box<dyn Presented>, ()> {
            let connection = match &self.connection {
                Some(connection) => connection.clone(),
                None => Connection::session().await.map_err(|_| ())?,
            };
            let proxy = Proxy::new_owned(
                connection.clone(),
                "org.freedesktop.Notifications",
                "/org/freedesktop/Notifications",
                "org.freedesktop.Notifications",
            )
            .await
            .map_err(|_| ())?;
            let owners = proxy.receive_owner_changed().await.map_err(|_| ())?;
            let owner = zbus::fdo::DBusProxy::new(&connection)
                .await
                .map_err(|_| ())?
                .get_name_owner("org.freedesktop.Notifications".try_into().map_err(|_| ())?)
                .await
                .map_err(|_| ())?;
            // Notification IDs belong to this daemon instance. Never send an old
            // CloseNotification ID to a replacement daemon that could reuse it.
            let proxy = Proxy::new_owned(
                connection,
                owner.to_string(),
                "/org/freedesktop/Notifications",
                "org.freedesktop.Notifications",
            )
            .await
            .map_err(|_| ())?;
            let capabilities: Vec<String> =
                proxy.call("GetCapabilities", &()).await.map_err(|_| ())?;
            if !capabilities
                .iter()
                .any(|capability| capability == "actions")
            {
                return Err(());
            }
            // Subscribe before delivery so an immediate Cancel cannot be missed.
            let actions = proxy
                .receive_signal("ActionInvoked")
                .await
                .map_err(|_| ())?;
            let mut hints = HashMap::<&str, zbus::zvariant::Value<'_>>::new();
            hints.insert(
                "desktop-entry",
                zbus::zvariant::Value::from("com.shadowcloud.companion"),
            );
            hints.insert("transient", zbus::zvariant::Value::from(true));
            // Escape desktop markup; Campaign names and filenames are plain text.
            let text = body(notification)
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;");
            let id: u32 = proxy
                .call(
                    "Notify",
                    &(
                        "Shadow Cloud Companion",
                        0_u32,
                        "com.shadowcloud.companion",
                        "Turn submission in 15 seconds",
                        text,
                        vec!["cancel", "Cancel"],
                        hints,
                        20_000_i32,
                    ),
                )
                .await
                .map_err(|_| ())?;
            Ok(Box::new(Notification {
                proxy,
                actions,
                owners,
                id,
            }))
        }
    }
    #[async_trait]
    impl Presented for Notification {
        async fn cancelled(&mut self) -> bool {
            loop {
                let message = tokio::select! {
                    biased;
                    _ = self.owners.next() => return true,
                    message = self.actions.next() => message,
                };
                let Some(message) = message else {
                    return true;
                };
                if let Ok((id, action)) = message.body().deserialize::<(u32, String)>() {
                    if id == self.id && action == "cancel" {
                        return true;
                    }
                }
            }
        }
        async fn close(&mut self) {
            let _: Result<(), _> = self.proxy.call("CloseNotification", &(self.id,)).await;
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::{
            io::BufRead,
            process::{Child, Command as ProcessCommand, Stdio},
            sync::atomic::{AtomicBool, AtomicUsize, Ordering},
        };
        struct Bus {
            child: Child,
            config: std::path::PathBuf,
        }
        impl Drop for Bus {
            fn drop(&mut self) {
                let _ = self.child.kill();
                let _ = self.child.wait();
                let _ = std::fs::remove_file(&self.config);
            }
        }
        struct Desktop {
            actions: Arc<AtomicBool>,
            shown: Arc<AtomicUsize>,
            closed: Arc<AtomicUsize>,
            immediate_cancel: Arc<AtomicBool>,
        }
        #[zbus::interface(name = "org.freedesktop.Notifications")]
        impl Desktop {
            fn get_capabilities(&self) -> Vec<&str> {
                if self.actions.load(Ordering::SeqCst) {
                    vec!["actions", "body"]
                } else {
                    vec!["body"]
                }
            }
            async fn notify(
                &self,
                app: &str,
                replaces: u32,
                _icon: &str,
                summary: &str,
                body: &str,
                actions: Vec<&str>,
                _hints: HashMap<String, zbus::zvariant::OwnedValue>,
                expiry: i32,
                #[zbus(connection)] connection: &Connection,
            ) -> u32 {
                assert_eq!(app, "Shadow Cloud Companion");
                assert_eq!(replaces, 0);
                assert_eq!(summary, "Turn submission in 15 seconds");
                assert!(body.contains("&lt;Synthetic&gt;"));
                assert_eq!(actions, vec!["cancel", "Cancel"]);
                assert_eq!(expiry, 20_000);
                self.shown.fetch_add(1, Ordering::SeqCst);
                // A button click can arrive before Notify's method response.
                if self.immediate_cancel.load(Ordering::SeqCst) {
                    connection
                        .emit_signal(
                            None::<&str>,
                            "/org/freedesktop/Notifications",
                            "org.freedesktop.Notifications",
                            "ActionInvoked",
                            &(71_u32, "cancel"),
                        )
                        .await
                        .unwrap();
                }
                71
            }
            fn close_notification(&self, id: u32) {
                assert_eq!(id, 71);
                self.closed.fetch_add(1, Ordering::SeqCst);
            }
        }
        #[tokio::test]
        async fn linux_native_protocol_requires_actions_and_routes_immediate_cancel_without_a_desktop_session(
        ) {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let config = std::env::temp_dir().join(format!(
                "shadow-cloud-notification-test-{}-{nonce}.conf",
                std::process::id()
            ));
            std::fs::write(&config, b"<busconfig><type>session</type><listen>unix:tmpdir=/tmp</listen><auth>EXTERNAL</auth><policy context=\"default\"><allow send_destination=\"*\"/><allow own=\"*\"/><allow eavesdrop=\"true\"/></policy></busconfig>").unwrap();
            let mut bus = Bus {
                child: ProcessCommand::new("dbus-daemon")
                    .args(["--nofork", "--print-address=1", "--config-file"])
                    .arg(&config)
                    .stdin(Stdio::null())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::null())
                    .spawn()
                    .unwrap(),
                config,
            };
            let mut address = String::new();
            std::io::BufReader::new(bus.child.stdout.take().unwrap())
                .read_line(&mut address)
                .unwrap();
            let actions = Arc::new(AtomicBool::new(false));
            let shown = Arc::new(AtomicUsize::new(0));
            let closed = Arc::new(AtomicUsize::new(0));
            let immediate_cancel = Arc::new(AtomicBool::new(true));
            let server = zbus::connection::Builder::address(address.trim())
                .unwrap()
                .name("org.freedesktop.Notifications")
                .unwrap()
                .serve_at(
                    "/org/freedesktop/Notifications",
                    Desktop {
                        actions: actions.clone(),
                        shown: shown.clone(),
                        closed: closed.clone(),
                        immediate_cancel: immediate_cancel.clone(),
                    },
                )
                .unwrap()
                .build()
                .await
                .unwrap();
            let native = Native {
                connection: Some(
                    zbus::connection::Builder::address(address.trim())
                        .unwrap()
                        .build()
                        .await
                        .unwrap(),
                ),
            };
            let (commands, mut received) = tokio::sync::mpsc::unbounded_channel();
            let notifications = Notifications::with_backend(
                Arc::new(native),
                Arc::new(move |command| {
                    let _ = commands.send(command);
                }),
            );
            let message = AutomaticNotification {
                campaign_id: "campaign-1".into(),
                campaign_name: "<Synthetic>".into(),
                filename: "Turn.se1".into(),
                authorization_id: "authorization-1".into(),
            };
            assert!(notifications.show(message.clone()).await.is_err());
            assert_eq!(shown.load(Ordering::SeqCst), 0);
            actions.store(true, Ordering::SeqCst);
            notifications.show(message.clone()).await.unwrap();
            let command = tokio::time::timeout(Duration::from_secs(1), received.recv())
                .await
                .unwrap()
                .unwrap();
            assert!(
                matches!(command, Command::CancelAutomaticSend { campaign_id, authorization_id } if campaign_id=="campaign-1" && authorization_id=="authorization-1")
            );
            for _ in 0..100 {
                if closed.load(Ordering::SeqCst) > 0 {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
            assert_eq!(closed.load(Ordering::SeqCst), 1);
            immediate_cancel.store(false, Ordering::SeqCst);
            let replacement_closed = Arc::new(AtomicUsize::new(0));
            let replacement = zbus::connection::Builder::address(address.trim())
                .unwrap()
                .serve_at(
                    "/org/freedesktop/Notifications",
                    Desktop {
                        actions: actions.clone(),
                        shown: shown.clone(),
                        closed: replacement_closed.clone(),
                        immediate_cancel: immediate_cancel.clone(),
                    },
                )
                .unwrap()
                .build()
                .await
                .unwrap();
            for replace in [false, true] {
                let id = format!("owner-loss-{replace}");
                notifications
                    .show(AutomaticNotification {
                        authorization_id: id.clone(),
                        ..message.clone()
                    })
                    .await
                    .unwrap();
                server
                    .release_name("org.freedesktop.Notifications")
                    .await
                    .unwrap();
                if replace {
                    replacement
                        .request_name("org.freedesktop.Notifications")
                        .await
                        .unwrap();
                }
                let command = tokio::time::timeout(Duration::from_secs(1), received.recv())
                    .await
                    .unwrap()
                    .unwrap();
                assert!(
                    matches!(command, Command::CancelAutomaticSend { authorization_id, .. } if authorization_id==id)
                );
                if !replace {
                    server
                        .request_name("org.freedesktop.Notifications")
                        .await
                        .unwrap();
                }
            }
            for _ in 0..100 {
                if closed.load(Ordering::SeqCst) == 3 {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
            assert_eq!(closed.load(Ordering::SeqCst), 3);
            assert_eq!(
                replacement_closed.load(Ordering::SeqCst),
                0,
                "old notification IDs must never be closed on a replacement daemon"
            );
            drop(server);
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use windows::{
        core::{IInspectable, Interface, Ref, HSTRING},
        Data::Xml::Dom::XmlDocument,
        Foundation::{DateTime, IReference, PropertyValue, TypedEventHandler},
        UI::Notifications::{
            NotificationSetting, ToastActivatedEventArgs, ToastNotification,
            ToastNotificationManager, ToastNotifier,
        },
    };

    #[derive(Default)]
    pub(super) struct Native {
        setup: BlockingSetup,
    }
    struct Notification {
        toast: ToastNotification,
        notifier: ToastNotifier,
        activated: Option<i64>,
        failed: Option<i64>,
        response: watch::Receiver<bool>,
    }
    impl Drop for Notification {
        fn drop(&mut self) {
            if let Some(token) = self.activated.take() {
                let _ = self.toast.RemoveActivated(token);
            }
            if let Some(token) = self.failed.take() {
                let _ = self.toast.RemoveFailed(token);
            }
            let _ = self.notifier.Hide(&self.toast);
        }
    }
    #[async_trait]
    impl Backend for Native {
        async fn show(
            &self,
            notification: &AutomaticNotification,
            cancel: Arc<dyn Fn() + Send + Sync>,
        ) -> Result<Box<dyn Presented>, ()> {
            let notification = notification.clone();
            // WinRT setup runs outside the coordinator's async executor. An expired
            // setup result drops its owned toast and event registrations.
            self.setup
                .run(move || {
                    create(&notification, cancel)
                        .map(|notification| Box::new(notification) as Box<dyn Presented>)
                })
                .await
        }
    }
    fn create(
        notification: &AutomaticNotification,
        cancel: Arc<dyn Fn() + Send + Sync>,
    ) -> Result<Notification, ()> {
        let app_id = if tauri::is_dev() {
            "com.shadowcloud.companion.development"
        } else {
            "com.shadowcloud.companion"
        };
        let (registration, _) = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
            .create_subkey(format!(r"SOFTWARE\Classes\AppUserModelId\{app_id}"))
            .map_err(|_| ())?;
        registration
            .set_value("DisplayName", &"Shadow Cloud Companion")
            .map_err(|_| ())?;
        let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))
            .map_err(|_| ())?;
        if notifier.Setting().map_err(|_| ())? != NotificationSetting::Enabled {
            return Err(());
        }
        let doc = XmlDocument::new().map_err(|_| ())?;
        doc.LoadXml(&HSTRING::from("<toast duration='long'><visual><binding template='ToastGeneric'><text>Turn submission in 15 seconds</text><text/></binding></visual><actions><action content='Cancel' arguments='cancel' activationType='foreground'/></actions></toast>")).map_err(|_| ())?;
        let text = doc
            .GetElementsByTagName(&HSTRING::from("text"))
            .map_err(|_| ())?
            .Item(1)
            .map_err(|_| ())?;
        text.AppendChild(
            &doc.CreateTextNode(&HSTRING::from(body(notification)))
                .map_err(|_| ())?,
        )
        .map_err(|_| ())?;
        let toast = ToastNotification::CreateToastNotification(&doc).map_err(|_| ())?;
        let seconds = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| ())?
            .as_secs();
        let expiration = PropertyValue::CreateDateTime(DateTime {
            UniversalTime: ((seconds + 11_644_473_600 + 20) * 10_000_000) as i64,
        })
        .map_err(|_| ())?
        .cast::<IReference<DateTime>>()
        .map_err(|_| ())?;
        toast.SetExpirationTime(&expiration).map_err(|_| ())?;
        let (response, received) = watch::channel(false);
        let mut notification = Notification {
            toast,
            notifier,
            activated: None,
            failed: None,
            response: received,
        };
        let action_response = response.clone();
        let action_cancel = cancel.clone();
        notification.activated = Some(
            notification
                .toast
                .Activated(&TypedEventHandler::new(
                    move |_: Ref<'_, ToastNotification>, args: Ref<'_, IInspectable>| {
                        if args
                            .as_ref()
                            .and_then(|args| args.cast::<ToastActivatedEventArgs>().ok())
                            .and_then(|args| args.Arguments().ok())
                            .is_some_and(|argument| argument == "cancel")
                        {
                            // This executes on the OS callback thread before queueing the command.
                            action_cancel();
                            let _ = action_response.send(true);
                        }
                        Ok(())
                    },
                ))
                .map_err(|_| ())?,
        );
        notification.failed = Some(
            notification
                .toast
                .Failed(&TypedEventHandler::new(move |_, _| {
                    cancel();
                    let _ = response.send(true);
                    Ok(())
                }))
                .map_err(|_| ())?,
        );
        notification
            .notifier
            .Show(&notification.toast)
            .map_err(|_| ())?;
        Ok(notification)
    }
    #[async_trait]
    impl Presented for Notification {
        async fn cancelled(&mut self) -> bool {
            let _ = self.response.changed().await;
            false
        }
        async fn close(&mut self) {
            if let Some(token) = self.activated.take() {
                let _ = self.toast.RemoveActivated(token);
            }
            if let Some(token) = self.failed.take() {
                let _ = self.toast.RemoveFailed(token);
            }
            let _ = self.notifier.Hide(&self.toast);
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use block2::{DynBlock, RcBlock};
    use objc2::{
        define_class,
        rc::Retained,
        runtime::{Bool, ProtocolObject},
        AnyThread,
    };
    use objc2_foundation::{
        NSArray, NSBundle, NSError, NSObject, NSObjectProtocol, NSSet, NSString,
    };
    use objc2_user_notifications::*;
    use std::{cell::Cell, ptr::NonNull, sync::OnceLock};

    type Cancel = Arc<dyn Fn() + Send + Sync>;
    static RESPONSES: OnceLock<Mutex<HashMap<String, (Cancel, watch::Sender<bool>)>>> =
        OnceLock::new();
    fn responses() -> &'static Mutex<HashMap<String, (Cancel, watch::Sender<bool>)>> {
        RESPONSES.get_or_init(|| Mutex::new(HashMap::new()))
    }
    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "ShadowCloudNotificationDelegate"]
        struct Delegate;
        unsafe impl NSObjectProtocol for Delegate {}
        unsafe impl UNUserNotificationCenterDelegate for Delegate {
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            fn will_present(
                &self,
                _: &UNUserNotificationCenter,
                _: &UNNotification,
                completion: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
            ) {
                completion.call((UNNotificationPresentationOptions::Banner
                    | UNNotificationPresentationOptions::Sound,));
            }
            #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
            fn response(
                &self,
                _: &UNUserNotificationCenter,
                response: &UNNotificationResponse,
                completion: &DynBlock<dyn Fn()>,
            ) {
                let id = response.notification().request().identifier().to_string();
                let binding = responses()
                    .lock()
                    .ok()
                    .and_then(|mut responses| responses.remove(&id));
                if let Some((cancel, answered)) = binding {
                    if response.actionIdentifier().to_string() == "cancel" {
                        cancel();
                    }
                    let _ = answered.send(true);
                }
                completion.call(());
            }
        }
    );
    fn center() -> Result<Retained<UNUserNotificationCenter>, ()> {
        // UNUserNotificationCenter requires a bundled application. Never impersonate
        // another installed application during an unbundled development launch.
        if NSBundle::mainBundle().bundleIdentifier().is_none() {
            return Err(());
        }
        static DELEGATE: OnceLock<Retained<Delegate>> = OnceLock::new();
        let delegate = DELEGATE.get_or_init(|| {
            // SAFETY: Delegate is an NSObject subclass with no ivars; init follows alloc.
            unsafe { objc2::msg_send![super(Delegate::alloc().set_ivars(())), init] }
        });
        let center = UNUserNotificationCenter::currentNotificationCenter();
        center.setDelegate(Some(ProtocolObject::from_ref(&**delegate)));
        Ok(center)
    }
    #[derive(Default)]
    pub(super) struct Native;
    struct Notification {
        id: String,
        response: watch::Receiver<bool>,
    }
    impl Drop for Notification {
        fn drop(&mut self) {
            if let Ok(mut responses) = responses().lock() {
                responses.remove(&self.id);
            }
            if let Ok(center) = center() {
                let ids = NSArray::from_retained_slice(&[NSString::from_str(&self.id)]);
                center.removeDeliveredNotificationsWithIdentifiers(&ids);
                center.removePendingNotificationRequestsWithIdentifiers(&ids);
            }
        }
    }
    async fn allowed() -> Result<bool, ()> {
        let (result, received) = tokio::sync::oneshot::channel();
        let result = Cell::new(Some(result));
        center()?.getNotificationSettingsWithCompletionHandler(&RcBlock::new(
            move |settings: NonNull<UNNotificationSettings>| {
                // SAFETY: Apple's completion handler supplies a nonnull settings object
                // that remains valid for the duration of this callback.
                let settings = unsafe { settings.as_ref() };
                let status = settings.authorizationStatus();
                let allowed = status == UNAuthorizationStatus::Authorized
                    && settings.alertSetting() == UNNotificationSetting::Enabled;
                static REQUEST_PENDING: std::sync::atomic::AtomicBool =
                    std::sync::atomic::AtomicBool::new(false);
                if status == UNAuthorizationStatus::NotDetermined
                    && REQUEST_PENDING
                        .compare_exchange(
                            false,
                            true,
                            std::sync::atomic::Ordering::SeqCst,
                            std::sync::atomic::Ordering::SeqCst,
                        )
                        .is_ok()
                {
                    UNUserNotificationCenter::currentNotificationCenter()
                        .requestAuthorizationWithOptions_completionHandler(
                            UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
                            &RcBlock::new(|_: Bool, _: *mut NSError| {
                                REQUEST_PENDING.store(false, std::sync::atomic::Ordering::SeqCst);
                            }),
                        );
                }
                if let Some(result) = result.take() {
                    let _ = result.send(allowed);
                }
            },
        ));
        received.await.map_err(|_| ())
    }
    #[async_trait]
    impl Backend for Native {
        async fn show(
            &self,
            notification: &AutomaticNotification,
            cancel: Cancel,
        ) -> Result<Box<dyn Presented>, ()> {
            if !allowed().await? {
                return Err(());
            }
            let id = notification.authorization_id.clone();
            let (response, received) = watch::channel(false);
            let presented = Notification {
                id: id.clone(),
                response: received,
            };
            {
                let mut responses = responses().lock().map_err(|_| ())?;
                if responses.len() >= 100 {
                    return Err(());
                }
                responses.insert(id.clone(), (cancel, response));
            }
            let (sent, sent_result) = tokio::sync::oneshot::channel();
            {
                let center = center()?;
                let action = UNNotificationAction::actionWithIdentifier_title_options(
                    &NSString::from_str("cancel"),
                    &NSString::from_str("Cancel"),
                    UNNotificationActionOptions::empty(),
                );
                let category = UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(&NSString::from_str("automatic-turn"), &NSArray::from_retained_slice(&[action]), &NSArray::new(), UNNotificationCategoryOptions::empty());
                center.setNotificationCategories(&NSSet::from_retained_slice(&[category]));
                let content = UNMutableNotificationContent::new();
                content.setTitle(&NSString::from_str("Turn submission in 15 seconds"));
                content.setBody(&NSString::from_str(&body(notification)));
                content.setCategoryIdentifier(&NSString::from_str("automatic-turn"));
                let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
                    &NSString::from_str(&id),
                    &content,
                    None,
                );
                let sent = Cell::new(Some(sent));
                center.addNotificationRequest_withCompletionHandler(
                    &request,
                    Some(&RcBlock::new(move |error: *mut NSError| {
                        if let Some(sent) = sent.take() {
                            let _ = sent.send(error.is_null());
                        }
                    })),
                );
            }
            if !sent_result.await.map_err(|_| ())? {
                return Err(());
            }
            Ok(Box::new(presented))
        }
    }
    #[async_trait]
    impl Presented for Notification {
        async fn cancelled(&mut self) -> bool {
            let _ = self.response.changed().await;
            false
        }
        async fn close(&mut self) {
            if let Ok(mut responses) = responses().lock() {
                responses.remove(&self.id);
            }
            if let Ok(center) = center() {
                let ids = NSArray::from_retained_slice(&[NSString::from_str(&self.id)]);
                center.removeDeliveredNotificationsWithIdentifiers(&ids);
                center.removePendingNotificationRequestsWithIdentifiers(&ids);
            }
        }
    }
}
