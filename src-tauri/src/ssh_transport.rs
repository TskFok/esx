#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preview_lossy_utf8_obeys_output_byte_limit() {
        for (limit, bytes) in [(2, vec![0xff, 0xff]), (3, vec![0xff, 0xe4, 0xb8, 0xad])] {
            let mut output = Output::new(Some(limit));
            output.push(&bytes);
            output.push(b"\n__ESX_STATUS__:200\n");
            let response = output.finish().unwrap();
            assert!(response.body.len() <= limit);
            assert!(response.truncated);
        }
    }

    #[test]
    fn cancelled_checkout_does_not_read_private_key() {
        let config: SshTunnelConfig = serde_json::from_value(serde_json::json!({
            "host":"localhost", "port":22, "username":"test", "authMethod":"privateKey",
            "privateKeyPath":"/nonexistent/esx-private-key", "trustedHostKeySha256":"a"
        }))
        .unwrap();
        let error = SshSessionPool::default()
            .checkout(&config, None, &Arc::new(AtomicBool::new(true)))
            .err()
            .unwrap();
        assert!(error.contains("取消"), "{error}");
    }

    #[test]
    fn oversized_private_key_is_rejected_before_connector() {
        let path =
            std::env::temp_dir().join(format!("esx-review-large-key-{}", std::process::id()));
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(1024 * 1024 + 1).unwrap();
        let config: SshTunnelConfig = serde_json::from_value(serde_json::json!({
            "host":"localhost", "port":22, "username":"test", "authMethod":"privateKey",
            "privateKeyPath":path.to_str().unwrap(), "trustedHostKeySha256":"a"
        }))
        .unwrap();
        let calls = std::cell::Cell::new(0);
        let pool = SshSessionPool::default();
        let result = pool.checkout_with(
            &config,
            None,
            &Arc::new(AtomicBool::new(false)),
            Instant::now() + TOTAL_TIMEOUT,
            |_| {
                calls.set(calls.get() + 1);
                Session::new()
                    .map(Connection::fixture)
                    .map_err(|e| e.to_string())
            },
            |_| Ok(()),
        );
        std::fs::remove_file(path).unwrap();
        assert!(result.is_err());
        assert_eq!(calls.get(), 0);
    }
    #[test]
    fn preview_preserves_status_and_excludes_trailer() {
        let mut output = Output::new(Some(4));
        for chunk in b"abcdefgh\n__ESX_STATUS__:201\n".chunks(3) {
            output.push(chunk);
        }
        let result = output.finish().unwrap();
        assert_eq!(
            (
                result.status,
                result.total_bytes,
                result.body.as_str(),
                result.truncated
            ),
            (201, 8, "abcd", true)
        );
    }
    #[test]
    fn invalid_trailer_is_rejected() {
        let mut output = Output::new(Some(4));
        output.push(b"abcdef");
        assert!(output.finish().is_err());
    }
    #[test]
    fn cancelled_operation_never_runs() {
        let cancel = Arc::new(AtomicBool::new(true));
        let mut calls = 0;
        assert!(
            retry_nonblocking(&cancel, Instant::now() + TOTAL_TIMEOUT, || {
                calls += 1;
                Ok(())
            })
            .is_err()
        );
        assert_eq!(calls, 0);
    }
}

use crate::{authenticate_ssh, require_ssh_trusted_key, verify_ssh_host_key, SshTunnelConfig};
use ring::{
    hmac,
    rand::{SecureRandom, SystemRandom},
};
use ssh2::{ErrorCode, Session};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::TcpStream,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, LazyLock, Mutex,
    },
    time::{Duration, Instant},
};
pub type CancellationToken = Arc<AtomicBool>;
pub const TOTAL_TIMEOUT: Duration = Duration::from_secs(75);
const POLL: Duration = Duration::from_millis(20);
#[derive(Default)]
struct Requests {
    active: HashMap<String, CancellationToken>,
    early: HashMap<String, Instant>,
}
static REQUESTS: LazyLock<Mutex<Requests>> = LazyLock::new(Default::default);
static DNS_RUNTIME: LazyLock<tokio::runtime::Runtime> = LazyLock::new(|| {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .enable_all()
        .build()
        .expect("无法初始化 SSH DNS 运行时")
});
static DNS_SLOTS: LazyLock<Arc<tokio::sync::Semaphore>> =
    LazyLock::new(|| Arc::new(tokio::sync::Semaphore::new(4)));
async fn wait_dns<T>(
    cancel: &CancellationToken,
    deadline: Instant,
    future: impl std::future::Future<Output = T>,
) -> Result<T, String> {
    tokio::pin!(future);
    loop {
        if cancel.load(Ordering::Acquire) {
            return Err("SSH 请求已取消。".into());
        }
        if Instant::now() >= deadline {
            return Err("SSH DNS 解析超时。".into());
        }
        tokio::select! {
            result = &mut future => return Ok(result),
            _ = tokio::time::sleep(POLL.min(deadline.saturating_duration_since(Instant::now()))) => {}
        }
    }
}
async fn resolve_with<T: Send + 'static>(
    slots: Arc<tokio::sync::Semaphore>,
    cancel: &CancellationToken,
    deadline: Instant,
    work: impl std::future::Future<Output = Result<T, String>> + Send + 'static,
) -> Result<T, String> {
    let permit = wait_dns(cancel, deadline, slots.acquire_owned())
        .await?
        .map_err(|e| e.to_string())?;
    check(cancel, deadline)?;
    // 调用者超时只分离等待，许可由实际解析任务持有到 lookup_host 完成。
    let task = tokio::spawn(async move {
        let _permit = permit;
        work.await
    });
    wait_dns(cancel, deadline, task)
        .await?
        .map_err(|e| e.to_string())?
}
static WORK_SLOTS: LazyLock<Arc<tokio::sync::Semaphore>> =
    LazyLock::new(|| Arc::new(tokio::sync::Semaphore::new(4)));
pub async fn admit(
    cancel: &CancellationToken,
    deadline: Instant,
) -> Result<tokio::sync::OwnedSemaphorePermit, String> {
    admit_with(WORK_SLOTS.clone(), cancel, deadline).await
}
pub async fn await_work<T, E: std::fmt::Display>(
    cancel: &CancellationToken,
    deadline: Instant,
    work: impl std::future::Future<Output = Result<T, E>>,
) -> Result<T, String> {
    match tokio::time::timeout(deadline.saturating_duration_since(Instant::now()), work).await {
        Ok(result) => result.map_err(|e| e.to_string()),
        Err(_) => {
            cancel.store(true, Ordering::Release);
            Err("SSH 请求超过总时间限制。".into())
        }
    }
}
async fn admit_with(
    slots: Arc<tokio::sync::Semaphore>,
    cancel: &CancellationToken,
    deadline: Instant,
) -> Result<tokio::sync::OwnedSemaphorePermit, String> {
    let wait_until = stage_deadline(Instant::now(), deadline, Duration::from_secs(2));
    let acquire = slots.acquire_owned();
    tokio::pin!(acquire);
    loop {
        check(cancel, wait_until)?;
        tokio::select! {
            permit = &mut acquire => return permit.map_err(|e| e.to_string()),
            _ = tokio::time::sleep(POLL.min(wait_until.saturating_duration_since(Instant::now()))) => {}
        }
    }
}
fn stage_deadline(now: Instant, total_deadline: Instant, limit: Duration) -> Instant {
    total_deadline.min(now + limit)
}
fn blocking_timeout_ms(now: Instant, total_deadline: Instant) -> u32 {
    stage_deadline(now, total_deadline, Duration::from_secs(15))
        .saturating_duration_since(now)
        .as_millis()
        .max(1) as u32
}
pub struct Registration {
    id: Option<String>,
    pub cancel: CancellationToken,
}
impl Registration {
    pub fn new(id: Option<String>) -> Result<Self, String> {
        let cancel = Arc::new(AtomicBool::new(false));
        if let Some(id) = &id {
            let mut requests = REQUESTS.lock().unwrap();
            if requests.active.contains_key(id) {
                return Err("重复的 SSH 请求标识。".into());
            }
            requests
                .early
                .retain(|_, time| time.elapsed() < Duration::from_secs(60));
            if requests.early.remove(id).is_some() {
                cancel.store(true, Ordering::Release);
            }
            requests.active.insert(id.clone(), cancel.clone());
        }
        Ok(Self { id, cancel })
    }
}
impl Drop for Registration {
    fn drop(&mut self) {
        if let Some(id) = &self.id {
            REQUESTS.lock().unwrap().active.remove(id);
        }
    }
}
pub fn cancel(id: &str) {
    let mut requests = REQUESTS.lock().unwrap();
    if let Some(token) = requests.active.get(id) {
        token.store(true, Ordering::Release);
    } else {
        requests
            .early
            .retain(|_, time| time.elapsed() < Duration::from_secs(60));
        if requests.early.len() >= 256 {
            if let Some(oldest) = requests
                .early
                .iter()
                .min_by_key(|(_, time)| **time)
                .map(|(id, _)| id.clone())
            {
                requests.early.remove(&oldest);
            }
        }
        requests.early.insert(id.to_string(), Instant::now());
    }
}

fn check(cancel: &CancellationToken, deadline: Instant) -> Result<(), String> {
    if cancel.load(Ordering::Acquire) {
        return Err("SSH 请求已取消。".into());
    }
    if Instant::now() >= deadline {
        return Err("SSH 请求超过总时间限制。".into());
    }
    Ok(())
}
fn retry_nonblocking<T>(
    cancel: &CancellationToken,
    deadline: Instant,
    mut operation: impl FnMut() -> Result<T, ssh2::Error>,
) -> Result<T, String> {
    loop {
        check(cancel, deadline)?;
        match operation() {
            Ok(value) => return Ok(value),
            Err(e) if e.code() == ErrorCode::Session(-37) => std::thread::sleep(POLL),
            Err(e) => return Err(e.to_string()),
        }
    }
}
const MAX_PRIVATE_KEY_BYTES: u64 = 1024 * 1024;
fn read_private_key(
    config: &SshTunnelConfig,
    cancel: &CancellationToken,
    deadline: Instant,
) -> Result<Option<Vec<u8>>, String> {
    check(cancel, deadline)?;
    if !matches!(config.auth_method, crate::SshAuthMethod::PrivateKey) {
        return Ok(None);
    }
    let path = config.private_key_path.trim();
    let validate = |metadata: &std::fs::Metadata| {
        if !metadata.is_file() {
            return Err("SSH 私钥必须为普通文件。".to_string());
        }
        if metadata.len() > MAX_PRIVATE_KEY_BYTES {
            return Err("SSH 私钥文件超过 1 MiB 限制。".to_string());
        }
        Ok(())
    };
    validate(&std::fs::metadata(path).map_err(|e| e.to_string())?)?;
    check(cancel, deadline)?;
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    validate(&file.metadata().map_err(|e| e.to_string())?)?;
    let mut bytes = Vec::new();
    let mut chunk = [0; 8192];
    loop {
        check(cancel, deadline)?;
        let size = file.read(&mut chunk).map_err(|e| e.to_string())?;
        if size == 0 {
            break;
        }
        if bytes.len() as u64 + size as u64 > MAX_PRIVATE_KEY_BYTES {
            return Err("SSH 私钥文件超过 1 MiB 限制。".into());
        }
        bytes.extend_from_slice(&chunk[..size]);
    }
    Ok(Some(bytes))
}
pub struct Connection {
    session: Session,
    socket: Option<TcpStream>,
    cacheable: bool,
}
impl std::ops::Deref for Connection {
    type Target = Session;
    fn deref(&self) -> &Session {
        &self.session
    }
}
impl Connection {
    fn shutdown(&self) {
        if let Some(socket) = &self.socket {
            let _ = socket.shutdown(std::net::Shutdown::Both);
        }
    }
    #[cfg(test)]
    fn fixture(session: Session) -> Self {
        Self {
            session,
            socket: None,
            cacheable: true,
        }
    }
}
impl Drop for Connection {
    fn drop(&mut self) {
        self.shutdown();
    }
}
struct ChannelCleanup<'a> {
    connection: &'a Connection,
    complete: bool,
}
impl Drop for ChannelCleanup<'_> {
    fn drop(&mut self) {
        if !self.complete {
            self.connection.shutdown();
        }
    }
}
fn connect_with_key(
    config: &SshTunnelConfig,
    secret: Option<&str>,
    cancel: &CancellationToken,
    deadline: Instant,
    validation: bool,
    private_key: Option<&[u8]>,
) -> Result<Connection, String> {
    require_ssh_trusted_key(config, validation)?;
    check(cancel, deadline)?;
    let host = config.host.clone();
    let port = config.port;
    let addresses = DNS_RUNTIME.block_on(resolve_with(
        DNS_SLOTS.clone(),
        cancel,
        stage_deadline(Instant::now(), deadline, Duration::from_secs(5)),
        async move {
            tokio::net::lookup_host((host.as_str(), port))
                .await
                .map(|addresses| addresses.collect::<Vec<_>>())
                .map_err(|e| e.to_string())
        },
    ))?;
    let tcp_deadline = stage_deadline(Instant::now(), deadline, Duration::from_secs(10));
    let mut connection = None;
    for address in addresses {
        check(cancel, tcp_deadline)?;
        match TcpStream::connect_timeout(
            &address,
            tcp_deadline.saturating_duration_since(Instant::now()),
        ) {
            Ok(stream) => {
                connection = Some(stream);
                break;
            }
            Err(_) => continue,
        }
    }
    let tcp = connection.ok_or_else(|| "无法在连接期限内连接 SSH 主机。".to_string())?;
    tcp.set_read_timeout(Some(Duration::from_secs(15)))
        .map_err(|e| e.to_string())?;
    tcp.set_write_timeout(Some(Duration::from_secs(15)))
        .map_err(|e| e.to_string())?;
    let socket = tcp.try_clone().map_err(|e| e.to_string())?;
    let mut session = Session::new().map_err(|e| e.to_string())?;
    session.set_tcp_stream(tcp);
    session.set_timeout(blocking_timeout_ms(Instant::now(), deadline));
    check(cancel, deadline)?;
    session
        .handshake()
        .map_err(|e| format!("SSH 握手失败：{e}"))?;
    check(cancel, deadline)?;
    verify_ssh_host_key(
        config,
        session.host_key_hash(ssh2::HashType::Sha256),
        validation,
    )?;
    session.set_timeout(blocking_timeout_ms(Instant::now(), deadline));
    #[cfg(not(unix))]
    if read_private_key(config, cancel, deadline)?.as_deref() != private_key {
        return Err("SSH 私钥在认证前发生变化。".into());
    }
    authenticate_ssh(&session, config, secret, private_key)?;
    #[cfg(not(unix))]
    if read_private_key(config, cancel, deadline)?.as_deref() != private_key {
        return Err("SSH 私钥在认证期间发生变化。".into());
    }
    check(cancel, deadline)?;
    session.set_blocking(false);
    Ok(Connection {
        session,
        socket: Some(socket),
        cacheable: cfg!(unix) || !matches!(config.auth_method, crate::SshAuthMethod::PrivateKey),
    })
}
struct Idle {
    session: Connection,
    key: String,
    tag: Vec<u8>,
    since: Instant,
}
#[derive(Default)]
struct PoolState {
    total: usize,
    idle: Vec<Idle>,
}
pub struct SshSessionPool {
    state: Mutex<PoolState>,
    hmac_key: hmac::Key,
}
impl Default for SshSessionPool {
    fn default() -> Self {
        let mut secret = [0; 32];
        SystemRandom::new()
            .fill(&mut secret)
            .expect("无法初始化 SSH 会话凭据校验");
        Self {
            state: Mutex::new(PoolState::default()),
            hmac_key: hmac::Key::new(hmac::HMAC_SHA256, &secret),
        }
    }
}
pub static POOL: LazyLock<SshSessionPool> = LazyLock::new(SshSessionPool::default);
fn pool_key(config: &SshTunnelConfig) -> Result<String, String> {
    let version = if matches!(config.auth_method, crate::SshAuthMethod::PrivateKey) {
        let metadata = std::fs::metadata(config.private_key_path.trim())
            .map_err(|e| format!("读取 SSH 私钥版本失败：{e}"))?;
        format!(
            "{}:{:?}",
            metadata.len(),
            metadata.modified().map_err(|e| e.to_string())?
        )
    } else {
        String::new()
    };
    Ok(format!("{config:?}:{version}"))
}
pub struct SshLease<'a> {
    pool: &'a SshSessionPool,
    session: Option<Connection>,
    key: String,
    tag: Vec<u8>,
    reusable: bool,
}
impl SshLease<'_> {
    pub fn session(&self) -> &Connection {
        self.session.as_ref().unwrap()
    }
    pub fn reuse(&mut self) {
        // 文件认证无法保证跨平台内容快照，禁止缓存潜在轮换期间的身份。
        self.reusable = self.session().cacheable;
    }
}
impl Drop for SshLease<'_> {
    fn drop(&mut self) {
        if self.reusable {
            let mut state = self.pool.state.lock().unwrap();
            state.idle.push(Idle {
                session: self.session.take().unwrap(),
                key: self.key.clone(),
                tag: self.tag.clone(),
                since: Instant::now(),
            });
        } else {
            // 先在锁外释放真实连接，容量不能早于资源归还。
            drop(self.session.take());
            self.pool.state.lock().unwrap().total -= 1;
        }
    }
}
impl SshSessionPool {
    #[cfg(test)]
    fn credential_tag(
        &self,
        config: &SshTunnelConfig,
        secret: Option<&str>,
    ) -> Result<Vec<u8>, String> {
        let private_key = read_private_key(
            config,
            &Arc::new(AtomicBool::new(false)),
            Instant::now() + TOTAL_TIMEOUT,
        )?;
        Ok(self.tag_for_key(secret, private_key.as_deref()))
    }
    fn tag_for_key(&self, secret: Option<&str>, private_key: Option<&[u8]>) -> Vec<u8> {
        let mut context = hmac::Context::with_key(&self.hmac_key);
        let secret = secret.unwrap_or("").as_bytes();
        context.update(&(secret.len() as u64).to_be_bytes());
        context.update(secret);
        if let Some(bytes) = private_key {
            context.update(bytes);
        }
        context.sign().as_ref().to_vec()
    }
    #[cfg(test)]
    pub fn checkout(
        &self,
        config: &SshTunnelConfig,
        secret: Option<&str>,
        cancel: &CancellationToken,
    ) -> Result<SshLease<'_>, String> {
        self.checkout_until(config, secret, cancel, Instant::now() + TOTAL_TIMEOUT)
    }
    pub fn checkout_until(
        &self,
        config: &SshTunnelConfig,
        secret: Option<&str>,
        cancel: &CancellationToken,
        deadline: Instant,
    ) -> Result<SshLease<'_>, String> {
        self.checkout_with_policy(
            false,
            config,
            secret,
            cancel,
            deadline,
            |private_key| connect_with_key(config, secret, cancel, deadline, false, private_key),
            |session| {
                verify_ssh_host_key(config, session.host_key_hash(ssh2::HashType::Sha256), false)
                    .map(|_| ())
            },
        )
    }
    pub fn validation_until(
        &self,
        config: &SshTunnelConfig,
        secret: Option<&str>,
        cancel: &CancellationToken,
        deadline: Instant,
    ) -> Result<SshLease<'_>, String> {
        self.checkout_with_policy(
            true,
            config,
            secret,
            cancel,
            deadline,
            |private_key| connect_with_key(config, secret, cancel, deadline, true, private_key),
            |session| {
                verify_ssh_host_key(config, session.host_key_hash(ssh2::HashType::Sha256), true)
                    .map(|_| ())
            },
        )
    }
    #[cfg(test)]
    fn checkout_with(
        &self,
        config: &SshTunnelConfig,
        secret: Option<&str>,
        cancel: &CancellationToken,
        deadline: Instant,
        connector: impl FnMut(Option<&[u8]>) -> Result<Connection, String>,
        verifier: impl Fn(&Session) -> Result<(), String>,
    ) -> Result<SshLease<'_>, String> {
        self.checkout_with_policy(false, config, secret, cancel, deadline, connector, verifier)
    }
    fn checkout_with_policy(
        &self,
        allow_first_use: bool,
        config: &SshTunnelConfig,
        secret: Option<&str>,
        cancel: &CancellationToken,
        deadline: Instant,
        mut connector: impl FnMut(Option<&[u8]>) -> Result<Connection, String>,
        verifier: impl Fn(&Session) -> Result<(), String>,
    ) -> Result<SshLease<'_>, String> {
        require_ssh_trusted_key(config, allow_first_use)?;
        check(cancel, deadline)?;
        let private_key = read_private_key(config, cancel, deadline)?;
        let key = pool_key(config)?;
        let tag = self.tag_for_key(secret, private_key.as_deref());
        let wait_until = stage_deadline(Instant::now(), deadline, Duration::from_secs(2));
        loop {
            check(cancel, wait_until)?;
            let mut state = self.state.lock().unwrap();
            let mut expired = Vec::new();
            let mut index = 0;
            while index < state.idle.len() {
                if state.idle[index].since.elapsed() >= Duration::from_secs(60) {
                    expired.push(state.idle.swap_remove(index));
                } else {
                    index += 1;
                }
            }
            if !expired.is_empty() {
                let count = expired.len();
                drop(state);
                drop(expired);
                self.state.lock().unwrap().total -= count;
                continue;
            }
            if let Some(index) = state
                .idle
                .iter()
                .position(|entry| entry.key == key && entry.tag == tag)
            {
                let idle = state.idle.swap_remove(index);
                drop(state);
                let lease = SshLease {
                    pool: self,
                    session: Some(idle.session),
                    key,
                    tag,
                    reusable: false,
                };
                verifier(lease.session())?;
                return Ok(lease);
            }
            if state.total == 4 && !state.idle.is_empty() {
                let evicted = state.idle.pop();
                drop(state);
                drop(evicted);
                self.state.lock().unwrap().total -= 1;
                continue;
            }
            if state.total < 4 {
                state.total += 1;
                drop(state);
                let mut lease = SshLease {
                    pool: self,
                    session: None,
                    key,
                    tag,
                    reusable: false,
                };
                lease.session = Some(connector(private_key.as_deref())?);
                return Ok(lease);
            }
            drop(state);
            std::thread::sleep(POLL);
        }
    }
}
pub struct Response {
    pub status: u16,
    pub body: String,
    pub total_bytes: u64,
    pub truncated: bool,
    pub stderr: String,
}
#[derive(Debug)]
struct Output {
    prefix: Vec<u8>,
    tail: Vec<u8>,
    total: u64,
    limit: Option<usize>,
}
impl Output {
    fn new(limit: Option<usize>) -> Self {
        Self {
            prefix: Vec::new(),
            tail: Vec::new(),
            total: 0,
            limit,
        }
    }
    fn push(&mut self, bytes: &[u8]) {
        self.total = self.total.saturating_add(bytes.len() as u64);
        let retain = self
            .limit
            .map(|max| max.saturating_sub(self.prefix.len()).min(bytes.len()))
            .unwrap_or(bytes.len());
        self.prefix.extend_from_slice(&bytes[..retain]);
        if bytes.len() >= 64 {
            self.tail.clear();
            self.tail.extend_from_slice(&bytes[bytes.len() - 64..]);
        } else {
            self.tail.extend_from_slice(bytes);
            if self.tail.len() > 64 {
                self.tail.drain(..self.tail.len() - 64);
            }
        }
    }
    fn finish(mut self) -> Result<Response, String> {
        let marker = b"\n__ESX_STATUS__:";
        let offset = self
            .tail
            .windows(marker.len())
            .rposition(|window| window == marker)
            .ok_or_else(|| "远程 curl 缺少 HTTP 状态尾标记。".to_string())?;
        let suffix = &self.tail[offset + marker.len()..];
        if suffix.len() != 4 || suffix[3] != b'\n' {
            return Err("远程 curl 状态尾标记无效。".into());
        }
        let status = std::str::from_utf8(&suffix[..3])
            .map_err(|e| e.to_string())?
            .parse::<u16>()
            .map_err(|e| e.to_string())?;
        if !(100..=599).contains(&status) {
            return Err("远程 curl 未返回有效 HTTP 状态。".into());
        }
        let total_bytes = self.total - (self.tail.len() - offset) as u64;
        if total_bytes > 9_007_199_254_740_991 {
            return Err("SSH 响应字节数超过 JavaScript 安全整数范围。".into());
        }
        self.prefix
            .truncate(total_bytes.min(self.prefix.len() as u64) as usize);
        let mut truncated = (self.prefix.len() as u64) < total_bytes;
        if truncated {
            let mut offset = 0;
            while let Err(error) = std::str::from_utf8(&self.prefix[offset..]) {
                offset += error.valid_up_to();
                match error.error_len() {
                    Some(length) => offset += length,
                    None => {
                        self.prefix.truncate(offset);
                        break;
                    }
                }
            }
        }
        let mut body = String::from_utf8_lossy(&self.prefix).into_owned();
        if let Some(limit) = self.limit {
            if body.len() > limit {
                let mut end = limit;
                while !body.is_char_boundary(end) {
                    end -= 1;
                }
                body.truncate(end);
                truncated = true;
            }
        }
        Ok(Response {
            status,
            body,
            total_bytes,
            truncated,
            stderr: String::new(),
        })
    }
}
trait ChannelIo {
    fn exec(&mut self, command: &str) -> Result<(), ssh2::Error>;
    fn write_input(&mut self, bytes: &[u8]) -> std::io::Result<usize>;
    fn send_eof(&mut self) -> Result<(), ssh2::Error>;
    fn read_stream(&mut self, stream: usize, bytes: &mut [u8]) -> std::io::Result<usize>;
    fn close(&mut self) -> Result<(), ssh2::Error>;
    fn wait_close(&mut self) -> Result<(), ssh2::Error>;
    fn exit_status(&self) -> Result<i32, ssh2::Error>;
}
impl ChannelIo for ssh2::Channel {
    fn exec(&mut self, command: &str) -> Result<(), ssh2::Error> {
        ssh2::Channel::exec(self, command)
    }
    fn write_input(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        Write::write(self, bytes)
    }
    fn send_eof(&mut self) -> Result<(), ssh2::Error> {
        ssh2::Channel::send_eof(self)
    }
    fn read_stream(&mut self, stream: usize, bytes: &mut [u8]) -> std::io::Result<usize> {
        if stream == 0 {
            Read::read(self, bytes)
        } else {
            self.stderr().read(bytes)
        }
    }
    fn close(&mut self) -> Result<(), ssh2::Error> {
        ssh2::Channel::close(self)
    }
    fn wait_close(&mut self) -> Result<(), ssh2::Error> {
        ssh2::Channel::wait_close(self)
    }
    fn exit_status(&self) -> Result<i32, ssh2::Error> {
        ssh2::Channel::exit_status(self)
    }
}
pub fn execute(
    session: &Connection,
    command: &str,
    script: &str,
    limit: Option<usize>,
    cancel: &CancellationToken,
    deadline: Instant,
) -> Result<Response, String> {
    let mut channel = retry_nonblocking(cancel, deadline, || session.channel_session())?;
    // 必须在 channel 析构前关闭失败传输，让 libssh2 free 不再等待远端 CLOSE。
    let mut cleanup = ChannelCleanup {
        connection: session,
        complete: false,
    };
    let result = execute_channel(&mut channel, command, script, limit, cancel, deadline);
    cleanup.complete = result.is_ok();
    result
}
fn execute_channel(
    channel: &mut impl ChannelIo,
    command: &str,
    script: &str,
    limit: Option<usize>,
    cancel: &CancellationToken,
    deadline: Instant,
) -> Result<Response, String> {
    retry_nonblocking(cancel, deadline, || channel.exec(command))?;
    let mut remaining = script.as_bytes();
    while !remaining.is_empty() {
        check(cancel, deadline)?;
        match channel.write_input(remaining) {
            Ok(0) => return Err("SSH 写入通道已关闭。".into()),
            Ok(size) => remaining = &remaining[size..],
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(POLL),
            Err(e) => return Err(e.to_string()),
        }
    }
    retry_nonblocking(cancel, deadline, || channel.send_eof())?;
    let (output, stderr) = drain_streams(limit, cancel, deadline, |stream, buffer| {
        channel.read_stream(stream, buffer)
    })?;
    retry_nonblocking(cancel, deadline, || channel.close())?;
    retry_nonblocking(cancel, deadline, || channel.wait_close())?;
    let stderr = String::from_utf8_lossy(&stderr).into_owned();
    if channel.exit_status().map_err(|e| e.to_string())? != 0 {
        return Err(format!("远程 curl 执行失败：{stderr}"));
    }
    let mut response = output.finish()?;
    response.stderr = stderr;
    Ok(response)
}

#[cfg(test)]
mod pool_tests {
    use super::*;
    fn config() -> SshTunnelConfig {
        serde_json::from_value(serde_json::json!({"host":"127.0.0.1", "port":1, "username":"test", "authMethod":"password", "privateKeyPath":"", "hostKeyPolicy":"strict", "trustedHostKeySha256":"test"})).unwrap()
    }
    #[test]
    fn full_pool_wait_is_cancellable_without_creating_connection() {
        let pool = Arc::new(SshSessionPool::default());
        pool.state.lock().unwrap().total = 4;
        let token = Arc::new(AtomicBool::new(false));
        let token2 = token.clone();
        let pool2 = pool.clone();
        let worker = std::thread::spawn(move || {
            pool2
                .checkout(&config(), Some("secret"), &token2)
                .err()
                .unwrap()
        });
        std::thread::sleep(Duration::from_millis(30));
        token.store(true, Ordering::Release);
        let started = Instant::now();
        assert!(worker.join().unwrap().contains("取消"));
        assert!(started.elapsed() < Duration::from_millis(250));
        assert_eq!(pool.state.lock().unwrap().total, 4);
    }
    #[test]
    fn failed_connection_releases_reservation() {
        let pool = SshSessionPool::default();
        let token = Arc::new(AtomicBool::new(false));
        assert!(pool.checkout(&config(), Some("secret"), &token).is_err());
        assert_eq!(pool.state.lock().unwrap().total, 0);
    }
    #[test]
    fn expired_idle_session_is_discarded_before_connection() {
        let pool = SshSessionPool::default();
        let config = config();
        {
            let mut state = pool.state.lock().unwrap();
            state.total = 1;
            state.idle.push(Idle {
                session: Connection::fixture(Session::new().unwrap()),
                key: pool_key(&config).unwrap(),
                tag: hmac::sign(&pool.hmac_key, b"secret").as_ref().to_vec(),
                since: Instant::now() - Duration::from_secs(61),
            });
        }
        assert!(pool
            .checkout(&config, Some("secret"), &Arc::new(AtomicBool::new(false)))
            .is_err());
        assert_eq!(pool.state.lock().unwrap().total, 0);
    }
    #[test]
    fn process_keys_produce_different_credential_tags() {
        let a = SshSessionPool::default();
        let b = SshSessionPool::default();
        assert_ne!(
            hmac::sign(&a.hmac_key, b"secret").as_ref(),
            hmac::sign(&b.hmac_key, b"secret").as_ref()
        );
        assert_ne!(
            hmac::sign(&a.hmac_key, b"secret").as_ref(),
            hmac::sign(&a.hmac_key, b"other").as_ref()
        );
    }
    #[test]
    fn deadline_prevents_remote_operation() {
        let mut calls = 0;
        assert!(
            retry_nonblocking(&Arc::new(AtomicBool::new(false)), Instant::now(), || {
                calls += 1;
                Ok(())
            })
            .is_err()
        );
        assert_eq!(calls, 0);
    }
}

fn drain_streams(
    limit: Option<usize>,
    cancel: &CancellationToken,
    deadline: Instant,
    mut read: impl FnMut(usize, &mut [u8]) -> std::io::Result<usize>,
) -> Result<(Output, Vec<u8>), String> {
    let mut output = Output::new(limit);
    let mut stderr = Vec::new();
    let mut buffer = [0; 8192];
    let mut ended = [false; 2];
    loop {
        check(cancel, deadline)?;
        let mut progress = false;
        for stream in 0..2 {
            if ended[stream] {
                continue;
            }
            match read(stream, &mut buffer) {
                Ok(0) => ended[stream] = true,
                Ok(size) => {
                    progress = true;
                    if stream == 0 {
                        output.push(&buffer[..size]);
                    } else {
                        let retain = (16384usize - stderr.len()).min(size);
                        stderr.extend_from_slice(&buffer[..retain]);
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) => return Err(e.to_string()),
            }
        }
        if ended.iter().all(|ended| *ended) {
            return Ok((output, stderr));
        }
        if !progress {
            std::thread::sleep(POLL);
        }
    }
}

#[cfg(test)]
mod stream_tests {
    use super::*;
    #[test]
    fn alternating_streams_drain_large_stderr_without_blocking_stdout() {
        let mut stdout = std::io::Cursor::new(b"abcdefgh\n__ESX_STATUS__:200\n");
        let mut stderr = std::io::Cursor::new(vec![b'x'; 131072]);
        let mut last = None;
        let mut alternations = 0;
        let (output, error) = drain_streams(
            Some(4),
            &Arc::new(AtomicBool::new(false)),
            Instant::now() + TOTAL_TIMEOUT,
            |stream, buffer| {
                if last.is_some_and(|last| last != stream) {
                    alternations += 1;
                }
                last = Some(stream);
                if stream == 0 {
                    stdout.read(buffer)
                } else {
                    stderr.read(buffer)
                }
            },
        )
        .unwrap();
        assert_eq!(output.finish().unwrap().body, "abcd");
        assert_eq!(stderr.position(), 131072);
        assert_eq!(error.len(), 16384);
        assert!(alternations >= 2);
    }
    #[test]
    fn continuous_output_stops_on_cancellation_and_drops_lease() {
        let pool = SshSessionPool::default();
        pool.state.lock().unwrap().total = 1;
        let token = Arc::new(AtomicBool::new(false));
        let mut reads = 0;
        {
            let _lease = SshLease {
                pool: &pool,
                session: Some(Connection::fixture(Session::new().unwrap())),
                key: String::new(),
                tag: vec![],
                reusable: false,
            };
            let result = drain_streams(
                Some(4),
                &token,
                Instant::now() + TOTAL_TIMEOUT,
                |_, buffer| {
                    reads += 1;
                    buffer[0] = b'x';
                    if reads == 6 {
                        token.store(true, Ordering::Release);
                    }
                    Ok(1)
                },
            );
            assert!(result.unwrap_err().contains("取消"));
        }
        assert_eq!(reads, 6);
        assert_eq!(pool.state.lock().unwrap().total, 0);
    }
}

#[cfg(test)]
mod isolation_tests {
    use super::*;
    #[test]
    fn config_pin_and_private_key_version_change_identity() {
        let path = std::env::temp_dir().join(format!("esx-key-version-{}", std::process::id()));
        std::fs::write(&path, b"placeholder").unwrap();
        let mut config: SshTunnelConfig = serde_json::from_value(serde_json::json!({"host":"localhost", "port":22, "username":"test", "authMethod":"privateKey", "privateKeyPath":path.to_str().unwrap(), "hostKeyPolicy":"strict", "trustedHostKeySha256":"a"})).unwrap();
        let first = pool_key(&config).unwrap();
        config.trusted_host_key_sha256 = Some("b".into());
        assert_ne!(first, pool_key(&config).unwrap());
        config.trusted_host_key_sha256 = Some("a".into());
        config.port = 2222;
        assert_ne!(first, pool_key(&config).unwrap());
        config.port = 22;
        std::fs::write(&path, b"new-placeholder-key").unwrap();
        assert_ne!(first, pool_key(&config).unwrap());
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn full_pool_expires_wait_after_two_seconds() {
        let pool = SshSessionPool::default();
        pool.state.lock().unwrap().total = 4;
        let config: SshTunnelConfig=serde_json::from_value(serde_json::json!({"host":"localhost", "port":22,"username":"test","authMethod":"password","privateKeyPath":"","hostKeyPolicy":"strict","trustedHostKeySha256":"a"})).unwrap();
        let started = Instant::now();
        assert!(pool
            .checkout(&config, None, &Arc::new(AtomicBool::new(false)))
            .is_err());
        assert!(started.elapsed() >= Duration::from_secs(2));
        assert!(started.elapsed() < Duration::from_secs(3));
        assert_eq!(pool.state.lock().unwrap().total, 4);
    }
}

#[cfg(test)]
mod race_tests {
    use super::*;
    #[test]
    fn cancel_before_registration_still_cancels_operation() {
        cancel("ssh-early-cancel-test");
        let request = Registration::new(Some("ssh-early-cancel-test".into())).unwrap();
        assert!(check(&request.cancel, Instant::now() + TOTAL_TIMEOUT).is_err());
    }
    #[test]
    fn dns_timeout_does_not_wait_for_blocking_resolver_drop() {
        let started = Instant::now();
        let result = DNS_RUNTIME.block_on(async {
            tokio::time::timeout(
                Duration::from_millis(10),
                tokio::task::spawn_blocking(|| std::thread::sleep(Duration::from_millis(300))),
            )
            .await
        });
        assert!(result.is_err());
        assert!(started.elapsed() < Duration::from_millis(200));
    }
    #[test]
    fn oversized_byte_count_is_rejected() {
        let mut output = Output::new(Some(0));
        output.push(b"\n__ESX_STATUS__:200\n");
        output.total += 9_007_199_254_740_992;
        assert!(output.finish().is_err());
    }
}

#[cfg(test)]
mod reuse_tests {
    use super::*;
    use std::cell::Cell;
    #[test]
    fn pool_reuses_session_and_isolates_credentials_and_configuration() {
        let pool = SshSessionPool::default();
        let connections = Cell::new(0);
        let verifications = Cell::new(0);
        let token = Arc::new(AtomicBool::new(false));
        let mut config: SshTunnelConfig=serde_json::from_value(serde_json::json!({"host":"localhost","port":22,"username":"test","authMethod":"password","privateKeyPath":"","hostKeyPolicy":"strict","trustedHostKeySha256":"a"})).unwrap();
        let connector = |_: Option<&[u8]>| {
            connections.set(connections.get() + 1);
            Session::new()
                .map(Connection::fixture)
                .map_err(|e| e.to_string())
        };
        let verify = |_: &Session| {
            verifications.set(verifications.get() + 1);
            Ok(())
        };
        for _ in 0..3 {
            let mut lease = pool
                .checkout_with(
                    &config,
                    Some("one"),
                    &token,
                    Instant::now() + TOTAL_TIMEOUT,
                    &connector,
                    &verify,
                )
                .unwrap();
            lease.reuse();
        }
        assert_eq!(connections.get(), 1);
        assert_eq!(verifications.get(), 2);
        {
            let mut lease = pool
                .checkout_with(
                    &config,
                    Some("two"),
                    &token,
                    Instant::now() + TOTAL_TIMEOUT,
                    &connector,
                    &verify,
                )
                .unwrap();
            lease.reuse();
        }
        assert_eq!(connections.get(), 2);
        config.trusted_host_key_sha256 = Some("b".into());
        {
            let mut lease = pool
                .checkout_with(
                    &config,
                    Some("two"),
                    &token,
                    Instant::now() + TOTAL_TIMEOUT,
                    &connector,
                    &verify,
                )
                .unwrap();
            lease.reuse();
        }
        assert_eq!(connections.get(), 3);
        config.port = 2222;
        {
            let mut lease = pool
                .checkout_with(
                    &config,
                    Some("two"),
                    &token,
                    Instant::now() + TOTAL_TIMEOUT,
                    &connector,
                    &verify,
                )
                .unwrap();
            lease.reuse();
        }
        assert_eq!(connections.get(), 4);
        assert_eq!(pool.state.lock().unwrap().total, 4);
    }
    #[test]
    fn changed_private_key_contents_change_tag_even_at_same_size() {
        let pool = SshSessionPool::default();
        let path = std::env::temp_dir().join(format!("esx-key-tag-{}", std::process::id()));
        let config: SshTunnelConfig=serde_json::from_value(serde_json::json!({"host":"localhost","port":22,"username":"test","authMethod":"privateKey","privateKeyPath":path.to_str().unwrap(),"hostKeyPolicy":"strict","trustedHostKeySha256":"a"})).unwrap();
        std::fs::write(&path, b"fixture-a").unwrap();
        let first = pool.credential_tag(&config, None).unwrap();
        std::fs::write(&path, b"fixture-b").unwrap();
        assert_ne!(first, pool.credential_tag(&config, None).unwrap());
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn reused_session_verification_failure_discards_without_reconnect() {
        let pool = SshSessionPool::default();
        let token = Arc::new(AtomicBool::new(false));
        let calls = Cell::new(0);
        let config: SshTunnelConfig=serde_json::from_value(serde_json::json!({"host":"localhost","port":22,"username":"test","authMethod":"password","privateKeyPath":"","hostKeyPolicy":"strict","trustedHostKeySha256":"a"})).unwrap();
        let connector = |_: Option<&[u8]>| {
            calls.set(calls.get() + 1);
            Session::new()
                .map(Connection::fixture)
                .map_err(|e| e.to_string())
        };
        {
            let mut lease = pool
                .checkout_with(
                    &config,
                    None,
                    &token,
                    Instant::now() + TOTAL_TIMEOUT,
                    &connector,
                    |_| Ok(()),
                )
                .unwrap();
            lease.reuse();
        }
        assert!(pool
            .checkout_with(
                &config,
                None,
                &token,
                Instant::now() + TOTAL_TIMEOUT,
                &connector,
                |_| Err("changed key".into())
            )
            .is_err());
        assert_eq!(calls.get(), 1);
        assert_eq!(pool.state.lock().unwrap().total, 0);
    }
}

#[cfg(test)]
mod resource_review_tests {
    use super::*;
    #[test]
    fn file_authenticated_connection_cannot_be_returned_to_pool() {
        let pool = SshSessionPool::default();
        pool.state.lock().unwrap().total = 1;
        let mut connection = Connection::fixture(Session::new().unwrap());
        connection.cacheable = false;
        let mut lease = SshLease {
            pool: &pool,
            session: Some(connection),
            key: String::new(),
            tag: vec![],
            reusable: false,
        };
        lease.reuse();
        drop(lease);
        let state = pool.state.lock().unwrap();
        assert_eq!(state.total, 0);
        assert!(state.idle.is_empty());
    }
    #[test]
    fn total_deadline_includes_queued_blocking_work() {
        DNS_RUNTIME.block_on(async {
            let cancel = Arc::new(AtomicBool::new(false));
            let started = Instant::now();
            let result = await_work(
                &cancel,
                started + Duration::from_millis(25),
                std::future::pending::<Result<(), String>>(),
            )
            .await;
            assert!(result.unwrap_err().contains("总时间"));
            assert!(cancel.load(Ordering::Acquire));
            assert!(started.elapsed() < Duration::from_millis(250));
        });
    }
    #[test]
    fn stage_budgets_shrink_with_total_deadline() {
        let start = Instant::now();
        let total = start + Duration::from_secs(75);
        for (elapsed, expected) in [(0, [5, 10, 15]), (68, [5, 7, 7]), (73, [2, 2, 2])] {
            let now = start + Duration::from_secs(elapsed);
            for (index, limit) in [5, 10, 15].into_iter().enumerate() {
                assert_eq!(
                    stage_deadline(now, total, Duration::from_secs(limit)).duration_since(now),
                    Duration::from_secs(expected[index])
                );
            }
            assert_eq!(blocking_timeout_ms(now, total), (expected[2] * 1000) as u32);
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        assert!(check(&cancelled, start - Duration::from_secs(1)).is_err());
    }

    #[test]
    fn admission_wait_is_bounded_and_cancel_does_not_release_active_work() {
        DNS_RUNTIME.block_on(async {
            let slots = Arc::new(tokio::sync::Semaphore::new(4));
            let token = Arc::new(AtomicBool::new(false));
            let mut permits = Vec::new();
            for _ in 0..4 {
                permits.push(
                    admit_with(slots.clone(), &token, Instant::now() + TOTAL_TIMEOUT)
                        .await
                        .unwrap(),
                );
            }
            let started = Instant::now();
            assert!(admit_with(
                slots.clone(),
                &token,
                Instant::now() + Duration::from_millis(30)
            )
            .await
            .is_err());
            assert!(started.elapsed() < Duration::from_millis(250));
            let abort = token.clone();
            let cancel = async {
                tokio::time::sleep(Duration::from_millis(20)).await;
                abort.store(true, Ordering::Release);
            };
            let wait = admit_with(slots.clone(), &token, Instant::now() + TOTAL_TIMEOUT);
            let (result, _) = tokio::join!(wait, cancel);
            assert!(result.unwrap_err().contains("取消"));
            assert_eq!(slots.available_permits(), 0);
            drop(permits);
            assert_eq!(slots.available_permits(), 4);
        });
    }

    #[test]
    fn validation_obeys_same_four_session_capacity() {
        let pool = SshSessionPool::default();
        pool.state.lock().unwrap().total = 4;
        let config: SshTunnelConfig = serde_json::from_value(serde_json::json!({
            "host":"localhost", "port":22, "username":"test", "authMethod":"password",
            "privateKeyPath":"", "hostKeyPolicy":"trustOnFirstUse"
        }))
        .unwrap();
        let calls = std::cell::Cell::new(0);
        let result = pool.checkout_with_policy(
            true,
            &config,
            None,
            &Arc::new(AtomicBool::new(false)),
            Instant::now() + Duration::from_millis(25),
            |_| {
                calls.set(calls.get() + 1);
                Session::new()
                    .map(Connection::fixture)
                    .map_err(|e| e.to_string())
            },
            |_| Ok(()),
        );
        assert!(result.is_err());
        assert_eq!(calls.get(), 0);
        assert_eq!(pool.state.lock().unwrap().total, 4);
    }
    #[test]
    fn failed_lease_shuts_down_transport_before_drop() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let socket = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (mut peer, _) = listener.accept().unwrap();
        peer.set_read_timeout(Some(Duration::from_millis(200)))
            .unwrap();
        let observer = socket.try_clone().unwrap();
        let mut session = Session::new().unwrap();
        session.set_tcp_stream(socket.try_clone().unwrap());
        session.set_blocking(false);
        let session = Connection {
            session,
            socket: Some(socket),
            cacheable: true,
        };
        let pool = SshSessionPool::default();
        pool.state.lock().unwrap().total = 1;
        let lease = SshLease {
            pool: &pool,
            session: Some(session),
            key: String::new(),
            tag: vec![],
            reusable: false,
        };
        drop(lease);
        let mut byte = [0];
        assert_eq!(peer.read(&mut byte).unwrap(), 0);
        assert_eq!(pool.state.lock().unwrap().total, 0);
        drop(observer);
    }
    #[test]
    fn dns_timeout_keeps_capacity_until_real_lookup_finishes() {
        DNS_RUNTIME.block_on(async {
            let slots = Arc::new(tokio::sync::Semaphore::new(4));
            let release = Arc::new(tokio::sync::Notify::new());
            let started = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let token = Arc::new(AtomicBool::new(false));
            for _ in 0..4 {
                let release = release.clone();
                let started = started.clone();
                let result = resolve_with(
                    slots.clone(),
                    &token,
                    Instant::now() + Duration::from_millis(25),
                    async move {
                        started.fetch_add(1, Ordering::SeqCst);
                        release.notified().await;
                        Ok(())
                    },
                )
                .await;
                assert!(result.is_err());
            }
            assert_eq!(started.load(Ordering::SeqCst), 4);
            let extra = started.clone();
            let result = resolve_with(
                slots.clone(),
                &token,
                Instant::now() + Duration::from_millis(25),
                async move {
                    extra.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                },
            )
            .await;
            release.notify_waiters();
            assert!(result.is_err(), "第五个实际 DNS 工作不能启动");
            assert_eq!(started.load(Ordering::SeqCst), 4);
            tokio::time::timeout(Duration::from_secs(1), async {
                loop {
                    if slots.available_permits() == 4 {
                        break;
                    }
                    tokio::task::yield_now().await;
                }
            })
            .await
            .unwrap();
        });
    }
    #[test]
    fn dns_cancellation_releases_caller_without_releasing_real_work_slot() {
        DNS_RUNTIME.block_on(async {
            let slots = Arc::new(tokio::sync::Semaphore::new(4));
            let token = Arc::new(AtomicBool::new(false));
            let trigger = token.clone();
            let release = Arc::new(tokio::sync::Notify::new());
            let release_work = release.clone();
            let (started_tx, started_rx) = tokio::sync::oneshot::channel();
            let caller = resolve_with(
                slots.clone(),
                &token,
                Instant::now() + Duration::from_secs(1),
                async move {
                    let _ = started_tx.send(());
                    release_work.notified().await;
                    Ok(())
                },
            );
            tokio::pin!(caller);
            let abort = async {
                started_rx.await.unwrap();
                trigger.store(true, Ordering::Release);
            };
            let started = Instant::now();
            let (result, _) = tokio::join!(caller, abort);
            let available = slots.available_permits();
            release.notify_waiters();
            assert!(result.unwrap_err().contains("取消"));
            assert!(started.elapsed() < Duration::from_millis(250));
            assert_eq!(available, 3);
        });
    }
    #[cfg(unix)]
    #[test]
    fn special_private_key_is_rejected() {
        let config: SshTunnelConfig = serde_json::from_value(serde_json::json!({
            "host":"localhost", "port":22, "username":"test", "authMethod":"privateKey",
            "privateKeyPath":"/dev/zero", "trustedHostKeySha256":"a"
        }))
        .unwrap();
        let result = read_private_key(
            &config,
            &Arc::new(AtomicBool::new(false)),
            Instant::now() + TOTAL_TIMEOUT,
        );
        assert!(result.unwrap_err().contains("普通文件"));
    }
}

#[cfg(test)]
mod execution_review_tests {
    use super::*;
    #[derive(Clone, Copy, Debug)]
    enum Failure {
        InvalidSession,
        Disconnected,
        Cancelled,
        None,
    }
    struct ScriptChannel {
        failure: Failure,
        cancel: CancellationToken,
        exec_calls: usize,
        remote_starts: usize,
        resume_exec: bool,
        input: Vec<u8>,
        output: std::io::Cursor<Vec<u8>>,
    }
    impl ChannelIo for ScriptChannel {
        fn exec(&mut self, command: &str) -> Result<(), ssh2::Error> {
            assert_eq!(command, "sh -s");
            self.exec_calls += 1;
            if matches!(self.failure, Failure::InvalidSession) {
                return Err(ssh2::Error::from_errno(ErrorCode::Session(-7)));
            }
            if self.exec_calls == 1 {
                self.remote_starts += 1;
                if self.resume_exec {
                    return Err(ssh2::Error::from_errno(ErrorCode::Session(-37)));
                }
            } else if !self.resume_exec || self.exec_calls > 2 {
                self.remote_starts += 1;
            }
            Ok(())
        }
        fn write_input(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            let count = bytes.len().min(7);
            self.input.extend_from_slice(&bytes[..count]);
            Ok(count)
        }
        fn send_eof(&mut self) -> Result<(), ssh2::Error> {
            Ok(())
        }
        fn read_stream(&mut self, stream: usize, bytes: &mut [u8]) -> std::io::Result<usize> {
            match self.failure {
                Failure::Disconnected => Err(std::io::Error::new(
                    std::io::ErrorKind::ConnectionReset,
                    "fixture disconnect",
                )),
                Failure::Cancelled => {
                    self.cancel.store(true, Ordering::Release);
                    Err(std::io::Error::from(std::io::ErrorKind::WouldBlock))
                }
                _ if stream == 0 => self.output.read(bytes),
                _ => Ok(0),
            }
        }
        fn close(&mut self) -> Result<(), ssh2::Error> {
            Ok(())
        }
        fn wait_close(&mut self) -> Result<(), ssh2::Error> {
            Ok(())
        }
        fn exit_status(&self) -> Result<i32, ssh2::Error> {
            Ok(0)
        }
    }
    fn script(method: &str) -> String {
        let payload: crate::ExecuteSshHttpRequestPayload = serde_json::from_value(serde_json::json!({
            "baseUrl":"https://example.invalid", "url":"https://example.invalid/index/_doc/1",
            "method":method, "username":"fixture", "password":"", "bodyText":"{}", "insecureTls":false,
            "sshTunnel":{"host":"localhost","port":22,"username":"fixture","authMethod":"password","privateKeyPath":""}
        })).unwrap();
        crate::build_remote_curl_script(&payload)
    }
    #[test]
    fn write_requests_never_replay_after_channel_failure_or_cancellation() {
        for method in ["POST", "PUT", "PATCH", "DELETE"] {
            for failure in [
                Failure::InvalidSession,
                Failure::Disconnected,
                Failure::Cancelled,
            ] {
                let cancel = Arc::new(AtomicBool::new(false));
                let mut channel = ScriptChannel {
                    failure,
                    cancel: cancel.clone(),
                    exec_calls: 0,
                    remote_starts: 0,
                    resume_exec: false,
                    input: vec![],
                    output: std::io::Cursor::new(vec![]),
                };
                let result = execute_channel(
                    &mut channel,
                    "sh -s",
                    &script(method),
                    Some(32),
                    &cancel,
                    Instant::now() + TOTAL_TIMEOUT,
                );
                assert!(result.is_err(), "{method} {failure:?}");
                assert_eq!(channel.exec_calls, 1, "{method} {failure:?}");
                assert!(channel.remote_starts <= 1, "{method} {failure:?}");
                if !matches!(failure, Failure::InvalidSession) {
                    let input = std::str::from_utf8(&channel.input).unwrap();
                    assert!(input.contains(&format!("request = \"{method}\"")));
                    assert!(input.ends_with("curl --config \"$config_file\"\n"));
                } else {
                    assert!(channel.input.is_empty());
                }
            }
        }
    }
    #[test]
    fn eagain_resumes_same_exec_without_restarting_remote_command() {
        for method in ["POST", "PUT", "PATCH", "DELETE"] {
            let cancel = Arc::new(AtomicBool::new(false));
            let mut channel = ScriptChannel {
                failure: Failure::None,
                cancel: cancel.clone(),
                exec_calls: 0,
                remote_starts: 0,
                resume_exec: true,
                input: vec![],
                output: std::io::Cursor::new(b"ok\n__ESX_STATUS__:200\n".to_vec()),
            };
            let response = execute_channel(
                &mut channel,
                "sh -s",
                &script(method),
                Some(32),
                &cancel,
                Instant::now() + TOTAL_TIMEOUT,
            )
            .unwrap();
            assert_eq!(response.body, "ok");
            assert_eq!(channel.exec_calls, 2);
            assert_eq!(channel.remote_starts, 1);
            assert_eq!(channel.input, script(method).as_bytes());
        }
    }
}
