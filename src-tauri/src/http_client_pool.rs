use crate::{
    es_http_client_builder_with_ca, resolve_tls_mode, ConnectionTlsConfig, ConnectionTlsMode,
};
use reqwest::blocking::Client;
use sha2::{Digest, Sha256};
use std::{
    collections::VecDeque,
    fs,
    path::PathBuf,
    sync::{LazyLock, Mutex},
    time::Duration,
};

#[derive(Clone, Debug, PartialEq, Eq)]
enum ClientKey {
    Default,
    Insecure,
    Fingerprint(String),
    Ca(PathBuf, Vec<u8>),
}
#[derive(Default)]
struct PoolState {
    es: VecDeque<(ClientKey, Client)>,
    ai: Option<Client>,
}
#[derive(Default)]
pub(crate) struct HttpClientPool {
    state: Mutex<PoolState>,
    #[cfg(test)]
    build_count: std::sync::atomic::AtomicUsize,
}
pub(crate) static HTTP_CLIENT_POOL: LazyLock<HttpClientPool> =
    LazyLock::new(HttpClientPool::default);

impl HttpClientPool {
    #[cfg(test)]
    pub(crate) fn benchmark_build_count(&self) -> usize {
        self.build_count.load(std::sync::atomic::Ordering::Relaxed)
    }

    pub(crate) fn es_client(
        &self,
        tls: Option<&ConnectionTlsConfig>,
        insecure_tls: bool,
    ) -> Result<Client, String> {
        let mut ca_bytes = None;
        let key = match resolve_tls_mode(tls, insecure_tls) {
            ConnectionTlsMode::Default => ClientKey::Default,
            ConnectionTlsMode::Insecure => ClientKey::Insecure,
            ConnectionTlsMode::CertificateFingerprint => ClientKey::Fingerprint(
                tls.and_then(|tls| tls.fingerprint.as_deref())
                    .unwrap_or("")
                    .trim()
                    .into(),
            ),
            ConnectionTlsMode::CaCertificate => {
                let path = tls
                    .and_then(|tls| tls.ca_path.as_deref())
                    .map(str::trim)
                    .filter(|path| !path.is_empty())
                    .ok_or("CA 证书模式需要提供证书路径。")?;
                let path = fs::canonicalize(path)
                    .map_err(|error| format!("无法读取 CA 证书 {path}：{error}"))?;
                let bytes = fs::read(&path)
                    .map_err(|error| format!("无法读取 CA 证书 {}：{error}", path.display()))?;
                let digest = Sha256::digest(&bytes).to_vec();
                ca_bytes = Some(bytes);
                ClientKey::Ca(path, digest)
            }
        };
        {
            let mut state = self.state.lock().map_err(|_| "HTTP 客户端池不可用。")?;
            if let Some(index) = state.es.iter().position(|(candidate, _)| candidate == &key) {
                let entry = state.es.remove(index).unwrap();
                let client = entry.1.clone();
                state.es.push_back(entry);
                return Ok(client);
            }
        }
        // 证书读取、客户端构建和网络请求均不得持有缓存锁。
        let builder = es_http_client_builder_with_ca(tls, insecure_tls, ca_bytes.as_deref())?;
        // 本地 fixture 不经过开发机的系统代理，生产环境保持现有代理行为。
        #[cfg(test)]
        let builder = builder.no_proxy();
        let client = builder
            .build()
            .map_err(|error| format!("无法创建 Elasticsearch HTTP 客户端：{error}"))?;
        #[cfg(test)]
        self.build_count
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let mut state = self.state.lock().map_err(|_| "HTTP 客户端池不可用。")?;
        if let Some(index) = state.es.iter().position(|(candidate, _)| candidate == &key) {
            let entry = state.es.remove(index).unwrap();
            let cached = entry.1.clone();
            state.es.push_back(entry);
            return Ok(cached);
        }
        if let ClientKey::Ca(path, _) = &key {
            state.es.retain(|(candidate, _)| !matches!(candidate, ClientKey::Ca(old_path, _) if old_path == path));
        }
        while state.es.len() >= 8 {
            state.es.pop_front();
        }
        state.es.push_back((key, client.clone()));
        Ok(client)
    }

    pub(crate) fn ai_client(&self) -> Result<Client, String> {
        if let Some(client) = self
            .state
            .lock()
            .map_err(|_| "HTTP 客户端池不可用。")?
            .ai
            .clone()
        {
            return Ok(client);
        }
        let client = Client::builder()
            .timeout(Duration::from_secs(120))
            .connect_timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| format!("无法创建 AI HTTP 客户端：{error}"))?;
        let mut state = self.state.lock().map_err(|_| "HTTP 客户端池不可用。")?;
        Ok(state.ai.get_or_insert(client).clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader, Write},
        net::TcpListener,
        sync::atomic::Ordering,
        time::Instant,
    };
    fn tls(mode: ConnectionTlsMode, path: Option<String>) -> ConnectionTlsConfig {
        ConnectionTlsConfig {
            mode: Some(mode),
            ca_path: path,
            fingerprint: Some("00".repeat(32)),
        }
    }
    fn fixture_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("esx-pool-{}-{name}.pem", std::process::id()))
    }
    #[test]
    fn different_tls_modes_are_isolated() {
        let pool = HttpClientPool::default();
        let first = fixture_path("isolation-a");
        let second = fixture_path("isolation-b");
        fs::write(&first, include_bytes!("fixtures/pool-ca-a.pem")).unwrap();
        fs::write(&second, include_bytes!("fixtures/pool-ca-b.pem")).unwrap();
        let configs = [
            tls(ConnectionTlsMode::Default, None),
            tls(ConnectionTlsMode::Insecure, None),
            tls(ConnectionTlsMode::CertificateFingerprint, None),
            tls(
                ConnectionTlsMode::CaCertificate,
                Some(first.to_string_lossy().into()),
            ),
            tls(
                ConnectionTlsMode::CaCertificate,
                Some(second.to_string_lossy().into()),
            ),
        ];
        for config in &configs {
            pool.es_client(Some(config), false).unwrap();
        }
        for config in &configs {
            pool.es_client(Some(config), false).unwrap();
        }
        assert_eq!(pool.build_count.load(Ordering::Relaxed), 5);
        fs::remove_file(first).unwrap();
        fs::remove_file(second).unwrap();
    }
    #[test]
    fn ca_rotation_invalidates_only_its_client() {
        let pool = HttpClientPool::default();
        let path = fixture_path("rotation");
        let a = include_bytes!("fixtures/pool-ca-a.pem");
        let b = include_bytes!("fixtures/pool-ca-b.pem");
        assert_eq!(a.len(), b.len());
        fs::write(&path, a).unwrap();
        let modified = fs::metadata(&path).unwrap().modified().unwrap();
        let config = tls(
            ConnectionTlsMode::CaCertificate,
            Some(path.to_string_lossy().into()),
        );
        pool.es_client(None, false).unwrap();
        pool.es_client(Some(&config), false).unwrap();
        fs::write(&path, b).unwrap();
        fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(modified))
            .unwrap();
        assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), modified);
        pool.es_client(Some(&config), false).unwrap();
        pool.es_client(None, false).unwrap();
        assert_eq!(pool.build_count.load(Ordering::Relaxed), 3);
        assert_eq!(pool.state.lock().unwrap().es.len(), 2);
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn lru_is_bounded_and_refreshes_hits() {
        let pool = HttpClientPool::default();
        for i in 0..8 {
            let mut config = tls(ConnectionTlsMode::CertificateFingerprint, None);
            config.fingerprint = Some(format!("{i:064x}"));
            pool.es_client(Some(&config), false).unwrap();
        }
        let mut hot = tls(ConnectionTlsMode::CertificateFingerprint, None);
        hot.fingerprint = Some(format!("{:064x}", 0));
        pool.es_client(Some(&hot), false).unwrap();
        pool.es_client(None, false).unwrap();
        pool.es_client(Some(&hot), false).unwrap();
        assert_eq!(pool.state.lock().unwrap().es.len(), 8);
        assert_eq!(pool.build_count.load(Ordering::Relaxed), 9);
    }
    #[test]
    fn same_config_reuses_keepalive_connection() {
        let pool = HttpClientPool::default();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            let mut stream = BufReader::new(stream);
            let mut headers = Vec::new();
            for _ in 0..20 {
                let mut request = String::new();
                loop {
                    let mut line = String::new();
                    stream.read_line(&mut line).unwrap();
                    if line == "\r\n" {
                        break;
                    }
                    assert!(!line.is_empty());
                    request.push_str(&line);
                }
                headers.push(request);
                stream
                    .get_mut()
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\n{}",
                    )
                    .unwrap();
            }
            headers
        });
        let mut times = Vec::new();
        for i in 0..20 {
            let started = Instant::now();
            let client = pool.es_client(None, false).unwrap();
            let request = client
                .get(format!("http://{addr}/"))
                .header("Authorization", format!("Bearer fixture-{i}"));
            let response = request.send().unwrap();
            assert_eq!(
                response.status(),
                reqwest::StatusCode::OK,
                "{:?}",
                response.headers()
            );
            assert_eq!(response.text().unwrap(), "{}");
            times.push(started.elapsed().as_micros());
        }
        let headers = server.join().unwrap();
        for (i, header) in headers.iter().enumerate() {
            assert!(header
                .to_ascii_lowercase()
                .contains(&format!("authorization: bearer fixture-{i}\r\n")));
        }
        let plain = pool
            .es_client(None, false)
            .unwrap()
            .get(format!("http://{addr}/"))
            .build()
            .unwrap();
        assert!(!plain.headers().contains_key("Authorization"));
        assert_eq!(pool.build_count.load(Ordering::Relaxed), 1);
        times.sort_unstable();
        eprintln!(
            "fixture requests=20 accepts=1 builds=1 p50_us={} p95_us={}",
            times[9], times[18]
        );
    }
    #[test]
    fn non_success_es_response_uses_bounded_preview() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut stream = BufReader::new(stream);
            loop {
                let mut line = String::new();
                stream.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                assert!(!line.is_empty());
            }
            stream.get_mut().write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 10\r\nConnection: close\r\n\r\nerror-body").unwrap();
        });
        let payload = serde_json::from_value(serde_json::json!({
            "baseUrl": url, "url": url, "method": "GET", "username": "fixture-user",
            "password": "fixture-password", "bodyText": "", "insecureTls": false,
            "readMode": "preview", "previewBytes": 5
        }))
        .unwrap();
        let response = crate::perform_es_http_request(payload).unwrap();
        assert_eq!(response.status, 400);
        assert!(!response.ok);
        assert_eq!(response.body_text, "error");
        assert_eq!(response.total_bytes, 10);
        assert!(response.truncated);
        server.join().unwrap();
    }
}
