use std::{
    io::{ErrorKind, Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    path::Path,
    sync::mpsc::{self, Receiver, Sender},
    thread,
    time::Duration,
};

use keyring::{Entry, Error as KeyringError};
use reqwest::{Method, StatusCode, Url};
use serde::{Deserialize, Serialize};
use ssh2::Session;
use tauri_plugin_prevent_default::Flags;

const KEYRING_SERVICE: &str = "com.ushopal.esx";
const BRIDGE_IDLE_SLEEP: Duration = Duration::from_millis(10);
const SSH_READY_TIMEOUT: Duration = Duration::from_secs(15);
const SSH_ERROR_GRACE_PERIOD: Duration = Duration::from_millis(500);

fn service_name_for(connection_id: &str) -> String {
    format!("{KEYRING_SERVICE}.{connection_id}")
}

fn entry_for(connection_id: &str, account: &str) -> Result<Entry, String> {
    Entry::new(&service_name_for(connection_id), account).map_err(|error| error.to_string())
}

fn save_secret(connection_id: &str, account: &str, secret: &str) -> Result<(), String> {
    entry_for(connection_id, account)?
        .set_password(secret)
        .map_err(|error| error.to_string())
}

fn get_secret(connection_id: &str, account: &str) -> Result<Option<String>, String> {
    match entry_for(connection_id, account)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn delete_secret(connection_id: &str, account: &str) -> Result<(), String> {
    match entry_for(connection_id, account)?.delete_credential() {
        Ok(_) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn save_connection_password(connection_id: String, username: String, password: String) -> Result<(), String> {
    save_secret(&connection_id, &username, &password)
}

#[tauri::command]
fn get_connection_password(connection_id: String, username: String) -> Result<Option<String>, String> {
    get_secret(&connection_id, &username)
}

#[tauri::command]
fn delete_connection_password(connection_id: String, username: String) -> Result<(), String> {
    delete_secret(&connection_id, &username)
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
enum SshAuthMethod {
    Password,
    PrivateKey,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SshTunnelConfig {
    host: String,
    port: u16,
    username: String,
    auth_method: SshAuthMethod,
    private_key_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteSshHttpRequestPayload {
    url: String,
    method: String,
    username: String,
    password: String,
    body_text: String,
    insecure_tls: bool,
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
    error_message: Option<String>,
    diagnostics: Vec<String>,
}

#[derive(Debug)]
enum TunnelStatus {
    Ready,
    Error(String),
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

fn map_reqwest_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        return "请求超时，请检查 SSH 通道、网络或 Elasticsearch 响应时间。".into();
    }

    if error.is_connect() {
        return format!("无法通过 SSH 通道连接 Elasticsearch：{error}");
    }

    error.to_string()
}

fn map_http_over_ssh_error(error: reqwest::Error) -> String {
    let base = map_reqwest_error(error);
    format!(
        "通过 SSH 通道访问 Elasticsearch 失败：{base}。请检查 SSH 主机是否可达、认证方式是否正确，以及 Elasticsearch 地址是否能从 SSH 主机访问。"
    )
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
        let tcp_stream = TcpStream::connect((payload.ssh_tunnel.host.as_str(), payload.ssh_tunnel.port))
            .map_err(|error| format!("无法连接 SSH 主机 {}:{}：{error}", payload.ssh_tunnel.host, payload.ssh_tunnel.port))?;
        diagnostics.push("SSH TCP 连接已建立。".into());

        let mut session = Session::new().map_err(|error| format!("无法创建 SSH 会话：{error}"))?;
        session.set_tcp_stream(tcp_stream);
        session.handshake().map_err(|error| format!("SSH 握手失败：{error}"))?;
        diagnostics.push("SSH 握手成功。".into());

        authenticate_ssh(&session, &payload.ssh_tunnel, payload.ssh_secret.as_deref())?;
        diagnostics.push("SSH 认证成功。".into());

        let _ = session.disconnect(None, "esx validation completed", None);
        Ok(())
    })();

    match result {
        Ok(()) => TunnelValidationResponsePayload {
            ok: true,
            error_message: None,
            diagnostics,
        },
        Err(error) => {
            diagnostics.push(error.clone());
            TunnelValidationResponsePayload {
                ok: false,
                error_message: Some(error),
                diagnostics,
            }
        }
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn build_remote_curl_command(payload: &ExecuteSshHttpRequestPayload) -> String {
    let mut command = format!(
        "curl -sS --http1.1 -X {} -H {} -H {} -u {}",
        shell_quote(&payload.method),
        shell_quote("Accept: application/json, text/plain, */*"),
        shell_quote("Connection: close"),
        shell_quote(&format!("{}:{}", payload.username, payload.password)),
    );

    if payload.insecure_tls {
        command.push_str(" -k");
    }

    if !payload.body_text.is_empty() {
        command.push_str(&format!(
            " -H {} --data-binary @-",
            shell_quote("Content-Type: application/json")
        ));
    }

    command.push(' ');
    command.push_str(&shell_quote(&payload.url));
    command.push_str(" -w ");
    command.push_str(&shell_quote("\n__ESX_STATUS__:%{http_code}\n"));

    command
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

fn bridge_connection(
    mut client: TcpStream,
    session: &Session,
    channel: &mut ssh2::Channel,
    stop_rx: &Receiver<()>,
) -> Result<(), String> {
    client
        .set_nonblocking(true)
        .map_err(|error| format!("本地隧道配置失败：{error}"))?;

    session.set_blocking(false);

    let mut client_to_remote = Vec::<u8>::new();
    let mut remote_to_client = Vec::<u8>::new();
    let mut client_eof = false;
    let mut remote_eof = false;
    let mut stop_requested = false;
    let mut buffer = [0_u8; 16 * 1024];

    loop {
        if !stop_requested && stop_rx.try_recv().is_ok() {
            stop_requested = true;
        }

        if !client_eof {
            match client.read(&mut buffer) {
                Ok(0) => {
                    client_eof = true;
                    let _ = channel.send_eof();
                }
                Ok(size) => client_to_remote.extend_from_slice(&buffer[..size]),
                Err(error) if error.kind() == ErrorKind::WouldBlock => {}
                Err(error) => return Err(format!("本地隧道读取失败：{error}")),
            }
        }

        while !client_to_remote.is_empty() {
            match channel.write(&client_to_remote) {
                Ok(0) => break,
                Ok(size) => {
                    client_to_remote.drain(..size);
                }
                Err(error) if error.kind() == ErrorKind::WouldBlock => break,
                Err(error) => return Err(format!("SSH 隧道写入失败：{error}")),
            }
        }

        if !remote_eof {
            match channel.read(&mut buffer) {
                Ok(0) => remote_eof = true,
                Ok(size) => remote_to_client.extend_from_slice(&buffer[..size]),
                Err(error) if error.kind() == ErrorKind::WouldBlock => {}
                Err(error) => return Err(format!("SSH 隧道读取失败：{error}")),
            }
        }

        while !remote_to_client.is_empty() {
            match client.write(&remote_to_client) {
                Ok(0) => break,
                Ok(size) => {
                    remote_to_client.drain(..size);
                }
                Err(error) if error.kind() == ErrorKind::WouldBlock => break,
                Err(error) => return Err(format!("本地隧道写入失败：{error}")),
            }
        }

        if stop_requested && client_to_remote.is_empty() && remote_to_client.is_empty() {
            break;
        }

        if client_eof && remote_eof && client_to_remote.is_empty() && remote_to_client.is_empty() {
            break;
        }

        thread::sleep(BRIDGE_IDLE_SLEEP);
    }

    Ok(())
}

fn spawn_single_use_tunnel(
    listener: TcpListener,
    ssh_config: SshTunnelConfig,
    ssh_secret: Option<String>,
    target_host: String,
    target_port: u16,
    status_tx: Sender<TunnelStatus>,
    stop_rx: Receiver<()>,
) -> thread::JoinHandle<Result<(), String>> {
    thread::spawn(move || {
        let result = (|| {
            listener
                .set_nonblocking(true)
                .map_err(|error| format!("本地 SSH 隧道监听器配置失败：{error}"))?;

            let tcp_stream = TcpStream::connect((ssh_config.host.as_str(), ssh_config.port))
                .map_err(|error| format!("无法连接 SSH 主机 {}:{}：{error}", ssh_config.host, ssh_config.port))?;

            let mut session = Session::new().map_err(|error| format!("无法创建 SSH 会话：{error}"))?;
            session.set_tcp_stream(tcp_stream);
            session.handshake().map_err(|error| format!("SSH 握手失败：{error}"))?;
            authenticate_ssh(&session, &ssh_config, ssh_secret.as_deref())?;

            let _ = status_tx.send(TunnelStatus::Ready);

            let client = loop {
                if stop_rx.try_recv().is_ok() {
                    return Ok(());
                }

                match listener.accept() {
                    Ok((client, _)) => break client,
                    Err(error) if error.kind() == ErrorKind::WouldBlock => {
                        thread::sleep(BRIDGE_IDLE_SLEEP);
                    }
                    Err(error) => return Err(format!("本地 SSH 隧道建立失败：{error}")),
                }
            };
            let mut channel = session
                .channel_direct_tcpip(&target_host, target_port, None)
                .map_err(|error| format!("SSH 无法连接目标 Elasticsearch {target_host}:{target_port}：{error}"))?;

            let bridge_result = bridge_connection(client, &session, &mut channel, &stop_rx);

            let _ = channel.close();
            let _ = channel.wait_close();

            bridge_result
        })();

        if let Err(error) = &result {
            let _ = status_tx.send(TunnelStatus::Error(error.clone()));
        }

        result
    })
}

fn wait_tunnel_ready(status_rx: &Receiver<TunnelStatus>) -> Result<(), String> {
    match status_rx.recv_timeout(SSH_READY_TIMEOUT) {
        Ok(TunnelStatus::Ready) => Ok(()),
        Ok(TunnelStatus::Error(error)) => Err(error),
        Err(_) => Err("建立 SSH 通道超时，请检查 SSH 主机地址、端口和认证信息。".into()),
    }
}

fn try_take_tunnel_error(status_rx: &Receiver<TunnelStatus>) -> Option<String> {
    match status_rx.recv_timeout(SSH_ERROR_GRACE_PERIOD) {
        Ok(TunnelStatus::Error(error)) => Some(error),
        Ok(TunnelStatus::Ready) | Err(_) => None,
    }
}

fn perform_ssh_http_request(payload: ExecuteSshHttpRequestPayload) -> Result<HttpResponsePayload, DiagnosticFailure> {
    let auth_label = match payload.ssh_tunnel.auth_method {
        SshAuthMethod::Password => "密码",
        SshAuthMethod::PrivateKey => "私钥",
    };
    let mut diagnostics = vec![format!(
        "准备通过 SSH 通道访问 {}，SSH 主机 {}@{}:{}，认证方式：{}",
        payload.url,
        payload.ssh_tunnel.username,
        payload.ssh_tunnel.host,
        payload.ssh_tunnel.port,
        auth_label
    )];

    let url = Url::parse(&payload.url).map_err(|error| {
        diagnostics.push("解析 Elasticsearch 地址失败。".into());
        diagnostics.push(error.to_string());
        DiagnosticFailure::new(format!("请求地址无效：{error}"), diagnostics.clone())
    })?;
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

    if !payload.body_text.is_empty() {
        channel.write_all(payload.body_text.as_bytes()).map_err(|error| {
            diagnostics.push(error.to_string());
            DiagnosticFailure::new(format!("无法向远程 curl 写入请求体：{error}"), diagnostics.clone())
        })?;
    }
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
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_prevent_default::Builder::new()
                .with_flags(Flags::CONTEXT_MENU)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            save_connection_password,
            get_connection_password,
            delete_connection_password,
            save_connection_secret,
            get_connection_secret,
            delete_connection_secret,
            execute_ssh_http_request,
            validate_ssh_tunnel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
