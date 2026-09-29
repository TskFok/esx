use crate::{map_reqwest_error, validate_http_url, ExecuteAiHttpRequestPayload};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{Arc, LazyLock, Mutex},
    time::Duration,
};
use tokio::sync::{watch, Notify};

const CHUNK_BYTES: usize = 8 * 1024;
const WINDOW: usize = 8;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiStreamEvent {
    request_id: String,
    sequence: u64,
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
}
struct StreamState {
    cancelled: watch::Sender<bool>,
    pending: Mutex<HashSet<u64>>,
    available: Notify,
}
static STREAMS: LazyLock<Mutex<HashMap<String, Arc<StreamState>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
// A bounded set covers a cancel command arriving before its execute command is polled.
static EARLY_CANCELS: LazyLock<Mutex<VecDeque<String>>> =
    LazyLock::new(|| Mutex::new(VecDeque::new()));
fn registry() -> &'static Mutex<HashMap<String, Arc<StreamState>>> {
    &STREAMS
}
static CLIENT: LazyLock<Result<reqwest::Client, String>> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("无法创建 AI HTTP 客户端：{e}"))
});
struct Registration(String);
impl Drop for Registration {
    fn drop(&mut self) {
        if let Ok(mut streams) = registry().lock() {
            streams.remove(&self.0);
        }
    }
}
pub(crate) fn cancel(id: &str) -> Result<(), String> {
    let streams = registry().lock().map_err(|_| "AI 流注册表不可用")?;
    if let Some(state) = streams.get(id) {
        state.cancelled.send_replace(true);
    } else {
        let mut early = EARLY_CANCELS.lock().map_err(|_| "AI 取消队列不可用")?;
        if !early.iter().any(|value| value == id) {
            if early.len() == 256 {
                early.pop_front();
            }
            early.push_back(id.to_owned());
        }
    }
    Ok(())
}
pub(crate) fn ack(id: &str, sequence: u64) -> Result<(), String> {
    let streams = registry().lock().map_err(|_| "AI 流注册表不可用")?;
    if let Some(state) = streams.get(id) {
        if state
            .pending
            .lock()
            .map_err(|_| "AI 流窗口不可用")?
            .remove(&sequence)
        {
            state.available.notify_one();
        }
    }
    Ok(())
}
async fn cancelled(rx: &mut watch::Receiver<bool>) {
    if *rx.borrow() {
        return;
    }
    let _ = rx.changed().await;
}
async fn permit(state: &StreamState, rx: &mut watch::Receiver<bool>) -> Result<(), String> {
    loop {
        if *rx.borrow() {
            return Err("AI 请求已取消".into());
        }
        if state.pending.lock().map_err(|_| "AI 流窗口不可用")?.len() < WINDOW {
            return Ok(());
        }
        tokio::select! { biased;
            _ = cancelled(rx) => return Err("AI 请求已取消".into()),
            _ = state.available.notified() => {}
        }
    }
}

pub(crate) async fn run<F>(
    payload: ExecuteAiHttpRequestPayload,
    id: String,
    send: F,
) -> Result<(), String>
where
    F: FnMut(AiStreamEvent) -> Result<(), String> + Send,
{
    run_with_budget(payload, id, send, Duration::from_secs(120)).await
}

async fn run_with_budget<F>(
    payload: ExecuteAiHttpRequestPayload,
    id: String,
    mut send: F,
    budget: Duration,
) -> Result<(), String>
where
    F: FnMut(AiStreamEvent) -> Result<(), String> + Send,
{
    let (cancel_tx, mut cancel_rx) = watch::channel(false);
    let state = Arc::new(StreamState {
        cancelled: cancel_tx,
        pending: Mutex::new(HashSet::new()),
        available: Notify::new(),
    });
    {
        let mut streams = registry().lock().map_err(|_| "AI 流注册表不可用")?;
        if streams.contains_key(&id) {
            return Err("AI 请求 ID 已存在".into());
        }
        let mut early = EARLY_CANCELS.lock().map_err(|_| "AI 取消队列不可用")?;
        if let Some(index) = early.iter().position(|value| value == &id) {
            early.remove(index);
            state.cancelled.send_replace(true);
        }
        streams.insert(id.clone(), state.clone());
    }
    let _registration = Registration(id.clone());
    let mut sequence = 0;
    let channel_failed = std::sync::atomic::AtomicBool::new(false);
    let mut emit = |kind, status, status_text, text| {
        sequence += 1;
        if kind == "chunk" {
            state
                .pending
                .lock()
                .map_err(|_| "AI 流窗口不可用")?
                .insert(sequence);
        }
        let result = send(AiStreamEvent {
            request_id: id.clone(),
            sequence,
            kind,
            status,
            status_text,
            text,
        });
        if result.is_err() {
            channel_failed.store(true, std::sync::atomic::Ordering::Relaxed);
        }
        result
    };
    let result: Result<(), String> = tokio::time::timeout(budget, async {
        let url = validate_http_url(&payload.url)?;
        let method = reqwest::Method::from_bytes(payload.method.as_bytes())
            .map_err(|e| format!("AI HTTP 方法无效：{e}"))?;
        let client = CLIENT.as_ref().map_err(Clone::clone)?;
        let mut request = client.request(method, url).header(
            "Accept",
            payload.accept.as_deref().unwrap_or("application/json"),
        );
        if let Some(key) = payload
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|key| !key.is_empty())
        {
            request = request.header("Authorization", format!("Bearer {key}"));
        }
        if let Some(body) = payload.body_text.filter(|body| !body.is_empty()) {
            request = request
                .header(
                    "Content-Type",
                    payload
                        .content_type
                        .as_deref()
                        .unwrap_or("application/json"),
                )
                .body(body);
        }
        let mut response = tokio::select! { biased;
            _ = cancelled(&mut cancel_rx) => return Err("AI 请求已取消".into()),
            response = request.send() => response.map_err(map_reqwest_error)?
        };
        let status = response.status();
        emit(
            "headers",
            Some(status.as_u16()),
            Some(
                status
                    .canonical_reason()
                    .unwrap_or(status.as_str())
                    .to_owned(),
            ),
            None,
        )?;
        let mut undecoded = Vec::new();
        loop {
            permit(&state, &mut cancel_rx).await?;
            let bytes = tokio::select! { biased;
                _ = cancelled(&mut cancel_rx) => return Err("AI 请求已取消".into()),
                bytes = response.chunk() => bytes.map_err(map_reqwest_error)?
            };
            let eof = bytes.is_none();
            if let Some(bytes) = bytes {
                undecoded.extend_from_slice(&bytes);
            }
            let valid = match std::str::from_utf8(&undecoded) {
                Ok(text) => text.len(),
                Err(error) if error.error_len().is_none() && !eof => error.valid_up_to(),
                Err(_) => return Err("AI 服务响应不是有效的 UTF-8 文本".into()),
            };
            let mut offset = 0;
            while offset < valid {
                permit(&state, &mut cancel_rx).await?;
                let text = std::str::from_utf8(&undecoded[offset..valid]).expect("validated UTF-8");
                let mut end = text.len().min(CHUNK_BYTES);
                while !text.is_char_boundary(end) {
                    end -= 1;
                }
                emit("chunk", None, None, Some(text[..end].to_owned()))?;
                offset += end;
            }
            undecoded.drain(..valid);
            if eof {
                return Ok(());
            }
        }
    })
    .await
    .unwrap_or_else(|_| Err("AI 流式请求超时。".into()));
    if channel_failed.load(std::sync::atomic::Ordering::Relaxed) {
        return result;
    }
    match result {
        Ok(()) => emit("done", None, None, None),
        Err(error) => emit("error", None, None, Some(error)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        time::{Duration, Instant},
    };

    fn server(
        parts: Vec<Vec<u8>>,
        status: &str,
        delay: Duration,
    ) -> (String, std::thread::JoinHandle<bool>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let status = status.to_owned();
        let handle = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = [0; 4096];
            socket.read(&mut request).unwrap();
            write!(socket, "HTTP/1.1 {status}\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n").unwrap();
            for part in parts {
                if write!(socket, "{:x}\r\n", part.len())
                    .and_then(|_| socket.write_all(&part))
                    .and_then(|_| socket.write_all(b"\r\n"))
                    .is_err()
                {
                    return true;
                }
                std::thread::sleep(delay);
            }
            if socket.write_all(b"0\r\n\r\n").is_err() {
                return true;
            }
            matches!(socket.read(&mut request), Ok(0) | Err(_))
        });
        (url, handle)
    }
    fn payload(url: String) -> crate::ExecuteAiHttpRequestPayload {
        crate::ExecuteAiHttpRequestPayload {
            url,
            method: "GET".into(),
            api_key: None,
            body_text: None,
            content_type: None,
            accept: Some("text/event-stream".into()),
        }
    }
    #[tokio::test]
    async fn ai_stream_incremental_utf8_and_http_error() {
        let original = "data: 中文🙂\n\ndata: end\n\n";
        let parts = original.as_bytes().chunks(3).map(|p| p.to_vec()).collect();
        let (url, server) = self::server(parts, "429 Too Many Requests", Duration::from_millis(30));
        let started = Instant::now();
        let mut first = None;
        let mut events = Vec::new();
        run(payload(url), "utf8-test".into(), |event| {
            if event.kind == "chunk" {
                first.get_or_insert(started.elapsed());
                ack("utf8-test", event.sequence)?;
            }
            events.push(event);
            Ok(())
        })
        .await
        .unwrap();
        eprintln!("first chunk from request start: {:?}", first.unwrap());
        assert!(first.unwrap() < Duration::from_millis(200));
        assert_eq!(events[0].kind, "headers");
        assert_eq!(events[0].status, Some(429));
        assert!(events.windows(2).all(|p| p[0].sequence < p[1].sequence));
        assert_eq!(
            events
                .iter()
                .filter(|e| e.kind == "chunk")
                .map(|e| e.text.as_deref().unwrap())
                .collect::<String>(),
            original
        );
        assert_eq!(
            events
                .iter()
                .filter(|e| e.kind == "done" || e.kind == "error")
                .count(),
            1
        );
        assert!(server.join().unwrap());
    }
    #[tokio::test]
    async fn ai_stream_window_and_cancel() {
        let (url, server) = self::server(
            vec![vec![b'x'; 8192]; 40],
            "200 OK",
            Duration::from_millis(10),
        );
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let task = tokio::spawn(run(payload(url), "window-test".into(), move |e| {
            tx.send(e).map_err(|_| "closed".into())
        }));
        assert_eq!(rx.recv().await.unwrap().kind, "headers");
        let mut sequences = Vec::new();
        for _ in 0..8 {
            let e = rx.recv().await.unwrap();
            assert_eq!(e.kind, "chunk");
            assert!(e.text.unwrap().len() <= 8192);
            sequences.push(e.sequence);
        }
        assert!(tokio::time::timeout(Duration::from_millis(100), rx.recv())
            .await
            .is_err());
        ack("window-test", sequences[0]).unwrap();
        assert_eq!(rx.recv().await.unwrap().kind, "chunk");
        ack("window-test", sequences[0]).unwrap();
        assert!(tokio::time::timeout(Duration::from_millis(50), rx.recv())
            .await
            .is_err());
        cancel("unknown").unwrap();
        let cancelled = Instant::now();
        cancel("window-test").unwrap();
        assert_eq!(rx.recv().await.unwrap().kind, "error");
        task.await.unwrap().unwrap();
        assert!(server.join().unwrap());
        assert!(cancelled.elapsed() < Duration::from_secs(1));
        assert!(!registry().lock().unwrap().contains_key("window-test"));
    }
    #[tokio::test]
    async fn ai_stream_large_unicode_and_channel_failure_cleanup() {
        let original = "中🙂".repeat(5000);
        let (url, server) =
            self::server(vec![original.as_bytes().to_vec()], "200 OK", Duration::ZERO);
        let mut text = String::new();
        run(payload(url), "large-test".into(), |event| {
            if event.kind == "chunk" {
                let chunk = event.text.unwrap();
                assert!(chunk.len() <= CHUNK_BYTES);
                text.push_str(&chunk);
                ack("large-test", event.sequence)?;
            }
            Ok(())
        })
        .await
        .unwrap();
        assert_eq!(text, original);
        assert!(server.join().unwrap());
        let (url, server) = self::server(
            vec![vec![b'x'; 100]; 30],
            "200 OK",
            Duration::from_millis(10),
        );
        let mut count = 0;
        assert!(run(payload(url), "closed-channel".into(), |_| {
            count += 1;
            Err("channel closed".into())
        })
        .await
        .is_err());
        assert_eq!(count, 1);
        assert!(!registry().lock().unwrap().contains_key("closed-channel"));
        assert!(server.join().unwrap());
    }

    #[tokio::test]
    async fn ai_stream_cancel_during_headers_and_body_wait() {
        for headers in [false, true] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}", listener.local_addr().unwrap());
            let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut buf = [0; 4096];
                socket.read(&mut buf).unwrap();
                if headers {
                    socket
                        .write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n")
                        .unwrap();
                }
                ready_tx.send(()).unwrap();
                matches!(socket.read(&mut buf), Ok(0))
            });
            let id = format!("cancel-phase-{headers}");
            let task_id = id.clone();
            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
            let task = tokio::spawn(run(payload(url), task_id, move |event| {
                tx.send(event).map_err(|_| "closed".into())
            }));
            ready_rx.await.unwrap();
            if headers {
                assert_eq!(rx.recv().await.unwrap().kind, "headers");
            }
            let started = Instant::now();
            cancel(&id).unwrap();
            assert_eq!(rx.recv().await.unwrap().kind, "error");
            task.await.unwrap().unwrap();
            assert!(server.join().unwrap());
            assert!(started.elapsed() < Duration::from_secs(1));
            assert!(!registry().lock().unwrap().contains_key(&id));
            eprintln!("cancel phase headers={headers}: {:?}", started.elapsed());
        }
    }

    #[tokio::test]
    async fn ai_stream_total_deadline_includes_ack_wait() {
        let (url, server) = self::server(
            vec![vec![b'x'; 8192]; 40],
            "200 OK",
            Duration::from_millis(2),
        );
        let mut chunks = 0;
        let mut terminal = Vec::new();
        let started = Instant::now();
        run_with_budget(
            payload(url),
            "deadline-test".into(),
            |event| {
                if event.kind == "chunk" {
                    chunks += 1;
                }
                if event.kind == "error" || event.kind == "done" {
                    terminal.push(event);
                }
                Ok(())
            },
            Duration::from_millis(200),
        )
        .await
        .unwrap();
        assert_eq!(chunks, WINDOW);
        assert_eq!(terminal.len(), 1);
        assert_eq!(terminal[0].kind, "error");
        assert!(terminal[0].text.as_ref().unwrap().contains("超时"));
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(!registry().lock().unwrap().contains_key("deadline-test"));
        assert!(server.join().unwrap());
    }

    #[tokio::test]
    async fn ai_stream_early_cancel_and_late_ack_are_idempotent() {
        cancel("early-test").unwrap();
        let mut events = Vec::new();
        run(
            payload("http://127.0.0.1:1".into()),
            "early-test".into(),
            |event| {
                events.push(event);
                Ok(())
            },
        )
        .await
        .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, "error");
        assert_eq!(events[0].text.as_deref(), Some("AI 请求已取消"));
        ack("early-test", 1).unwrap();
        ack("early-test", 1).unwrap();
    }
}
