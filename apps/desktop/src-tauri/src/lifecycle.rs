//! Power notifications invalidate deadlines even when sleep was shorter than a poll gap.
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
type Resume = Arc<dyn Fn() + Send + Sync>;

pub(crate) struct Lifecycle {
    ready: Arc<AtomicBool>,
    _monitor: platform::Monitor,
}
impl Lifecycle {
    pub(crate) fn new(resume: impl Fn() + Send + Sync + 'static) -> Self {
        let ready = Arc::new(AtomicBool::new(false));
        let monitor = platform::install(Arc::new(resume), ready.clone());
        Self {
            ready,
            _monitor: monitor,
        }
    }
    pub(crate) fn ready(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use futures_util::StreamExt;
    use std::time::Duration;
    pub(super) struct Monitor(tauri::async_runtime::JoinHandle<()>);
    impl Drop for Monitor {
        fn drop(&mut self) {
            self.0.abort();
        }
    }
    pub(super) fn install(resume: Resume, ready: Arc<AtomicBool>) -> Monitor {
        Monitor(tauri::async_runtime::spawn(async move {
            loop {
                let _ = observe(&resume, &ready).await;
                ready.store(false, Ordering::SeqCst);
                resume();
                tokio::time::sleep(Duration::from_secs(30)).await;
            }
        }))
    }
    async fn observe(resume: &Resume, ready: &AtomicBool) -> Result<(), ()> {
        let connection = zbus::Connection::system().await.map_err(|_| ())?;
        observe_connection(connection, resume, ready).await
    }
    async fn observe_connection(
        connection: zbus::Connection,
        resume: &Resume,
        ready: &AtomicBool,
    ) -> Result<(), ()> {
        let proxy = zbus::Proxy::new(
            &connection,
            "org.freedesktop.login1",
            "/org/freedesktop/login1",
            "org.freedesktop.login1.Manager",
        )
        .await
        .map_err(|_| ())?;
        let mut signals = proxy
            .receive_signal("PrepareForSleep")
            .await
            .map_err(|_| ())?;
        let mut owners = proxy.receive_owner_changed().await.map_err(|_| ())?;
        // Reading the property proves login1 exists; a match rule alone also
        // succeeds for a service that is absent from this desktop.
        let preparing: bool = proxy
            .get_property("PreparingForSleep")
            .await
            .map_err(|_| ())?;
        ready.store(!preparing, Ordering::SeqCst);
        loop {
            let signal = tokio::select! {
                biased;
                _ = owners.next() => None,
                signal = signals.next() => signal,
            };
            let Some(signal) = signal else {
                break;
            };
            let (preparing,) = signal.body().deserialize::<(bool,)>().map_err(|_| ())?;
            ready.store(!preparing, Ordering::SeqCst);
            resume();
        }
        ready.store(false, Ordering::SeqCst);
        Err(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::{
            io::BufRead,
            process::{Child, Command, Stdio},
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
        struct Login;
        #[zbus::interface(name = "org.freedesktop.login1.Manager")]
        impl Login {
            #[zbus(property)]
            fn preparing_for_sleep(&self) -> bool {
                false
            }
        }
        #[tokio::test]
        async fn short_sleep_and_wake_each_invalidate_authorization_through_native_power_signals() {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let config = std::env::temp_dir().join(format!(
                "shadow-cloud-power-test-{}-{nonce}.conf",
                std::process::id()
            ));
            std::fs::write(&config, b"<busconfig><type>session</type><listen>unix:tmpdir=/tmp</listen><auth>EXTERNAL</auth><policy context=\"default\"><allow send_destination=\"*\"/><allow own=\"*\"/><allow eavesdrop=\"true\"/></policy></busconfig>").unwrap();
            let mut bus = Bus {
                child: Command::new("dbus-daemon")
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
            let server = zbus::connection::Builder::address(address.trim())
                .unwrap()
                .name("org.freedesktop.login1")
                .unwrap()
                .serve_at("/org/freedesktop/login1", Login)
                .unwrap()
                .build()
                .await
                .unwrap();
            let client = zbus::connection::Builder::address(address.trim())
                .unwrap()
                .build()
                .await
                .unwrap();
            let ready = Arc::new(AtomicBool::new(false));
            let callback_ready = ready.clone();
            let (events, mut received) = tokio::sync::mpsc::unbounded_channel();
            let resume: Resume = Arc::new(move || {
                let _ = events.send(callback_ready.load(Ordering::SeqCst));
            });
            let observed_ready = ready.clone();
            let observer =
                tokio::spawn(
                    async move { observe_connection(client, &resume, &observed_ready).await },
                );
            tokio::time::timeout(Duration::from_secs(1), async {
                while !ready.load(Ordering::SeqCst) {
                    tokio::time::sleep(Duration::from_millis(1)).await;
                }
            })
            .await
            .unwrap();
            for preparing in [true, false] {
                server
                    .emit_signal(
                        None::<&str>,
                        "/org/freedesktop/login1",
                        "org.freedesktop.login1.Manager",
                        "PrepareForSleep",
                        &(preparing,),
                    )
                    .await
                    .unwrap();
                assert_eq!(
                    tokio::time::timeout(Duration::from_secs(1), received.recv())
                        .await
                        .unwrap(),
                    Some(!preparing)
                );
            }
            server.release_name("org.freedesktop.login1").await.unwrap();
            assert!(tokio::time::timeout(Duration::from_secs(1), observer)
                .await
                .unwrap()
                .unwrap()
                .is_err());
            assert!(!ready.load(Ordering::SeqCst));
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use std::sync::Mutex;
    use windows::Win32::{
        Foundation::HANDLE,
        System::Power::{
            RegisterSuspendResumeNotification, UnregisterSuspendResumeNotification,
            DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS, HPOWERNOTIFY,
        },
        UI::WindowsAndMessaging::{
            DEVICE_NOTIFY_CALLBACK, PBT_APMRESUMEAUTOMATIC, PBT_APMRESUMESUSPEND, PBT_APMSUSPEND,
        },
    };
    static CALLBACK: Mutex<Option<(Resume, Arc<AtomicBool>)>> = Mutex::new(None);
    pub(super) struct Monitor(Option<HPOWERNOTIFY>);
    unsafe extern "system" fn power(
        _: *const std::ffi::c_void,
        event: u32,
        _: *const std::ffi::c_void,
    ) -> u32 {
        let callback = CALLBACK.lock().ok().and_then(|callback| callback.clone());
        if let Some((resume, ready)) = callback {
            if [PBT_APMSUSPEND, PBT_APMRESUMEAUTOMATIC, PBT_APMRESUMESUSPEND].contains(&event) {
                ready.store(event != PBT_APMSUSPEND, Ordering::SeqCst);
                resume();
            }
        }
        0
    }
    pub(super) fn install(resume: Resume, ready: Arc<AtomicBool>) -> Monitor {
        if let Ok(mut callback) = CALLBACK.lock() {
            *callback = Some((resume, ready.clone()));
        }
        let parameters = DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
            Callback: Some(power),
            Context: std::ptr::null_mut(),
        };
        // SAFETY: RegisterSuspendResumeNotification copies the callback parameters.
        // The callback uses static synchronized state, never a borrowed context.
        let registration = unsafe {
            RegisterSuspendResumeNotification(
                HANDLE(
                    (&parameters as *const DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS)
                        .cast_mut()
                        .cast(),
                ),
                DEVICE_NOTIFY_CALLBACK,
            )
        };
        ready.store(registration.is_ok(), Ordering::SeqCst);
        Monitor(registration.ok())
    }
    impl Drop for Monitor {
        fn drop(&mut self) {
            if let Some(handle) = self.0.take() {
                // SAFETY: this handle was returned by our successful registration.
                let _ = unsafe { UnregisterSuspendResumeNotification(handle) };
            }
            if let Ok(mut callback) = CALLBACK.lock() {
                *callback = None;
            }
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use objc2::{define_class, rc::Retained, AnyThread};
    use objc2_app_kit::{
        NSWorkspace, NSWorkspaceDidWakeNotification, NSWorkspaceWillSleepNotification,
    };
    use objc2_foundation::{NSNotification, NSObject, NSObjectProtocol};
    use std::sync::Mutex;
    static CALLBACK: Mutex<Option<(Resume, Arc<AtomicBool>)>> = Mutex::new(None);
    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "ShadowCloudPowerObserver"]
        struct Observer;
        unsafe impl NSObjectProtocol for Observer {}
        impl Observer {
            #[unsafe(method(powerChanged:))]
            fn changed(&self, notification: &NSNotification) {
                let callback = CALLBACK.lock().ok().and_then(|callback| callback.clone());
                if let Some((resume, ready)) = callback {
                    // SAFETY: AppKit's exported notification names are immutable.
                    ready.store(&*notification.name() != unsafe { NSWorkspaceWillSleepNotification }, Ordering::SeqCst);
                    resume();
                }
            }
        }
    );
    pub(super) struct Monitor(Retained<Observer>);
    pub(super) fn install(resume: Resume, ready: Arc<AtomicBool>) -> Monitor {
        if let Ok(mut callback) = CALLBACK.lock() {
            *callback = Some((resume, ready.clone()));
        }
        // SAFETY: Observer is an NSObject subclass with no ivars; init follows alloc.
        let observer: Retained<Observer> =
            unsafe { objc2::msg_send![super(Observer::alloc().set_ivars(())), init] };
        let center = NSWorkspace::sharedWorkspace().notificationCenter();
        // SAFETY: Observer implements powerChanged: with NSNotification's expected
        // signature. Monitor keeps it alive and removes it before releasing it.
        unsafe {
            center.addObserver_selector_name_object(
                &observer,
                objc2::sel!(powerChanged:),
                Some(NSWorkspaceWillSleepNotification),
                None,
            );
            center.addObserver_selector_name_object(
                &observer,
                objc2::sel!(powerChanged:),
                Some(NSWorkspaceDidWakeNotification),
                None,
            );
        }
        ready.store(true, Ordering::SeqCst);
        Monitor(observer)
    }
    impl Drop for Monitor {
        fn drop(&mut self) {
            // SAFETY: the retained observer is still alive at deregistration.
            unsafe {
                NSWorkspace::sharedWorkspace()
                    .notificationCenter()
                    .removeObserver(&self.0);
            }
            if let Ok(mut callback) = CALLBACK.lock() {
                *callback = None;
            }
        }
    }
}
