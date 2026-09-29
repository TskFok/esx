//! 手动本地基准：cargo test --lib transport_bench -- --ignored --nocapture。
use crate::{
    http_client_pool::HttpClientPool,
    http_response_reader::{read_response, ReadMode},
    HttpResponsePayload,
};
use std::{
    io::{BufRead, BufReader, Write},
    net::TcpListener,
    time::{Duration, Instant},
};

fn read_request(stream: &mut BufReader<std::net::TcpStream>) -> bool {
    loop {
        let mut line = String::new();
        if stream.read_line(&mut line).unwrap() == 0 {
            return false;
        }
        if line == "\r\n" {
            return true;
        }
    }
}

#[test]
#[ignore = "手动性能基准，不属于默认测试"]
fn sequential_clients() {
    for reuse in [false, true] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let mut requests = 0;
            let mut accepts = 0;
            while requests < 20 {
                let (socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                accepts += 1;
                let mut stream = BufReader::new(socket);
                while requests < 20 && read_request(&mut stream) {
                    stream
                        .get_mut()
                        .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}")
                        .unwrap();
                    requests += 1;
                }
            }
            accepts
        });
        let pool = HttpClientPool::default();
        let mut times = Vec::new();
        for _ in 0..20 {
            let started = Instant::now();
            let client = if reuse {
                pool.es_client(None, false).unwrap()
            } else {
                crate::es_http_client_builder(None, false)
                    .unwrap()
                    .no_proxy()
                    .build()
                    .unwrap()
            };
            assert_eq!(client.get(&url).send().unwrap().text().unwrap(), "{}");
            drop(client);
            times.push(started.elapsed().as_micros());
        }
        times.sort_unstable();
        let accepts = server.join().unwrap();
        let builds = if reuse {
            pool.benchmark_build_count()
        } else {
            20
        };
        assert_eq!(accepts, if reuse { 1 } else { 20 });
        assert_eq!(builds, if reuse { 1 } else { 20 });
        eprintln!(
            "BENCH {}",
            serde_json::json!({"case":if reuse {"pool"} else {"build_each"},"requests":20,"accepts":accepts,"builds":builds,"p50_us":times[9],"p95_us":times[18]})
        );
    }
}

#[test]
#[ignore = "手动性能基准，BENCH_MIB=1|10|100 BENCH_MODE=full|preview"]
fn response_memory() {
    let mib: usize = std::env::var("BENCH_MIB")
        .unwrap_or("1".into())
        .parse()
        .unwrap();
    assert!([1, 10, 100].contains(&mib));
    let mode = std::env::var("BENCH_MODE").unwrap_or("preview".into());
    assert!(mode == "preview" || mode == "full");
    let length = mib * 1024 * 1024;
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let (socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut stream = BufReader::new(socket);
        assert!(read_request(&mut stream));
        write!(
            stream.get_mut(),
            "HTTP/1.1 200 OK\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n"
        )
        .unwrap();
        let chunk = [b'x'; 64 * 1024];
        for _ in 0..length / chunk.len() {
            stream.get_mut().write_all(&chunk).unwrap();
        }
    });
    let pool = HttpClientPool::default();
    let client = pool.es_client(None, false).unwrap();
    let response = client
        .get(url)
        .timeout(Duration::from_secs(60))
        .send()
        .unwrap();
    let started = Instant::now();
    let result = read_response(
        response,
        if mode == "full" {
            ReadMode::Full
        } else {
            ReadMode::Preview {
                max_bytes: 256 * 1024,
            }
        },
    )
    .unwrap();
    let read_us = started.elapsed().as_micros();
    assert_eq!(result.total_bytes, length as u64);
    assert_eq!(
        result.body_text.len(),
        if mode == "full" { length } else { 256 * 1024 }
    );
    let retained = result.body_text.len();
    let payload = HttpResponsePayload {
        ok: true,
        status: 200,
        status_text: "OK".into(),
        body_text: result.body_text,
        error_message: None,
        diagnostics: Vec::new(),
        total_bytes: result.total_bytes,
        truncated: result.truncated,
    };
    let started = Instant::now();
    let serialized = serde_json::to_vec(&payload).unwrap();
    eprintln!(
        "BENCH {}",
        serde_json::json!({"case":"response","mib":mib,"mode":mode,"total_bytes":length,"retained_bytes":retained,"serialized_payload_bytes":serialized.len(),"read_us":read_us,"serialize_us":started.elapsed().as_micros()})
    );
    std::hint::black_box(&serialized);
    server.join().unwrap();
}

#[test]
#[ignore = "手动 RSS harness 基线"]
fn harness_baseline() {
    eprintln!("BENCH harness_baseline");
}
