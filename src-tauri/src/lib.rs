use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    net::TcpStream,
    path::Path,
    sync::{Arc, LazyLock, Mutex},
    time::Duration,
};

use keyring::{Entry, Error as KeyringError};
use reqwest::{Method, StatusCode, Url};
use rustls::{
    client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    crypto::{verify_tls12_signature, verify_tls13_signature, WebPkiSupportedAlgorithms},
    pki_types::{CertificateDer, ServerName, UnixTime},
    DigitallySignedStruct, SignatureScheme,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use ssh2::Session;
use tauri_plugin_prevent_default::Flags;

const KEYRING_SERVICE: &str = "com.tskfok.esx";
const VAULT_ACCOUNT: &str = "secrets-vault";
const AI_CONFIG_SCOPE: &str = "__ai_analysis__";
const AI_API_KEY_ACCOUNT: &str = "api-key";
const SSH_AUTH_SECRET_KEY: &str = "ssh-auth-secret";
const VAULT_VERSION: u32 = 1;
#[derive(Default, Serialize, Deserialize)]
struct SecretsVault {
    version: u32,
    values: HashMap<String, String>,
}

struct VaultCache {
    loaded: bool,
    vault: SecretsVault,
}

static VAULT_CACHE: LazyLock<Mutex<VaultCache>> = LazyLock::new(|| {
    Mutex::new(VaultCache {
        loaded: false,
        vault: SecretsVault {
            version: VAULT_VERSION,
            values: HashMap::new(),
        },
    })
});

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionPasswordHint {
    connection_id: String,
    username: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecretsMigrationHint {
    connections: Vec<ConnectionPasswordHint>,
    ssh_profile_ids: Vec<String>,
    ai_base_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SecretsVaultStatus {
    ai_api_key_configured: bool,
    migrated_legacy_entries: u32,
}

fn legacy_service_name_for(scope: &str) -> String {
    format!("{KEYRING_SERVICE}.{scope}")
}

fn legacy_entry_for(scope: &str, account: &str) -> Result<Entry, String> {
    Entry::new(&legacy_service_name_for(scope), account).map_err(|error| error.to_string())
}

fn unified_vault_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, VAULT_ACCOUNT).map_err(|error| error.to_string())
}

fn password_vault_key(connection_id: &str, username: &str) -> String {
    format!("pwd:{connection_id}:{username}")
}

fn secret_vault_key(connection_id: &str, secret_key: &str) -> String {
    format!("sec:{connection_id}:{secret_key}")
}

fn ai_api_key_vault_key() -> String {
    "ai:api-key".into()
}

fn ai_api_key_origin_vault_key() -> String {
    "ai:api-key-origin".into()
}

fn read_vault_from_keychain() -> Result<Option<SecretsVault>, String> {
    match unified_vault_entry()?.get_password() {
        Ok(json) => serde_json::from_str(&json).map(Some).map_err(|error| error.to_string()),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn write_vault_to_keychain(vault: &SecretsVault) -> Result<(), String> {
    let json = serde_json::to_string(vault).map_err(|error| error.to_string())?;
    unified_vault_entry()
        .and_then(|entry| entry.set_password(&json).map_err(|error| error.to_string()))
}

fn ensure_vault_loaded(cache: &mut VaultCache) -> Result<(), String> {
    if cache.loaded {
        return Ok(());
    }

    cache.vault = read_vault_from_keychain()?.unwrap_or(SecretsVault {
        version: VAULT_VERSION,
        values: HashMap::new(),
    });
    cache.loaded = true;
    Ok(())
}

fn with_vault_read<F, R>(operation: F) -> Result<R, String>
where
    F: FnOnce(&SecretsVault) -> R,
{
    let mut cache = VAULT_CACHE
        .lock()
        .map_err(|_| "无法锁定密钥缓存。".to_string())?;
    ensure_vault_loaded(&mut cache)?;
    Ok(operation(&cache.vault))
}

fn with_vault_mut<F>(operation: F) -> Result<(), String>
where
    F: FnOnce(&mut SecretsVault) -> Result<(), String>,
{
    let mut cache = VAULT_CACHE
        .lock()
        .map_err(|_| "无法锁定密钥缓存。".to_string())?;
    ensure_vault_loaded(&mut cache)?;
    operation(&mut cache.vault)?;
    write_vault_to_keychain(&cache.vault)
}

fn legacy_get_secret(scope: &str, account: &str) -> Result<Option<String>, String> {
    match legacy_entry_for(scope, account)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn delete_legacy_secret(scope: &str, account: &str) -> Result<(), String> {
    match legacy_entry_for(scope, account)?.delete_credential() {
        Ok(_) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn migrate_legacy_entries(vault: &mut SecretsVault, hint: &SecretsMigrationHint) -> Result<u32, String> {
    let mut migrated = 0_u32;
    let ai_key = ai_api_key_vault_key();

    if !vault.values.contains_key(&ai_key) {
        if let Some(value) = legacy_get_secret(AI_CONFIG_SCOPE, AI_API_KEY_ACCOUNT)? {
            vault.values.insert(ai_key, value);
            delete_legacy_secret(AI_CONFIG_SCOPE, AI_API_KEY_ACCOUNT)?;
            migrated += 1;
        }
    }

    for connection in &hint.connections {
        let key = password_vault_key(&connection.connection_id, &connection.username);
        if vault.values.contains_key(&key) {
            continue;
        }

        if let Some(value) = legacy_get_secret(&connection.connection_id, &connection.username)? {
            vault.values.insert(key, value);
            delete_legacy_secret(&connection.connection_id, &connection.username)?;
            migrated += 1;
        }
    }

    for profile_id in &hint.ssh_profile_ids {
        let key = secret_vault_key(profile_id, SSH_AUTH_SECRET_KEY);
        if vault.values.contains_key(&key) {
            continue;
        }

        if let Some(value) = legacy_get_secret(profile_id, SSH_AUTH_SECRET_KEY)? {
            vault.values.insert(key, value);
            delete_legacy_secret(profile_id, SSH_AUTH_SECRET_KEY)?;
            migrated += 1;
        }
    }

    Ok(migrated)
}

fn vault_get(key: &str) -> Result<Option<String>, String> {
    with_vault_read(|vault| vault.values.get(key).cloned())
}

fn vault_set(key: String, value: String) -> Result<(), String> {
    with_vault_mut(|vault| {
        vault.values.insert(key, value);
        Ok(())
    })
}

fn vault_delete(key: &str) -> Result<(), String> {
    with_vault_mut(|vault| {
        vault.values.remove(key);
        Ok(())
    })
}

#[tauri::command]
fn load_secrets_vault(hint: SecretsMigrationHint) -> Result<SecretsVaultStatus, String> {
    let mut cache = VAULT_CACHE
        .lock()
        .map_err(|_| "无法锁定密钥缓存。".to_string())?;
    ensure_vault_loaded(&mut cache)?;

    let migrated_legacy_entries = migrate_legacy_entries(&mut cache.vault, &hint)?;
    let bound_ai_origin = bind_legacy_ai_api_key_origin(&mut cache.vault, hint.ai_base_url.as_deref());
    if migrated_legacy_entries > 0 || bound_ai_origin {
        write_vault_to_keychain(&cache.vault)?;
    }

    let ai_api_key_configured = hint.ai_base_url.as_deref()
        .and_then(|url| ai_api_key_for_url(&cache.vault, url).ok().flatten())
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);

    Ok(SecretsVaultStatus {
        ai_api_key_configured,
        migrated_legacy_entries,
    })
}

fn save_secret(connection_id: &str, account: &str, secret: &str) -> Result<(), String> {
    vault_set(secret_vault_key(connection_id, account), secret.to_string())
}

fn get_secret(connection_id: &str, account: &str) -> Result<Option<String>, String> {
    vault_get(&secret_vault_key(connection_id, account))
}

fn delete_secret(connection_id: &str, account: &str) -> Result<(), String> {
    vault_delete(&secret_vault_key(connection_id, account))
}

#[tauri::command]
fn save_connection_password(connection_id: String, username: String, password: String) -> Result<(), String> {
    vault_set(password_vault_key(&connection_id, &username), password)
}

#[tauri::command]
fn get_connection_password(connection_id: String, username: String) -> Result<Option<String>, String> {
    vault_get(&password_vault_key(&connection_id, &username))
}

#[tauri::command]
fn delete_connection_password(connection_id: String, username: String) -> Result<(), String> {
    vault_delete(&password_vault_key(&connection_id, &username))
}

#[tauri::command]
fn save_connection_secret(connection_id: String, secret_key: String, secret: String) -> Result<(), String> {
    save_secret(&connection_id, &secret_key, &secret)
}

#[tauri::command]
fn get_connection_secret(connection_id: String, secret_key: String) -> Result<Option<String>, String> {
    get_secret(&connection_id, &secret_key)
}

#[tauri::command]
fn delete_connection_secret(connection_id: String, secret_key: String) -> Result<(), String> {
    delete_secret(&connection_id, &secret_key)
}

#[tauri::command]
fn save_ai_api_key(api_key: String, base_url: String) -> Result<(), String> {
    with_vault_mut(|vault| set_ai_api_key_in_vault(vault, api_key, &base_url))
}

#[tauri::command]
fn get_ai_api_key(base_url: String) -> Result<Option<String>, String> {
    with_vault_read(|vault| ai_api_key_for_url(vault, &base_url))?
}

fn set_ai_api_key_in_vault(vault: &mut SecretsVault, api_key: String, base_url: &str) -> Result<(), String> {
    let origin = validate_http_url(base_url)?.origin().ascii_serialization();
    vault.values.insert(ai_api_key_vault_key(), api_key);
    vault.values.insert(ai_api_key_origin_vault_key(), origin);
    Ok(())
}

fn ai_api_key_for_url(vault: &SecretsVault, base_url: &str) -> Result<Option<String>, String> {
    let origin = validate_http_url(base_url)?.origin().ascii_serialization();
    if vault.values.get(&ai_api_key_origin_vault_key()) != Some(&origin) {
        return Ok(None);
    }
    Ok(vault.values.get(&ai_api_key_vault_key()).cloned())
}

fn bind_legacy_ai_api_key_origin(vault: &mut SecretsVault, base_url: Option<&str>) -> bool {
    if !vault.values.contains_key(&ai_api_key_vault_key()) || vault.values.contains_key(&ai_api_key_origin_vault_key()) {
        return false;
    }
    let Some(origin) = base_url.and_then(|url| validate_http_url(url).ok()).map(|url| url.origin().ascii_serialization()) else {
        return false;
    };
    vault.values.insert(ai_api_key_origin_vault_key(), origin);
    true
}

#[tauri::command]
fn delete_ai_api_key() -> Result<(), String> {
    with_vault_mut(|vault| {
        vault.values.remove(&ai_api_key_vault_key());
        vault.values.remove(&ai_api_key_origin_vault_key());
        Ok(())
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
enum SshAuthMethod {
    Password,
    PrivateKey,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
enum SshHostKeyPolicy {
    TrustOnFirstUse,
    Strict,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SshTunnelConfig {
    host: String,
    port: u16,
    username: String,
    auth_method: SshAuthMethod,
    private_key_path: String,
    host_key_policy: Option<SshHostKeyPolicy>,
    trusted_host_key_sha256: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
enum ConnectionAuthType {
    Basic,
    ApiKey,
    Bearer,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionAuthConfig {
    auth_type: Option<ConnectionAuthType>,
    r#type: Option<ConnectionAuthType>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
enum ConnectionTlsMode {
    Default,
    Insecure,
    CaCertificate,
    CertificateFingerprint,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionTlsConfig {
    mode: Option<ConnectionTlsMode>,
    ca_path: Option<String>,
    fingerprint: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteEsHttpRequestPayload {
    base_url: String,
    url: String,
    method: String,
    auth: Option<ConnectionAuthConfig>,
    username: String,
    password: String,
    auth_secret: Option<String>,
    body_text: String,
    content_type: Option<String>,
    insecure_tls: bool,
    tls: Option<ConnectionTlsConfig>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidateEsConnectionPayload {
    base_url: String,
    auth: Option<ConnectionAuthConfig>,
    username: String,
    password: String,
    auth_secret: Option<String>,
    insecure_tls: bool,
    tls: Option<ConnectionTlsConfig>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteAiHttpRequestPayload {
    url: String,
    method: String,
    api_key: Option<String>,
    body_text: Option<String>,
    content_type: Option<String>,
    accept: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteSshHttpRequestPayload {
    base_url: String,
    url: String,
    method: String,
    auth: Option<ConnectionAuthConfig>,
    username: String,
    password: String,
    auth_secret: Option<String>,
    body_text: String,
    content_type: Option<String>,
    insecure_tls: bool,
    tls: Option<ConnectionTlsConfig>,
    ssh_tunnel: SshTunnelConfig,
    ssh_secret: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidateSshTunnelPayload {
    ssh_tunnel: SshTunnelConfig,
    ssh_secret: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpResponsePayload {
    ok: bool,
    status: u16,
    status_text: String,
    body_text: String,
    error_message: Option<String>,
    diagnostics: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TunnelValidationResponsePayload {
    ok: bool,
    host_key_sha256: Option<String>,
    error_message: Option<String>,
    diagnostics: Vec<String>,
}

#[derive(Debug)]
struct DiagnosticFailure {
    message: String,
    diagnostics: Vec<String>,
}

impl DiagnosticFailure {
    fn new(message: impl Into<String>, diagnostics: Vec<String>) -> Self {
        Self {
            message: message.into(),
            diagnostics,
        }
    }
}

fn build_request_failed_payload(message: String, diagnostics: Vec<String>) -> HttpResponsePayload {
    HttpResponsePayload {
        ok: false,
        status: 0,
        status_text: "REQUEST_FAILED".into(),
        body_text: message.clone(),
        error_message: Some(message),
        diagnostics,
    }
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::new();
    let mut index = 0;
    while index < bytes.len() {
        let b0 = bytes[index];
        let b1 = *bytes.get(index + 1).unwrap_or(&0);
        let b2 = *bytes.get(index + 2).unwrap_or(&0);
        output.push(TABLE[(b0 >> 2) as usize] as char);
        output.push(TABLE[(((b0 & 0b0000_0011) << 4) | (b1 >> 4)) as usize] as char);
        if index + 1 < bytes.len() {
            output.push(TABLE[(((b1 & 0b0000_1111) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            output.push('=');
        }
        if index + 2 < bytes.len() {
            output.push(TABLE[(b2 & 0b0011_1111) as usize] as char);
        } else {
            output.push('=');
        }
        index += 3;
    }
    output
}

fn require_ssh_trusted_key(config: &SshTunnelConfig, allow_first_use: bool) -> Result<(), String> {
    let has_pin = config.trusted_host_key_sha256.as_deref().is_some_and(|value| !value.trim().is_empty());
    if !has_pin && (!allow_first_use || matches!(config.host_key_policy, Some(SshHostKeyPolicy::Strict))) {
        return Err("SSH 连接缺少可信指纹，请先验证并保存 SSH 主机。".into());
    }
    Ok(())
}

fn verify_ssh_host_key(config: &SshTunnelConfig, digest: Option<&[u8]>, allow_first_use: bool) -> Result<String, String> {
    require_ssh_trusted_key(config, allow_first_use)?;
    let digest = digest.ok_or_else(|| "SSH 服务端未返回可校验的主机指纹。".to_string())?;
    if let Some(expected) = config.trusted_host_key_sha256.as_deref().filter(|value| !value.trim().is_empty()) {
        if !fingerprint_matches(expected, digest) {
            return Err("SSH 主机指纹发生变化，已在发送认证凭据前终止连接。".into());
        }
    }
    Ok(format!("SHA256:{}", base64_encode(digest)))
}

fn validate_http_url(input: &str) -> Result<Url, String> {
    let parsed = Url::parse(input).map_err(|_| "请求地址无效。".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("请求地址必须使用 HTTP 或 HTTPS。".into());
    }
    let authority = input.split_once("://").map(|(_, rest)| rest.split(['/', '?', '#']).next().unwrap_or(""));
    if !parsed.username().is_empty() || parsed.password().is_some() || authority.is_some_and(|value| value.contains('@')) {
        return Err("请求地址不能包含用户名或密码。".into());
    }
    Ok(parsed)
}

fn validate_es_request_url(base_url: &str, request_url: &str) -> Result<Url, String> {
    let base = validate_http_url(base_url)?;
    let request = validate_http_url(request_url)?;
    if request.origin() != base.origin() {
        return Err("请求地址必须与当前 Elasticsearch 连接同源。".into());
    }
    Ok(request)
}

fn resolve_auth_type(auth: Option<&ConnectionAuthConfig>) -> ConnectionAuthType {
    auth
        .and_then(|auth| auth.r#type.clone().or_else(|| auth.auth_type.clone()))
        .unwrap_or(ConnectionAuthType::Basic)
}

fn build_authorization_header(
    auth: Option<&ConnectionAuthConfig>,
    username: &str,
    password: &str,
    auth_secret: Option<&str>,
) -> String {
    match resolve_auth_type(auth) {
        ConnectionAuthType::Basic => {
            let secret = auth_secret
                .filter(|value| !value.trim().is_empty())
                .map(|value| value.to_string())
                .unwrap_or_else(|| format!("{}:{}", username, password));
            format!("Basic {}", base64_encode(secret.as_bytes()))
        }
        ConnectionAuthType::ApiKey => format!("ApiKey {}", auth_secret.unwrap_or("").trim()),
        ConnectionAuthType::Bearer => format!("Bearer {}", auth_secret.unwrap_or("").trim()),
    }
}

fn resolve_tls_mode(tls: Option<&ConnectionTlsConfig>, legacy_insecure_tls: bool) -> ConnectionTlsMode {
    tls.and_then(|value| value.mode.clone()).unwrap_or(if legacy_insecure_tls {
        ConnectionTlsMode::Insecure
    } else {
        ConnectionTlsMode::Default
    })
}

fn compact_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect::<Vec<_>>().join("")
}

fn fingerprint_matches(input: &str, digest: &[u8]) -> bool {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return false;
    }

    let expected_base64 = base64_encode(digest);
    if trimmed.get(.."SHA256:".len()).is_some_and(|prefix| prefix.eq_ignore_ascii_case("SHA256:"))
        && trimmed["SHA256:".len()..] == expected_base64
    {
        return true;
    }

    trimmed
        .chars()
        .filter(|character| *character != ':' && !character.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase()
        == compact_hex(digest)
}

#[derive(Debug)]
struct FingerprintVerifier {
    expected_fingerprint: String,
    algorithms: WebPkiSupportedAlgorithms,
}

impl ServerCertVerifier for FingerprintVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        if !fingerprint_matches(&self.expected_fingerprint, &Sha256::digest(end_entity.as_ref())) {
            return Err(rustls::Error::General("服务端证书指纹不匹配。".into()));
        }
        // 指纹明确指定受信叶证书；后续握手签名仍必须证明对端持有对应私钥。
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(message, cert, dss, &self.algorithms)
    }

    fn verify_tls13_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(message, cert, dss, &self.algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.algorithms.supported_schemes()
    }
}

fn build_fingerprint_tls_config(expected_fingerprint: &str) -> Result<rustls::ClientConfig, String> {
    if expected_fingerprint.trim().is_empty() {
        return Err("证书指纹模式需要提供 SHA256 指纹。".into());
    }
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let verifier = FingerprintVerifier {
        expected_fingerprint: expected_fingerprint.trim().to_string(),
        algorithms: provider.signature_verification_algorithms,
    };
    Ok(rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|error| format!("无法创建证书指纹 TLS 配置：{error}"))?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier))
        .with_no_client_auth())
}

fn es_http_client_builder(
    tls: Option<&ConnectionTlsConfig>,
    insecure_tls: bool,
) -> Result<reqwest::blocking::ClientBuilder, String> {
    let mode = resolve_tls_mode(tls, insecure_tls);
    let mut builder = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(60))
        .connect_timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none());

    match mode {
        ConnectionTlsMode::Default => {}
        ConnectionTlsMode::CertificateFingerprint => {
            let fingerprint = tls.and_then(|value| value.fingerprint.as_deref()).unwrap_or("");
            builder = builder.use_preconfigured_tls(build_fingerprint_tls_config(fingerprint)?);
        }
        ConnectionTlsMode::Insecure => {
            builder = builder
                .danger_accept_invalid_certs(true)
                .danger_accept_invalid_hostnames(true);
        }
        ConnectionTlsMode::CaCertificate => {
            let ca_path = tls
                .and_then(|value| value.ca_path.as_deref())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "CA 证书模式需要提供证书路径。".to_string())?;
            let certificate_bytes = fs::read(ca_path).map_err(|error| format!("无法读取 CA 证书 {ca_path}：{error}"))?;
            let certificate = reqwest::Certificate::from_pem(&certificate_bytes)
                .or_else(|_| reqwest::Certificate::from_der(&certificate_bytes))
                .map_err(|error| format!("无法加载 CA 证书 {ca_path}：{error}"))?;
            builder = builder.add_root_certificate(certificate);
        }
    }

    Ok(builder)
}

fn build_es_http_client(tls: Option<&ConnectionTlsConfig>, insecure_tls: bool) -> Result<reqwest::blocking::Client, String> {
    es_http_client_builder(tls, insecure_tls)?.build()
        .map_err(|error| format!("无法创建 Elasticsearch HTTP 客户端：{error}"))
}

fn map_reqwest_error(error: reqwest::Error) -> String {
    let error = error.without_url();
    if error.is_timeout() {
        return "请求超时，请检查 SSH 通道、网络或 Elasticsearch 响应时间。".into();
    }

    if error.is_connect() {
        return format!("无法通过 SSH 通道连接 Elasticsearch：{error}");
    }

    error.to_string()
}

fn authenticate_ssh(session: &Session, config: &SshTunnelConfig, ssh_secret: Option<&str>) -> Result<(), String> {
    match config.auth_method {
        SshAuthMethod::Password => {
            let password = ssh_secret
                .filter(|secret| !secret.is_empty())
                .ok_or_else(|| "SSH 已启用密码认证，但未找到已保存的 SSH 密码。".to_string())?;

            session
                .userauth_password(&config.username, password)
                .map_err(|error| format!("SSH 密码认证失败：{error}"))?;
        }
        SshAuthMethod::PrivateKey => {
            let private_key_path = config.private_key_path.trim();
            if private_key_path.is_empty() {
                return Err("SSH 私钥路径不能为空。".into());
            }

            session
                .userauth_pubkey_file(
                    &config.username,
                    None,
                    Path::new(private_key_path),
                    ssh_secret.filter(|secret| !secret.is_empty()),
                )
                .map_err(|error| format!("SSH 私钥认证失败：{error}"))?;
        }
    }

    if session.authenticated() {
        Ok(())
    } else {
        Err("SSH 认证未通过。".into())
    }
}

fn perform_ssh_validation(payload: ValidateSshTunnelPayload) -> TunnelValidationResponsePayload {
    let auth_label = match payload.ssh_tunnel.auth_method {
        SshAuthMethod::Password => "密码",
        SshAuthMethod::PrivateKey => "私钥",
    };
    let mut diagnostics = vec![format!(
        "开始验证 SSH 通道，目标 {}@{}:{}，认证方式：{}",
        payload.ssh_tunnel.username,
        payload.ssh_tunnel.host,
        payload.ssh_tunnel.port,
        auth_label
    )];

    let result = (|| -> Result<(), String> {
        require_ssh_trusted_key(&payload.ssh_tunnel, true)?;
        let tcp_stream = TcpStream::connect((payload.ssh_tunnel.host.as_str(), payload.ssh_tunnel.port))
            .map_err(|error| format!("无法连接 SSH 主机 {}:{}：{error}", payload.ssh_tunnel.host, payload.ssh_tunnel.port))?;
        diagnostics.push("SSH TCP 连接已建立。".into());

        let mut session = Session::new().map_err(|error| format!("无法创建 SSH 会话：{error}"))?;
        session.set_tcp_stream(tcp_stream);
        session.handshake().map_err(|error| format!("SSH 握手失败：{error}"))?;
        diagnostics.push("SSH 握手成功。".into());

        let fingerprint = verify_ssh_host_key(&payload.ssh_tunnel, session.host_key_hash(ssh2::HashType::Sha256), true)?;
        diagnostics.push(format!("SSH 主机指纹：{fingerprint}"));
        authenticate_ssh(&session, &payload.ssh_tunnel, payload.ssh_secret.as_deref())?;
        diagnostics.push("SSH 认证成功。".into());

        let _ = session.disconnect(None, "esx validation completed", None);
        Ok(())
    })();

    match result {
        Ok(()) => TunnelValidationResponsePayload {
            ok: true,
            host_key_sha256: diagnostics
                .iter()
                .find_map(|line| line.strip_prefix("SSH 主机指纹：").map(|value| value.to_string())),
            error_message: None,
            diagnostics,
        },
        Err(error) => {
            diagnostics.push(error.clone());
            TunnelValidationResponsePayload {
                ok: false,
                host_key_sha256: diagnostics
                    .iter()
                    .find_map(|line| line.strip_prefix("SSH 主机指纹：").map(|value| value.to_string())),
                error_message: Some(error),
                diagnostics,
            }
        }
    }
}

fn build_remote_curl_command(payload: &ExecuteSshHttpRequestPayload) -> String {
    let _ = payload;
    "sh -s".into()
}

fn curl_config_value(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
    )
}

fn heredoc_delimiter(prefix: &str, content: &str) -> String {
    let mut delimiter = prefix.to_string();
    let mut index = 0_u32;
    while content.lines().any(|line| line == delimiter) {
        index += 1;
        delimiter = format!("{prefix}_{index}");
    }
    delimiter
}

fn build_remote_curl_script(payload: &ExecuteSshHttpRequestPayload) -> String {
    let authorization = format!(
        "Authorization: {}",
        build_authorization_header(
            payload.auth.as_ref(),
            &payload.username,
            &payload.password,
            payload.auth_secret.as_deref(),
        )
    );
    let mut config_lines = vec![
        "silent".to_string(),
        "show-error".to_string(),
        "http1.1".to_string(),
        format!("request = {}", curl_config_value(&payload.method)),
        format!("header = {}", curl_config_value("Accept: application/json, text/plain, */*")),
        format!("header = {}", curl_config_value("Connection: close")),
        format!("header = {}", curl_config_value(&authorization)),
        format!("url = {}", curl_config_value(&payload.url)),
        format!("write-out = {}", curl_config_value("\n__ESX_STATUS__:%{http_code}\n")),
    ];

    if payload.insecure_tls {
        config_lines.push("insecure".to_string());
    }

    if !payload.body_text.is_empty() {
        config_lines.push(format!(
            "header = {}",
            curl_config_value(&format!("Content-Type: {}", payload.content_type.as_deref().unwrap_or("application/json")))
        ));
    }

    let config_text = config_lines.join("\n");
    let config_delimiter = heredoc_delimiter("__ESX_CURL_CONFIG__", &config_text);
    let mut script = format!(
        "set -eu\n\
         config_file=$(mktemp)\n\
         body_file=\n\
         body_b64_file=\n\
         cleanup() {{\n\
         \trm -f \"$config_file\"\n\
         \tif [ -n \"$body_file\" ]; then rm -f \"$body_file\"; fi\n\
         \tif [ -n \"$body_b64_file\" ]; then rm -f \"$body_b64_file\"; fi\n\
         }}\n\
         trap cleanup EXIT HUP INT TERM\n\
         cat > \"$config_file\" <<'{config_delimiter}'\n\
         {config_text}\n\
         {config_delimiter}\n"
    );

    if !payload.body_text.is_empty() {
        let encoded_body = base64_encode(payload.body_text.as_bytes());
        let body_delimiter = heredoc_delimiter("__ESX_BODY_B64__", &encoded_body);
        script.push_str(&format!(
            "body_file=$(mktemp)\n\
             body_b64_file=$(mktemp)\n\
             cat > \"$body_b64_file\" <<'{body_delimiter}'\n\
             {encoded_body}\n\
             {body_delimiter}\n\
             if base64 -d \"$body_b64_file\" > \"$body_file\" 2>/dev/null; then\n\
             \t:\n\
             elif base64 -D \"$body_b64_file\" > \"$body_file\" 2>/dev/null; then\n\
             \t:\n\
             elif command -v openssl >/dev/null 2>&1 && openssl base64 -d -A -in \"$body_b64_file\" -out \"$body_file\" 2>/dev/null; then\n\
             \t:\n\
             else\n\
             \techo '无法在 SSH 主机上解码请求体。' >&2\n\
             \texit 97\n\
             fi\n\
             printf '%s\\n' \"data-binary = \\\"@$body_file\\\"\" >> \"$config_file\"\n"
        ));
    }

    script.push_str("curl --config \"$config_file\"\n");
    script
}

fn parse_remote_curl_output(stdout: &str) -> Result<(u16, String), String> {
    const STATUS_MARKER: &str = "\n__ESX_STATUS__:";

    let marker_index = stdout
        .rfind(STATUS_MARKER)
        .ok_or_else(|| "无法从远程 curl 输出中解析 HTTP 状态码。".to_string())?;
    let body_text = stdout[..marker_index].to_string();
    let status_line = stdout[marker_index + STATUS_MARKER.len()..].trim();
    let status = status_line
        .parse::<u16>()
        .map_err(|error| format!("远程 curl 返回了无法识别的状态码：{error}"))?;

    Ok((status, body_text))
}

fn perform_es_http_request(payload: ExecuteEsHttpRequestPayload) -> Result<HttpResponsePayload, DiagnosticFailure> {
    let url = validate_es_request_url(&payload.base_url, &payload.url)
        .map_err(|error| DiagnosticFailure::new(error, vec![]))?;
    let mut diagnostics = vec![format!("开始执行 Elasticsearch 请求：{} {}{}", payload.method, url.origin().ascii_serialization(), url.path())];
    if matches!(
        resolve_tls_mode(payload.tls.as_ref(), payload.insecure_tls),
        ConnectionTlsMode::CertificateFingerprint
    ) {
        if url.scheme() != "https" {
            return Err(DiagnosticFailure::new("证书指纹 TLS 模式仅支持 HTTPS Elasticsearch 地址。", diagnostics));
        }
    }

    let client = build_es_http_client(payload.tls.as_ref(), payload.insecure_tls).map_err(|error| {
        diagnostics.push(error.clone());
        DiagnosticFailure::new(error, diagnostics.clone())
    })?;
    let method = Method::from_bytes(payload.method.as_bytes()).map_err(|error| {
        diagnostics.push(error.to_string());
        DiagnosticFailure::new(format!("HTTP 方法无效：{error}"), diagnostics.clone())
    })?;
    let mut request = client
        .request(method, url)
        .header("Accept", "application/json, text/plain, */*")
        .header(
            "Authorization",
            build_authorization_header(
                payload.auth.as_ref(),
                &payload.username,
                &payload.password,
                payload.auth_secret.as_deref(),
            ),
        );

    if !payload.body_text.is_empty() {
        request = request
            .header("Content-Type", payload.content_type.as_deref().unwrap_or("application/json"))
            .body(payload.body_text);
    }

    let response = request.send().map_err(|error| {
        let message = map_reqwest_error(error);
        diagnostics.push(message.clone());
        DiagnosticFailure::new(message, diagnostics.clone())
    })?;
    let status = response.status();
    let status_code = status.as_u16();
    let status_text = status
        .canonical_reason()
        .map(|value| value.to_string())
        .unwrap_or_else(|| status.as_str().to_string());
    let body_text = response.text().map_err(|error| {
        let message = format!("读取 Elasticsearch 响应失败：{error}");
        diagnostics.push(message.clone());
        DiagnosticFailure::new(message, diagnostics.clone())
    })?;

    diagnostics.push(format!("收到 Elasticsearch 响应，状态 {}。", status_code));
    Ok(HttpResponsePayload {
        ok: status.is_success(),
        status: status_code,
        status_text,
        body_text,
        error_message: None,
        diagnostics,
    })
}

fn resolve_es_request_url(base_url: &str, path: &str) -> String {
    format!("{}{}", base_url.trim_end_matches('/'), path)
}

fn looks_like_elasticsearch_probe_response(path: &str, body_text: &str) -> bool {
    if path == "/" {
        return body_text.contains("\"version\"")
            && (body_text.contains("\"tagline\"")
                || body_text.contains("\"cluster_name\"")
                || body_text.contains("\"cluster_uuid\"")
                || body_text.contains("\"name\""));
    }
    if path == "/_cluster/health" {
        return body_text.contains("\"cluster_name\"") && body_text.contains("\"status\"");
    }
    path == "/_security/_authenticate" && body_text.contains("\"username\"")
}

fn perform_es_connection_validation(payload: ValidateEsConnectionPayload) -> HttpResponsePayload {
    if let Err(error) = validate_http_url(&payload.base_url) {
        return build_request_failed_payload(error, vec![]);
    }
    let probes = ["/", "/_cluster/health", "/_security/_authenticate"];
    let mut diagnostics = vec![format!("开始验证 Elasticsearch 连接：{}", payload.base_url)];
    let mut last_response: Option<HttpResponsePayload> = None;

    for path in probes {
        let probe_payload = ExecuteEsHttpRequestPayload {
            base_url: payload.base_url.clone(),
            url: resolve_es_request_url(&payload.base_url, path),
            method: "GET".into(),
            auth: payload.auth.clone(),
            username: payload.username.clone(),
            password: payload.password.clone(),
            auth_secret: payload.auth_secret.clone(),
            body_text: String::new(),
            content_type: None,
            insecure_tls: payload.insecure_tls,
            tls: payload.tls.clone(),
        };
        match perform_es_http_request(probe_payload) {
            Ok(response) => {
                diagnostics.push(format!("探测 {path} -> {} {}", response.status, response.status_text));
                diagnostics.extend(response.diagnostics.clone());
                if response.ok && looks_like_elasticsearch_probe_response(path, &response.body_text) {
                    return HttpResponsePayload {
                        diagnostics,
                        ..response
                    };
                }
                last_response = Some(response);
            }
            Err(error) => {
                diagnostics.push(format!("探测 {path} 失败：{}", error.message));
                diagnostics.extend(error.diagnostics);
                last_response = Some(build_request_failed_payload(
                    format!("连接验证失败：{}", diagnostics.last().cloned().unwrap_or_default()),
                    diagnostics.clone(),
                ));
            }
        }
    }

    last_response.unwrap_or_else(|| build_request_failed_payload("连接验证失败。".into(), diagnostics))
}

fn perform_ai_http_request(payload: ExecuteAiHttpRequestPayload) -> Result<HttpResponsePayload, DiagnosticFailure> {
    let parsed_url = validate_http_url(&payload.url).map_err(|error| DiagnosticFailure::new(error, vec![]))?;
    let mut diagnostics = vec![format!("开始执行 AI HTTP 请求：{} {}{}", payload.method, parsed_url.origin().ascii_serialization(), parsed_url.path())];

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| {
            diagnostics.push(error.to_string());
            DiagnosticFailure::new(format!("无法创建 AI HTTP 客户端：{error}"), diagnostics.clone())
        })?;
    let method = Method::from_bytes(payload.method.as_bytes()).map_err(|error| {
        diagnostics.push(error.to_string());
        DiagnosticFailure::new(format!("AI HTTP 方法无效：{error}"), diagnostics.clone())
    })?;
    let mut request = client.request(method, parsed_url);
    request = request.header("Accept", payload.accept.as_deref().unwrap_or("application/json"));
    if let Some(api_key) = payload.api_key.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        request = request.header("Authorization", format!("Bearer {api_key}"));
    }
    if let Some(body_text) = payload.body_text.filter(|value| !value.is_empty()) {
        request = request
            .header("Content-Type", payload.content_type.as_deref().unwrap_or("application/json"))
            .body(body_text);
    }

    let response = request.send().map_err(|error| {
        let message = map_reqwest_error(error);
        diagnostics.push(message.clone());
        DiagnosticFailure::new(message, diagnostics.clone())
    })?;
    let status = response.status();
    let status_code = status.as_u16();
    let status_text = status
        .canonical_reason()
        .map(|value| value.to_string())
        .unwrap_or_else(|| status.as_str().to_string());
    let body_text = response.text().map_err(|error| {
        let message = format!("读取 AI 服务响应失败：{error}");
        diagnostics.push(message.clone());
        DiagnosticFailure::new(message, diagnostics.clone())
    })?;

    diagnostics.push(format!("收到 AI 服务响应，状态 {}。", status_code));
    Ok(HttpResponsePayload {
        ok: status.is_success(),
        status: status_code,
        status_text,
        body_text,
        error_message: None,
        diagnostics,
    })
}

fn perform_ssh_http_request(payload: ExecuteSshHttpRequestPayload) -> Result<HttpResponsePayload, DiagnosticFailure> {
    let url = validate_es_request_url(&payload.base_url, &payload.url)
        .map_err(|error| DiagnosticFailure::new(error, vec![]))?;
    if matches!(resolve_tls_mode(payload.tls.as_ref(), payload.insecure_tls), ConnectionTlsMode::CaCertificate | ConnectionTlsMode::CertificateFingerprint) {
        return Err(DiagnosticFailure::new("SSH 远程请求暂不支持 CA 证书或证书指纹 TLS 模式，请使用直连。", vec![]));
    }
    require_ssh_trusted_key(&payload.ssh_tunnel, false)
        .map_err(|error| DiagnosticFailure::new(error, vec![]))?;
    let auth_label = match payload.ssh_tunnel.auth_method {
        SshAuthMethod::Password => "密码",
        SshAuthMethod::PrivateKey => "私钥",
    };
    let mut diagnostics = vec![format!(
        "准备通过 SSH 通道访问 {}，SSH 主机 {}@{}:{}，认证方式：{}",
        format!("{}{}", url.origin().ascii_serialization(), url.path()),
        payload.ssh_tunnel.username,
        payload.ssh_tunnel.host,
        payload.ssh_tunnel.port,
        auth_label
    )];

    let host = url
        .host_str()
        .ok_or_else(|| {
            diagnostics.push("请求地址中没有可用的主机名。".into());
            DiagnosticFailure::new("请求地址缺少主机名，无法通过 SSH 主机发起请求。", diagnostics.clone())
        })?
        .to_string();
    let target_port = url
        .port_or_known_default()
        .ok_or_else(|| {
            diagnostics.push("请求地址中没有可用端口。".into());
            DiagnosticFailure::new("请求地址缺少端口，无法通过 SSH 主机发起请求。", diagnostics.clone())
        })?;
    diagnostics.push(format!("目标 Elasticsearch：{}:{}", host, target_port));

    diagnostics.push("开始建立 SSH 会话。".into());
    let tcp_stream = TcpStream::connect((payload.ssh_tunnel.host.as_str(), payload.ssh_tunnel.port))
        .map_err(|error| {
            diagnostics.push(error.to_string());
            DiagnosticFailure::new(
                format!("无法连接 SSH 主机 {}:{}：{error}", payload.ssh_tunnel.host, payload.ssh_tunnel.port),
                diagnostics.clone(),
            )
        })?;

    let mut session = Session::new().map_err(|error| {
        diagnostics.push(error.to_string());
        DiagnosticFailure::new(format!("无法创建 SSH 会话：{error}"), diagnostics.clone())
    })?;
    session.set_tcp_stream(tcp_stream);
    session.handshake().map_err(|error| {
        diagnostics.push(error.to_string());
        DiagnosticFailure::new(format!("SSH 握手失败：{error}"), diagnostics.clone())
    })?;
    verify_ssh_host_key(&payload.ssh_tunnel, session.host_key_hash(ssh2::HashType::Sha256), false)
        .map_err(|error| DiagnosticFailure::new(error, diagnostics.clone()))?;
    authenticate_ssh(&session, &payload.ssh_tunnel, payload.ssh_secret.as_deref()).map_err(|error| {
        diagnostics.push(error.clone());
        DiagnosticFailure::new(error, diagnostics.clone())
    })?;
    diagnostics.push("SSH 会话已建立，开始在远程主机执行 curl。".into());

    let command = build_remote_curl_command(&payload);
    let mut channel = session.channel_session().map_err(|error| {
        diagnostics.push(error.to_string());
        DiagnosticFailure::new(format!("无法创建 SSH 执行通道：{error}"), diagnostics.clone())
    })?;
    channel.exec(&command).map_err(|error| {
        diagnostics.push(error.to_string());
        DiagnosticFailure::new(format!("无法在 SSH 主机上启动 curl：{error}"), diagnostics.clone())
    })?;

    let script = build_remote_curl_script(&payload);
    channel.write_all(script.as_bytes()).map_err(|error| {
        diagnostics.push(error.to_string());
        DiagnosticFailure::new(format!("无法向 SSH 主机写入远程 curl 脚本：{error}"), diagnostics.clone())
    })?;
    let _ = channel.send_eof();

    let mut stdout = String::new();
    channel.read_to_string(&mut stdout).map_err(|error| {
        diagnostics.push(error.to_string());
        DiagnosticFailure::new(format!("读取远程 curl 标准输出失败：{error}"), diagnostics.clone())
    })?;

    let mut stderr = String::new();
    channel.stderr().read_to_string(&mut stderr).map_err(|error| {
        diagnostics.push(error.to_string());
        DiagnosticFailure::new(format!("读取远程 curl 错误输出失败：{error}"), diagnostics.clone())
    })?;

    let _ = channel.wait_close();
    let exit_status = channel.exit_status().unwrap_or(-1);
    if !stderr.trim().is_empty() {
        diagnostics.push(format!("远程 curl stderr：{}", stderr.trim()));
    }
    diagnostics.push(format!("远程 curl 退出码：{}", exit_status));

    if exit_status != 0 {
        let message = if !stderr.trim().is_empty() {
            format!("远程 curl 执行失败：{}", stderr.trim())
        } else {
            format!("远程 curl 执行失败，退出码 {}", exit_status)
        };
        diagnostics.push(message.clone());
        return Err(DiagnosticFailure::new(message, diagnostics));
    }

    let (status_code, body_text) = parse_remote_curl_output(&stdout).map_err(|error| {
        diagnostics.push(error.clone());
        DiagnosticFailure::new(error, diagnostics.clone())
    })?;
    let status = StatusCode::from_u16(status_code).unwrap_or(StatusCode::BAD_GATEWAY);
    let status_text = status
        .canonical_reason()
        .map(|value| value.to_string())
        .unwrap_or_else(|| status.as_str().to_string());

    diagnostics.push(format!("收到 Elasticsearch 响应，状态 {}。", status_code));

    Ok(HttpResponsePayload {
        ok: status.is_success(),
        status: status_code,
        status_text,
        body_text,
        error_message: None,
        diagnostics: {
            diagnostics.push(format!("HTTP 请求完成，状态 {}", status_code));
            diagnostics
        },
    })
}

#[tauri::command]
async fn execute_es_http_request(payload: ExecuteEsHttpRequestPayload) -> Result<HttpResponsePayload, String> {
    tauri::async_runtime::spawn_blocking(move || match perform_es_http_request(payload) {
        Ok(response) => response,
        Err(error) => build_request_failed_payload(error.message, error.diagnostics),
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn validate_es_connection(payload: ValidateEsConnectionPayload) -> Result<HttpResponsePayload, String> {
    tauri::async_runtime::spawn_blocking(move || perform_es_connection_validation(payload))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn execute_ai_http_request(payload: ExecuteAiHttpRequestPayload) -> Result<HttpResponsePayload, String> {
    tauri::async_runtime::spawn_blocking(move || match perform_ai_http_request(payload) {
        Ok(response) => response,
        Err(error) => build_request_failed_payload(error.message, error.diagnostics),
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn execute_ssh_http_request(payload: ExecuteSshHttpRequestPayload) -> Result<HttpResponsePayload, String> {
    tauri::async_runtime::spawn_blocking(move || match perform_ssh_http_request(payload) {
        Ok(response) => response,
        Err(error) => build_request_failed_payload(error.message, error.diagnostics),
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn validate_ssh_tunnel(payload: ValidateSshTunnelPayload) -> Result<TunnelValidationResponsePayload, String> {
    tauri::async_runtime::spawn_blocking(move || perform_ssh_validation(payload))
        .await
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_prevent_default::Builder::new()
                .with_flags(Flags::CONTEXT_MENU)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_secrets_vault,
            save_connection_password,
            get_connection_password,
            delete_connection_password,
            save_connection_secret,
            get_connection_secret,
            delete_connection_secret,
            save_ai_api_key,
            get_ai_api_key,
            delete_ai_api_key,
            execute_es_http_request,
            validate_es_connection,
            execute_ai_http_request,
            execute_ssh_http_request,
            validate_ssh_tunnel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod security_tests;

#[cfg(test)]
mod tests {
    use super::*;

    fn request_payload(url: &str, base_url: &str) -> ExecuteEsHttpRequestPayload {
        serde_json::from_value(serde_json::json!({
            "url": url, "baseUrl": base_url, "method": "GET",
            "username": "fixture-user", "password": "fixture-password",
            "bodyText": "", "insecureTls": false
        })).unwrap()
    }

    fn ssh_payload(tls_mode: Option<&str>) -> ExecuteSshHttpRequestPayload {
        serde_json::from_value(serde_json::json!({
            "url": "https://es.example.invalid/", "baseUrl": "https://es.example.invalid",
            "method": "GET", "username": "fixture-user", "password": "fixture-password",
            "bodyText": "", "insecureTls": false,
            "tls": tls_mode.map(|mode| serde_json::json!({ "mode": mode, "fingerprint": "00".repeat(32), "caPath": "/fixture/ca.pem" })),
            "sshTunnel": { "host": "127.0.0.1", "port": 0, "username": "fixture-user",
                "authMethod": "password", "privateKeyPath": "", "hostKeyPolicy": "strict" },
            "sshSecret": "fixture-password"
        })).unwrap()
    }

    #[test]
    fn rejects_cross_origin_requests_before_sending_credentials() {
        let failure = perform_es_http_request(request_payload("http://127.0.0.1:0/", "https://es.example.invalid"))
            .unwrap_err();
        assert!(failure.message.contains("同源"), "{}", failure.message);
    }

    #[test]
    fn rejects_url_credentials_without_echoing_them() {
        let failure = perform_es_http_request(request_payload(
            "http://fixture-user:fixture-password@127.0.0.1:0/", "http://127.0.0.1:0"
        )).unwrap_err();
        assert!(failure.message.contains("用户名或密码"), "{}", failure.message);
        assert!(!format!("{failure:?}").contains("fixture-password"));
    }

    #[test]
    fn rejects_missing_ssh_pin_before_connecting() {
        let failure = perform_ssh_http_request(ssh_payload(None)).unwrap_err();
        assert!(failure.message.contains("可信指纹"), "{}", failure.message);
    }

    #[test]
    fn rejects_strict_ssh_validation_without_pin_before_connecting() {
        let payload = ssh_payload(None);
        let result = perform_ssh_validation(ValidateSshTunnelPayload {
            ssh_tunnel: payload.ssh_tunnel, ssh_secret: payload.ssh_secret,
        });
        assert!(result.error_message.unwrap().contains("可信指纹"));
    }

    #[test]
    fn rejects_unsupported_ssh_tls_modes_before_connecting() {
        for mode in ["caCertificate", "certificateFingerprint"] {
            let failure = perform_ssh_http_request(ssh_payload(Some(mode))).unwrap_err();
            assert!(failure.message.contains("SSH") && failure.message.contains("TLS"), "{}", failure.message);
        }
    }

    #[test]
    fn rejects_missing_tls_fingerprint_when_building_client() {
        let tls = ConnectionTlsConfig { mode: Some(ConnectionTlsMode::CertificateFingerprint), ca_path: None, fingerprint: None };
        assert!(build_es_http_client(Some(&tls), false).is_err());
    }

    #[test]
    fn builds_authorization_headers_for_supported_auth_types() {
        assert_eq!(
            build_authorization_header(
                Some(&ConnectionAuthConfig {
                    auth_type: None,
                    r#type: Some(ConnectionAuthType::Basic),
                }),
                "elastic",
                "fallback",
                Some("elastic:secret"),
            ),
            "Basic ZWxhc3RpYzpzZWNyZXQ="
        );
        assert_eq!(
            build_authorization_header(
                Some(&ConnectionAuthConfig {
                    auth_type: None,
                    r#type: Some(ConnectionAuthType::ApiKey),
                }),
                "elastic",
                "fallback",
                Some("encoded-key"),
            ),
            "ApiKey encoded-key"
        );
        assert_eq!(
            build_authorization_header(
                Some(&ConnectionAuthConfig {
                    auth_type: None,
                    r#type: Some(ConnectionAuthType::Bearer),
                }),
                "elastic",
                "fallback",
                Some("token"),
            ),
            "Bearer token"
        );
    }

    #[test]
    fn resolves_legacy_insecure_tls_mode() {
        assert!(matches!(resolve_tls_mode(None, true), ConnectionTlsMode::Insecure));
        assert!(matches!(resolve_tls_mode(None, false), ConnectionTlsMode::Default));
    }

    #[test]
    fn matches_sha256_fingerprint_formats() {
        let digest = [7_u8; 32];
        let hex = compact_hex(&digest);
        let colon_hex = hex
            .as_bytes()
            .chunks(2)
            .map(|chunk| std::str::from_utf8(chunk).unwrap())
            .collect::<Vec<_>>()
            .join(":");

        assert!(fingerprint_matches(&format!("SHA256:{}", base64_encode(&digest)), &digest));
        assert!(fingerprint_matches(&hex, &digest));
        assert!(fingerprint_matches(&colon_hex, &digest));
        assert!(!fingerprint_matches("SHA256:not-the-same", &digest));
    }

    #[test]
    fn remote_curl_command_does_not_expose_authorization_secret() {
        let payload = ExecuteSshHttpRequestPayload {
            base_url: "https://es.example.com:9200".into(),
            url: "https://es.example.com:9200/orders/_bulk".into(),
            method: "POST".into(),
            auth: Some(ConnectionAuthConfig {
                auth_type: None,
                r#type: Some(ConnectionAuthType::Basic),
            }),
            username: "elastic".into(),
            password: "fallback".into(),
            auth_secret: Some("elastic:secret".into()),
            body_text: "{\"index\":{}}\n{\"id\":1}".into(),
            content_type: Some("application/x-ndjson".into()),
            insecure_tls: false,
            tls: None,
            ssh_tunnel: SshTunnelConfig {
                host: "jump.example.com".into(),
                port: 22,
                username: "ops".into(),
                auth_method: SshAuthMethod::Password,
                private_key_path: String::new(),
                host_key_policy: None,
                trusted_host_key_sha256: None,
            },
            ssh_secret: Some("ssh-password".into()),
        };

        let command = build_remote_curl_command(&payload);

        assert_eq!(command, "sh -s");
        assert!(!command.contains("Authorization"));
        assert!(!command.contains("secret"));
    }
}
