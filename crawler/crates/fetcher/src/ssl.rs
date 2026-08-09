use std::sync::Arc;
use std::time::Duration;

use crawl_core::types::SslInfo;

pub async fn check_ssl(host: &str, port: u16, timeout_ms: u64) -> Option<SslInfo> {
    let addr = format!("{}:{}", host, port);
    let timeout = Duration::from_millis(timeout_ms);

    let stream =
        match tokio::time::timeout(timeout, tokio::net::TcpStream::connect(&addr)).await {
            Ok(Ok(s)) => s,
            _ => return None,
        };

    let connector =
        tokio_rustls::TlsConnector::from(Arc::new(create_config()));
    let domain =
        tokio_rustls::rustls::pki_types::ServerName::try_from(host.to_string()).ok()?;

    let tls_stream = match tokio::time::timeout(timeout, connector.connect(domain, stream)).await {
        Ok(Ok(s)) => s,
        _ => return None,
    };

    let (_, conn) = tls_stream.get_ref();
    let certs = conn.peer_certificates()?;
    let cert = certs.first()?;

    let der = cert.as_ref();
    let (_, x509) = x509_parser::parse_x509_certificate(der).ok()?;
    let validity = x509.validity();

    let valid_from = validity.not_before.to_rfc2822().unwrap_or_default();
    let valid_until = validity.not_after.to_rfc2822().unwrap_or_default();
    let issuer = x509.issuer().to_string();
    let subject = x509.subject().to_string();

    let now_ts = web_time::SystemTime::now()
        .duration_since(web_time::SystemTime::UNIX_EPOCH)
        .ok()?
        .as_secs() as i64;

    let not_after_ts = validity.not_after.timestamp();
    let days_remaining = (not_after_ts - now_ts) / 86400;

    let cipher_suite = conn
        .negotiated_cipher_suite()
        .map(|cs| format!("{:?}", cs.suite()));

    let tls_version = conn.protocol_version().map(|v| format!("{:?}", v));

    let chain_depth = Some(certs.len());

    Some(SslInfo {
        valid_from,
        valid_until,
        issuer,
        subject,
        days_remaining,
        cipher_suite,
        chain_depth,
        tls_version,
    })
}

fn create_config() -> tokio_rustls::rustls::ClientConfig {
    let mut root_store = tokio_rustls::rustls::RootCertStore::empty();
    root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

    tokio_rustls::rustls::ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth()
}
