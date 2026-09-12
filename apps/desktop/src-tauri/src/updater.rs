//! Update offers bind explicit consent to one channel and one signed artifact.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};
use reqwest::{Client, Url};
use semver::Version;
use shadow_cloud_companion_engine::{UpdateChannel, UpdateOffer, RELEASE};
use std::{
    future::Future,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::{Mutex, Semaphore};

const PACKAGE_LIMIT: usize = 512 * 1024 * 1024;
const RELEASES_LIMIT: usize = 2 * 1024 * 1024;
const OFFER_LIFETIME: Duration = Duration::from_secs(10 * 60);
const CHECK_TIMEOUT: Duration = Duration::from_secs(45);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(5 * 60);

struct CachedOffer {
    id: String,
    channel: UpdateChannel,
    checked_at: Instant,
    update: Update,
}

pub(crate) struct Updates {
    app: tauri::AppHandle,
    configuration: Result<tauri_plugin_updater::Config, ()>,
    client: Client,
    pending: Arc<AtomicUsize>,
    offer: Mutex<Option<CachedOffer>>,
    operation: Mutex<()>,
    installer: Arc<Semaphore>,
}

impl Updates {
    pub(crate) fn new(app: tauri::AppHandle, pending: Arc<AtomicUsize>) -> Result<Self, ()> {
        let configuration = app
            .config()
            .plugins
            .0
            .get("updater")
            .ok_or(())
            .and_then(|value| {
                serde_json::from_value::<tauri_plugin_updater::Config>(value.clone())
                    .map_err(|_| ())
            })
            .and_then(validate_configuration);
        Ok(Self {
            app,
            configuration,
            client: secure_client()?,
            pending,
            offer: Mutex::new(None),
            operation: Mutex::new(()),
            installer: Arc::new(Semaphore::new(1)),
        })
    }

    pub(crate) async fn check(&self, channel: UpdateChannel) -> Result<Option<UpdateOffer>, ()> {
        let _operation = self.operation.lock().await;
        self.offer.lock().await.take();
        let update = cancellable(&self.pending, CHECK_TIMEOUT, self.find_update(channel)).await?;
        let Some(update) = update else {
            return Ok(None);
        };
        let mut nonce = [0u8; 24];
        getrandom::fill(&mut nonce).map_err(|_| ())?;
        let offer = UpdateOffer {
            offer_id: nonce.iter().map(|byte| format!("{byte:02x}")).collect(),
            version: update.version.clone(),
        };
        *self.offer.lock().await = Some(CachedOffer {
            id: offer.offer_id.clone(),
            channel,
            checked_at: Instant::now(),
            update,
        });
        Ok(Some(offer))
    }

    pub(crate) async fn install(&self, offer_id: &str) -> Result<(), ()> {
        let _operation = self.operation.lock().await;
        let cached = self.offer.lock().await.take().ok_or(())?;
        if cached.id != offer_id || cached.checked_at.elapsed() > OFFER_LIFETIME {
            return Err(());
        }
        // Consent never follows a mutable channel/tag to a different artifact.
        let fresh = cancellable(
            &self.pending,
            CHECK_TIMEOUT,
            self.find_update(cached.channel),
        )
        .await?
        .ok_or(())?;
        if !same_artifact(&cached.update, &fresh) {
            return Err(());
        }
        let bytes = cancellable(
            &self.pending,
            DOWNLOAD_TIMEOUT,
            bounded_get(
                &self.client,
                cached.update.download_url.clone(),
                PACKAGE_LIMIT,
                DOWNLOAD_TIMEOUT,
            ),
        )
        .await?;
        let key = self.configuration.as_ref().map_err(|_| ())?.pubkey.clone();
        let signature = cached.update.signature.clone();
        // Retain the one worker slot even if an outer caller drops its future.
        let permit = self.installer.clone().try_acquire_owned().map_err(|_| ())?;
        let pending = self.pending.clone();
        let update = cached.update;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            install_verified(bytes, &key, &signature, &pending, |verified| {
                update.install(verified).map_err(|_| ())
            })
        })
        .await
        .map_err(|_| ())??;
        // Windows exits through its installer. Other platforms must relaunch
        // after replacing the application; all engine ledger writes preceded consent.
        self.app.restart();
    }

    async fn find_update(&self, channel: UpdateChannel) -> Result<Option<Update>, ()> {
        let configuration = self.configuration.as_ref().map_err(|_| ())?;
        let endpoints = match channel {
            UpdateChannel::Stable => configuration.endpoints.clone(),
            UpdateChannel::Preview => {
                let Some(endpoint) = self.preview_endpoint().await? else {
                    return Ok(None);
                };
                vec![endpoint]
            }
        };
        let updater = self
            .app
            .updater_builder()
            .endpoints(endpoints)
            .map_err(|_| ())?
            .timeout(Duration::from_secs(10))
            .configure_client(|client| {
                client
                    .https_only(true)
                    .redirect(reqwest::redirect::Policy::limited(5))
                    .timeout(Duration::from_secs(10))
            })
            .version_comparator(move |current, release| {
                release.version > current
                    && match channel {
                        UpdateChannel::Stable => release.version.pre.is_empty(),
                        UpdateChannel::Preview => !release.version.pre.is_empty(),
                    }
            })
            .build()
            .map_err(|_| ())?;
        let mut update = updater.check().await.map_err(|_| ())?;
        if let Some(update) = update.as_mut() {
            https_url(&update.download_url)?;
            decode_signature(&update.signature)?;
            update.timeout = Some(DOWNLOAD_TIMEOUT);
        }
        Ok(update)
    }

    async fn preview_endpoint(&self) -> Result<Option<Url>, ()> {
        let current = Version::parse(RELEASE).map_err(|_| ())?;
        let mut latest: Option<(Version, String)> = None;
        // GitHub returns newest-created releases first. Bound metadata and page
        // count so an unauthenticated manual check cannot become an unbounded crawl.
        for page in 1..=3 {
            let url = Url::parse(&format!("https://api.github.com/repos/1Solon/shadow-cloud/releases?per_page=100&page={page}")).map_err(|_| ())?;
            let bytes =
                bounded_get(&self.client, url, RELEASES_LIMIT, Duration::from_secs(10)).await?;
            let releases: Vec<Release> = serde_json::from_slice(&bytes).map_err(|_| ())?;
            let last_page = releases.len() < 100;
            for release in releases {
                if let Some(version) = preview_version(&release, &current) {
                    if latest.as_ref().is_none_or(|(old, _)| version > *old) {
                        latest = Some((version, release.tag_name));
                    }
                }
            }
            if last_page {
                break;
            }
        }
        latest
            .map(|(_, tag)| {
                let mut url =
                    Url::parse("https://github.com/1Solon/shadow-cloud/releases/download/")
                        .map_err(|_| ())?;
                url.path_segments_mut()
                    .map_err(|_| ())?
                    .pop_if_empty()
                    .push(&tag)
                    .push("latest.json");
                Ok(url)
            })
            .transpose()
    }
}

#[derive(serde::Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<ReleaseAsset>,
}
#[derive(serde::Deserialize)]
struct ReleaseAsset {
    name: String,
}
fn preview_version(release: &Release, current: &Version) -> Option<Version> {
    let version = Version::parse(release.tag_name.trim_start_matches('v')).ok()?;
    (!release.draft
        && release.prerelease
        && !version.pre.is_empty()
        && version > *current
        && release
            .assets
            .iter()
            .any(|asset| asset.name == "latest.json"))
    .then_some(version)
}

fn validate_configuration(
    configuration: tauri_plugin_updater::Config,
) -> Result<tauri_plugin_updater::Config, ()> {
    if configuration.dangerous_accept_invalid_certs
        || configuration.dangerous_accept_invalid_hostnames
        || configuration.dangerous_insecure_transport_protocol
        || configuration.endpoints.is_empty()
        || configuration.endpoints.len() > 4
    {
        return Err(());
    }
    decode_key(&configuration.pubkey)?;
    for endpoint in &configuration.endpoints {
        https_url(endpoint)?;
    }
    Ok(configuration)
}
fn secure_client() -> Result<Client, ()> {
    secure_client_builder().build().map_err(|_| ())
}
fn secure_client_builder() -> reqwest::ClientBuilder {
    Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("Shadow-Cloud-Companion-Updater")
        .timeout(DOWNLOAD_TIMEOUT)
}
fn https_url(url: &Url) -> Result<(), ()> {
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(());
    }
    Ok(())
}
async fn bounded_get(
    client: &Client,
    url: Url,
    limit: usize,
    timeout: Duration,
) -> Result<Vec<u8>, ()> {
    https_url(&url)?;
    let mut response = client
        .get(url)
        .timeout(timeout)
        .send()
        .await
        .map_err(|_| ())?;
    https_url(response.url())?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|size| size > limit as u64)
    {
        return Err(());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| ())? {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err(());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
async fn cancellable<T>(
    pending: &AtomicUsize,
    timeout: Duration,
    work: impl Future<Output = Result<T, ()>>,
) -> Result<T, ()> {
    tokio::select! {
        biased;
        _ = async { while pending.load(Ordering::SeqCst) == 0 { tokio::time::sleep(Duration::from_millis(20)).await; } } => Err(()),
        result = tokio::time::timeout(timeout, work) => result.map_err(|_| ())?,
    }
}
fn same_artifact(left: &Update, right: &Update) -> bool {
    left.version == right.version
        && left.target == right.target
        && left.download_url == right.download_url
        && left.signature == right.signature
}
fn decoded(value: &str) -> Result<String, ()> {
    String::from_utf8(STANDARD.decode(value).map_err(|_| ())?).map_err(|_| ())
}
fn decode_key(value: &str) -> Result<PublicKey, ()> {
    PublicKey::decode(&decoded(value)?).map_err(|_| ())
}
fn decode_signature(value: &str) -> Result<Signature, ()> {
    Signature::decode(&decoded(value)?).map_err(|_| ())
}
fn install_verified(
    bytes: Vec<u8>,
    key: &str,
    signature: &str,
    pending: &AtomicUsize,
    install: impl FnOnce(Vec<u8>) -> Result<(), ()>,
) -> Result<(), ()> {
    if bytes.len() > PACKAGE_LIMIT || pending.load(Ordering::SeqCst) != 0 {
        return Err(());
    }
    decode_key(key)?
        .verify(&bytes, &decode_signature(signature)?, true)
        .map_err(|_| ())?;
    if pending.load(Ordering::SeqCst) != 0 {
        return Err(());
    }
    install(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    // Public test vector from minisign-verify's own upstream test suite, never a
    // release key or a key that is trusted by packaged Companion applications.
    fn signed_fixture() -> (String, String) {
        let key = "untrusted comment: minisign public key E7620F1842B4E81F\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3\n";
        let signature = "untrusted comment: signature from minisign secret key\nRUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\ntrusted comment: timestamp:1633700835\tfile:test\tprehashed\nwLMDjy9FLAuxZ3q4NlEvkgtyhrr0gtTu6KC4KBJdITbbOeAi1zBIYo0v4iTgt8jJpIidRJnp94ABQkJAgAooBQ==\n";
        (STANDARD.encode(key), STANDARD.encode(signature))
    }
    #[test]
    fn only_verified_exact_bytes_can_reach_the_native_installer() {
        let (key, signature) = signed_fixture();
        let pending = AtomicUsize::new(0);
        for bytes in [b"modified".to_vec(), b"".to_vec()] {
            assert!(
                install_verified(bytes, &key, &signature, &pending, |_| panic!(
                    "unverified install"
                ))
                .is_err()
            );
        }
        for signature in ["", "invalid"] {
            assert!(
                install_verified(b"test".to_vec(), &key, signature, &pending, |_| panic!(
                    "unsigned install"
                ))
                .is_err()
            );
        }
        let calls = AtomicUsize::new(0);
        install_verified(b"test".to_vec(), &key, &signature, &pending, |bytes| {
            assert_eq!(bytes, b"test");
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
        .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        pending.store(1, Ordering::SeqCst);
        assert!(
            install_verified(b"test".to_vec(), &key, &signature, &pending, |_| panic!(
                "install after Pause"
            ))
            .is_err()
        );
    }
    #[test]
    fn insecure_transport_and_missing_public_keys_fail_closed() {
        for url in [
            "http://example.test/update",
            "https://user:password@example.test/update",
            "file:///tmp/update",
        ] {
            assert!(https_url(&Url::parse(url).unwrap()).is_err());
        }
        let configuration: tauri_plugin_updater::Config = serde_json::from_value(
            serde_json::json!({"pubkey":"", "endpoints":["https://example.test/latest.json"]}),
        )
        .unwrap();
        assert!(validate_configuration(configuration).is_err());
    }
    #[tokio::test]
    async fn queued_commands_and_deadlines_drop_pending_update_downloads() {
        let pending = AtomicUsize::new(1);
        assert!(cancellable(&pending, Duration::from_secs(1), async {
            panic!("download polled after Pause");
            #[allow(unreachable_code)]
            Ok(())
        })
        .await
        .is_err());
        pending.store(0, Ordering::SeqCst);
        assert!(cancellable(
            &pending,
            Duration::from_millis(1),
            std::future::pending::<Result<(), ()>>()
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn pause_queued_during_download_drops_the_request_before_install_can_begin() {
        use std::sync::atomic::AtomicBool;
        struct Download(Arc<AtomicBool>);
        impl Drop for Download {
            fn drop(&mut self) {
                self.0.store(true, Ordering::SeqCst);
            }
        }
        let pending = Arc::new(AtomicUsize::new(0));
        let dropped = Arc::new(AtomicBool::new(false));
        let (started, received) = tokio::sync::oneshot::channel();
        let request_pending = pending.clone();
        let request_dropped = dropped.clone();
        let request = tokio::spawn(async move {
            cancellable(&request_pending, Duration::from_secs(5), async move {
                let _download = Download(request_dropped);
                let _ = started.send(());
                std::future::pending::<Result<(), ()>>().await
            })
            .await
        });
        received.await.unwrap();
        pending.fetch_add(1, Ordering::SeqCst);
        assert!(tokio::time::timeout(Duration::from_millis(200), request)
            .await
            .unwrap()
            .unwrap()
            .is_err());
        assert!(dropped.load(Ordering::SeqCst));
    }
    #[test]
    fn preview_discovery_excludes_drafts_stable_releases_and_missing_signed_metadata() {
        let current = Version::parse("0.16.1").unwrap();
        let mut release = Release {
            tag_name: "v0.17.0-preview.1".into(),
            draft: false,
            prerelease: true,
            assets: vec![ReleaseAsset {
                name: "latest.json".into(),
            }],
        };
        assert!(preview_version(&release, &current).is_some());
        release.draft = true;
        assert!(preview_version(&release, &current).is_none());
        release.draft = false;
        release.prerelease = false;
        assert!(preview_version(&release, &current).is_none());
        release.prerelease = true;
        release.assets.clear();
        assert!(preview_version(&release, &current).is_none());
    }

    fn tls_response(response: Vec<u8>) -> (Url, Client, std::thread::JoinHandle<()>) {
        use std::{
            io::{Read, Write},
            net::TcpListener,
        };
        let rcgen::CertifiedKey { cert, signing_key } =
            rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        let client = secure_client_builder()
            .no_proxy()
            .add_root_certificate(reqwest::Certificate::from_der(cert.der()).unwrap())
            .build()
            .unwrap();
        let configuration = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(
            vec![cert.der().clone()],
            rustls::pki_types::PrivatePkcs8KeyDer::from(signing_key.serialize_der()).into(),
        )
        .unwrap();
        let socket = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = Url::parse(&format!(
            "https://localhost:{}/package",
            socket.local_addr().unwrap().port()
        ))
        .unwrap();
        let worker = std::thread::spawn(move || {
            let (socket, _) = socket.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            socket
                .set_write_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let connection = rustls::ServerConnection::new(Arc::new(configuration)).unwrap();
            let mut tls = rustls::StreamOwned::new(connection, socket);
            let mut request = Vec::new();
            let mut buffer = [0u8; 1024];
            while !request.windows(4).any(|part| part == b"\r\n\r\n") {
                let size = tls.read(&mut buffer).unwrap();
                if size == 0 || request.len() > 16 * 1024 {
                    return;
                }
                request.extend_from_slice(&buffer[..size]);
            }
            // Update requests never carry Device-session credentials.
            assert!(!String::from_utf8_lossy(&request)
                .to_ascii_lowercase()
                .contains("authorization:"));
            let _ = tls.write_all(&response);
            let _ = tls.flush();
        });
        (url, client, worker)
    }

    #[tokio::test]
    async fn real_https_downloads_enforce_declared_and_streamed_size_limits_and_reject_downgrades()
    {
        for response in [
            b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\noversize".to_vec(),
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n8\r\noversize\r\n0\r\n\r\n".to_vec(),
            b"HTTP/1.1 302 Found\r\nLocation: http://localhost:1/insecure\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(),
        ] {
            let (url, client, server) = tls_response(response);
            assert!(bounded_get(&client, url, 4, Duration::from_secs(5)).await.is_err());
            server.join().unwrap();
        }
    }
    #[tokio::test]
    async fn a_real_https_signed_package_reaches_install_only_when_its_exact_bytes_verify() {
        let (key, signature) = signed_fixture();
        for (body, accepted) in [(b"test", true), (b"evil", false)] {
            let mut response =
                b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\n".to_vec();
            response.extend_from_slice(body);
            let (url, client, server) = tls_response(response);
            let bytes = bounded_get(&client, url, 4, Duration::from_secs(5))
                .await
                .unwrap();
            server.join().unwrap();
            let calls = AtomicUsize::new(0);
            let result = install_verified(bytes, &key, &signature, &AtomicUsize::new(0), |_| {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok(())
            });
            assert_eq!(result.is_ok(), accepted);
            assert_eq!(calls.load(Ordering::SeqCst), usize::from(accepted));
        }
    }
}
