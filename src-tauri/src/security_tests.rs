use super::*;
use ring::{
    rand::SystemRandom,
    signature::{EcdsaKeyPair, KeyPair, ECDSA_P256_SHA256_ASN1_SIGNING},
};
use rustls::{
    pki_types::{PrivateKeyDer, PrivatePkcs8KeyDer},
    server::{ClientHello, ResolvesServerCert},
    sign::CertifiedKey,
};
use std::io::Cursor;

#[test]
fn ai_key_stays_bound_to_its_saved_origin_after_config_failure_and_restart() {
    let mut vault = SecretsVault::default();
    set_ai_api_key_in_vault(
        &mut vault,
        "fixture-key-a".into(),
        "https://a.example.invalid/v1",
    )
    .unwrap();
    set_ai_api_key_in_vault(
        &mut vault,
        "fixture-key-b".into(),
        "https://b.example.invalid/v1",
    )
    .unwrap();
    let restarted: SecretsVault =
        serde_json::from_str(&serde_json::to_string(&vault).unwrap()).unwrap();
    assert_eq!(
        ai_api_key_for_url(&restarted, "https://a.example.invalid/v1").unwrap(),
        None
    );
    assert_eq!(
        ai_api_key_for_url(&restarted, "https://b.example.invalid:443/v2")
            .unwrap()
            .as_deref(),
        Some("fixture-key-b")
    );
}

#[test]
fn invalid_ai_origin_does_not_overwrite_existing_vault_key() {
    let mut vault = SecretsVault::default();
    set_ai_api_key_in_vault(
        &mut vault,
        "fixture-key-a".into(),
        "https://a.example.invalid",
    )
    .unwrap();
    assert!(set_ai_api_key_in_vault(
        &mut vault,
        "fixture-key-b".into(),
        "https://user:fixture@b.example.invalid"
    )
    .is_err());
    assert_eq!(
        ai_api_key_for_url(&vault, "https://a.example.invalid")
            .unwrap()
            .as_deref(),
        Some("fixture-key-a")
    );
}

#[test]
fn legacy_ai_key_is_bound_once_and_never_rebound_from_a_stale_config() {
    let mut vault = SecretsVault::default();
    vault
        .values
        .insert(ai_api_key_vault_key(), "fixture-legacy-key".into());
    assert_eq!(
        ai_api_key_for_url(&vault, "https://a.example.invalid").unwrap(),
        None
    );
    assert!(!bind_legacy_ai_api_key_origin(
        &mut vault,
        Some("https://user:fixture@a.example.invalid")
    ));
    assert!(bind_legacy_ai_api_key_origin(
        &mut vault,
        Some("https://a.example.invalid/v1")
    ));
    assert!(!bind_legacy_ai_api_key_origin(
        &mut vault,
        Some("https://b.example.invalid")
    ));
    assert_eq!(
        ai_api_key_for_url(&vault, "https://a.example.invalid")
            .unwrap()
            .as_deref(),
        Some("fixture-legacy-key")
    );
    assert_eq!(
        ai_api_key_for_url(&vault, "https://b.example.invalid").unwrap(),
        None
    );
}

fn ssh_config(policy: Option<SshHostKeyPolicy>, pin: Option<&str>) -> SshTunnelConfig {
    SshTunnelConfig {
        host: "jump.example.invalid".into(),
        port: 22,
        username: "fixture-user".into(),
        auth_method: SshAuthMethod::Password,
        private_key_path: String::new(),
        host_key_policy: policy,
        trusted_host_key_sha256: pin.map(str::to_string),
    }
}

#[test]
fn ssh_first_use_is_allowed_only_during_validation() {
    let config = ssh_config(None, None);
    assert_eq!(
        verify_ssh_host_key(&config, Some(&[0; 32]), true).unwrap(),
        "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    );
    assert!(verify_ssh_host_key(&config, Some(&[0; 32]), false).is_err());
    assert!(verify_ssh_host_key(&config, None, true).is_err());
}

#[test]
fn ssh_rejects_changed_keys_for_both_policies_and_entry_points() {
    for policy in [SshHostKeyPolicy::Strict, SshHostKeyPolicy::TrustOnFirstUse] {
        let config = ssh_config(
            Some(policy),
            Some("SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
        );
        for allow_first_use in [true, false] {
            assert!(verify_ssh_host_key(&config, Some(&[0; 32]), allow_first_use).is_ok());
            assert!(verify_ssh_host_key(&config, Some(&[1; 32]), allow_first_use).is_err());
        }
    }
}

#[test]
fn request_boundary_allows_only_same_origin_http_urls_without_credentials() {
    for request in [
        "https://es.example.invalid/_search",
        "https://es.example.invalid:443/_search",
    ] {
        assert!(validate_es_request_url("https://es.example.invalid", request).is_ok());
    }
    for request in [
        "http://es.example.invalid/",
        "https://es.example.invalid:444/",
        "https://other.example.invalid/",
        "file:///tmp/fixture",
        "https://user:fixture@es.example.invalid/",
        "https://@es.example.invalid/",
    ] {
        assert!(validate_es_request_url("https://es.example.invalid", request).is_err());
    }
    assert!(validate_es_request_url(
        "https://user:fixture@es.example.invalid",
        "https://es.example.invalid/"
    )
    .is_err());
}

#[test]
fn ai_rejects_url_credentials_before_request_or_diagnostics() {
    let result = perform_ai_http_request(ExecuteAiHttpRequestPayload {
        url: "https://fixture-user:fixture-password@ai.example.invalid/".into(),
        method: "GET".into(),
        api_key: Some("fixture-api-key".into()),
        body_text: None,
        content_type: None,
        accept: None,
    })
    .unwrap_err();
    assert!(result.message.contains("用户名或密码"));
    assert!(!format!("{result:?}").contains("fixture-password"));
}

// 每次测试生成临时密钥和自签名证书，只在内存中使用，不存储私钥 fixture。
fn der(tag: u8, content: &[u8]) -> Vec<u8> {
    let mut result = vec![tag];
    if content.len() < 128 {
        result.push(content.len() as u8);
    } else {
        let bytes = content.len().to_be_bytes();
        let length = &bytes[bytes.iter().position(|value| *value != 0).unwrap()..];
        result.push(0x80 | length.len() as u8);
        result.extend(length);
    }
    result.extend(content);
    result
}

fn ephemeral_certificate() -> (CertificateDer<'static>, PrivateKeyDer<'static>) {
    let random = SystemRandom::new();
    let pkcs8 = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_ASN1_SIGNING, &random).unwrap();
    let key =
        EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_ASN1_SIGNING, pkcs8.as_ref(), &random).unwrap();
    let signature_algorithm = der(
        0x30,
        &[0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02],
    );
    let name = der(
        0x30,
        &der(
            0x31,
            &der(
                0x30,
                &[vec![0x06, 0x03, 0x55, 0x04, 0x03], der(0x0c, b"localhost")].concat(),
            ),
        ),
    );
    let public_key_algorithm = der(
        0x30,
        &[
            0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48,
            0xce, 0x3d, 0x03, 0x01, 0x07,
        ],
    );
    let public_key = der(
        0x30,
        &[
            public_key_algorithm,
            der(
                0x03,
                &[vec![0], key.public_key().as_ref().to_vec()].concat(),
            ),
        ]
        .concat(),
    );
    let tbs = der(
        0x30,
        &[
            vec![0xa0, 0x03, 0x02, 0x01, 0x02, 0x02, 0x01, 0x01],
            signature_algorithm.clone(),
            name.clone(),
            der(
                0x30,
                &[der(0x17, b"200101000000Z"), der(0x17, b"491231235959Z")].concat(),
            ),
            name,
            public_key,
        ]
        .concat(),
    );
    let signature = key.sign(&random, &tbs).unwrap();
    let certificate = der(
        0x30,
        &[
            tbs,
            signature_algorithm,
            der(0x03, &[vec![0], signature.as_ref().to_vec()].concat()),
        ]
        .concat(),
    );
    (
        CertificateDer::from(certificate),
        PrivatePkcs8KeyDer::from(pkcs8.as_ref().to_vec()).into(),
    )
}

#[derive(Debug)]
struct TestCertificate(Arc<CertifiedKey>);

impl ResolvesServerCert for TestCertificate {
    fn resolve(&self, _: ClientHello<'_>) -> Option<Arc<CertifiedKey>> {
        Some(self.0.clone())
    }
}

fn exchange_pinned_tls(
    expected: &str,
    certificate: CertificateDer<'static>,
    key: PrivateKeyDer<'static>,
    version: &'static rustls::SupportedProtocolVersion,
) -> Result<Vec<u8>, rustls::Error> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let signing_key = provider.key_provider.load_private_key(key).unwrap();
    let server_config = rustls::ServerConfig::builder_with_provider(provider)
        .with_protocol_versions(&[version])
        .unwrap()
        .with_no_client_auth()
        .with_cert_resolver(Arc::new(TestCertificate(Arc::new(CertifiedKey::new(
            vec![certificate],
            signing_key,
        )))));
    let mut server = rustls::ServerConnection::new(Arc::new(server_config)).unwrap();
    let mut client = rustls::ClientConnection::new(
        Arc::new(build_fingerprint_tls_config(expected).unwrap()),
        ServerName::try_from("localhost").unwrap(),
    )
    .unwrap();
    client
        .writer()
        .write_all(b"Authorization: fixture-credential")
        .unwrap();
    for _ in 0..12 {
        let mut client_bytes = Vec::new();
        client.write_tls(&mut client_bytes).unwrap();
        server.read_tls(&mut Cursor::new(client_bytes)).unwrap();
        server.process_new_packets()?;
        let mut server_bytes = Vec::new();
        server.write_tls(&mut server_bytes).unwrap();
        client.read_tls(&mut Cursor::new(server_bytes)).unwrap();
        client.process_new_packets()?;
        let mut received = vec![0; 128];
        if let Ok(size) = server.reader().read(&mut received) {
            if size > 0 {
                received.truncate(size);
                return Ok(received);
            }
        }
    }
    panic!("TLS fixture handshake did not complete");
}

#[test]
fn pinned_tls_sends_credentials_only_to_matching_certificate() {
    for version in [&rustls::version::TLS12, &rustls::version::TLS13] {
        let (certificate, key) = ephemeral_certificate();
        let expected = format!(
            "SHA256:{}",
            base64_encode(&Sha256::digest(certificate.as_ref()))
        );
        assert_eq!(
            exchange_pinned_tls(&expected, certificate.clone(), key.clone_key(), version).unwrap(),
            b"Authorization: fixture-credential"
        );
        assert!(exchange_pinned_tls(
            "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            certificate,
            key,
            version
        )
        .is_err());
    }
}

#[test]
fn pinned_tls_still_rejects_forged_handshake_signatures() {
    for version in [&rustls::version::TLS12, &rustls::version::TLS13] {
        let (certificate, _) = ephemeral_certificate();
        let (_, wrong_key) = ephemeral_certificate();
        let expected = format!(
            "SHA256:{}",
            base64_encode(&Sha256::digest(certificate.as_ref()))
        );
        assert!(exchange_pinned_tls(&expected, certificate, wrong_key, version).is_err());
    }
}

fn request_local_tls_fixture(
    matching_pin: bool,
    redirect: bool,
) -> (Result<reqwest::blocking::Response, reqwest::Error>, Vec<u8>) {
    let (certificate, key) = ephemeral_certificate();
    let expected = if matching_pin {
        format!(
            "SHA256:{}",
            base64_encode(&Sha256::digest(certificate.as_ref()))
        )
    } else {
        "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=".into()
    };
    let tls = ConnectionTlsConfig {
        mode: Some(ConnectionTlsMode::CertificateFingerprint),
        ca_path: None,
        fingerprint: Some(expected),
    };
    let client = es_http_client_builder(Some(&tls), false)
        .unwrap()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server_config = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(vec![certificate], key)
    .unwrap();
    let server = std::thread::spawn(move || {
        let (socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        socket
            .set_write_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut stream = rustls::StreamOwned::new(
            rustls::ServerConnection::new(Arc::new(server_config)).unwrap(),
            socket,
        );
        let mut received = Vec::new();
        let mut buffer = [0; 2048];
        while !received.windows(4).any(|part| part == b"\r\n\r\n") {
            match stream.read(&mut buffer) {
                Ok(0) | Err(_) => return received,
                Ok(size) => received.extend_from_slice(&buffer[..size]),
            }
        }
        let response = if redirect {
            format!("HTTP/1.1 307 Temporary Redirect\r\nLocation: https://{address}/redirected\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        } else {
            "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into()
        };
        stream.write_all(response.as_bytes()).unwrap();
        stream.flush().unwrap();
        received
    });
    let response = client
        .get(format!("https://{address}/"))
        .header("Authorization", "Bearer fixture-credential")
        .send();
    (response, server.join().unwrap())
}

#[test]
fn reqwest_enforces_leaf_pin_before_sending_http_authorization() {
    let (response, received) = request_local_tls_fixture(true, false);
    assert_eq!(response.unwrap().status(), StatusCode::OK);
    assert!(String::from_utf8(received)
        .unwrap()
        .contains("Bearer fixture-credential"));
    let (response, received) = request_local_tls_fixture(false, false);
    assert!(response.is_err());
    assert!(
        received.is_empty(),
        "wrong certificate received application data"
    );
}

#[test]
fn es_http_client_does_not_follow_redirects() {
    let (response, _) = request_local_tls_fixture(true, true);
    assert_eq!(response.unwrap().status(), StatusCode::TEMPORARY_REDIRECT);
}
