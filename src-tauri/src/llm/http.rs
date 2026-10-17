use super::auth::Credential;
use super::connection::{AuthHeader, Connection};
use super::error::LlmError;
use reqwest::{Certificate, Client, RequestBuilder};
use std::time::Duration;

/// Per-connection client: rustls, request timeout, optional extra root CA (PEM).
pub fn build_client(conn: &Connection, timeout: Duration) -> Result<Client, LlmError> {
    let mut builder = Client::builder().use_rustls_tls().timeout(timeout);
    if let Some(path) = &conn.ca_cert_path {
        let pem = std::fs::read(path)
            .map_err(|e| LlmError::BadResponse(format!("cannot read CA file {path}: {e}")))?;
        let cert = Certificate::from_pem(&pem)
            .map_err(|e| LlmError::BadResponse(format!("invalid CA certificate: {e}")))?;
        builder = builder.add_root_certificate(cert);
    }
    builder.build().map_err(|e| LlmError::BadResponse(e.to_string()))
}

/// Adds the credential header chosen by `conn.auth_header`, then `extra_headers`.
pub fn apply_auth(mut req: RequestBuilder, conn: &Connection, cred: &Credential) -> RequestBuilder {
    if let Credential::Secret(secret) = cred {
        req = match conn.auth_header {
            AuthHeader::Bearer => req.header("Authorization", format!("Bearer {secret}")),
            AuthHeader::ApiKey => req.header("api-key", secret.as_str()),
            AuthHeader::XApiKey => req.header("x-api-key", secret.as_str()),
        };
    }
    for (name, value) in &conn.extra_headers {
        req = req.header(name.as_str(), value.as_str());
    }
    req
}

fn error_chain(e: &dyn std::error::Error) -> String {
    let mut parts = vec![e.to_string()];
    let mut cur = e.source();
    while let Some(s) = cur {
        parts.push(s.to_string());
        cur = s.source();
    }
    parts.join(" | ")
}

/// Transport-level failure -> typed error.
pub fn classify_send_error(e: &reqwest::Error) -> LlmError {
    if e.is_timeout() {
        return LlmError::Timeout;
    }
    let chain = error_chain(e).to_lowercase();
    if chain.contains("certificate") || chain.contains("unknownissuer") || chain.contains("invalid peer") {
        return LlmError::TlsUntrusted;
    }
    if e.is_decode() || e.is_body() {
        return LlmError::BadResponse(e.to_string());
    }
    LlmError::Unreachable
}

/// Non-2xx HTTP status -> typed error.
pub fn classify_status(status: u16, body: &str) -> LlmError {
    match status {
        401 | 403 => LlmError::Unauthorized,
        404 => LlmError::ModelNotFound,
        408 | 504 => LlmError::Timeout,
        _ => {
            let snippet: String = body.chars().take(300).collect();
            LlmError::BadResponse(format!("status {status}: {snippet}"))
        }
    }
}
