use regex::Regex;
use std::sync::LazyLock;

static SECRET_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        // Cloudflare Tunnel token
        Regex::new(r"(?i)CLOUDFLARE_TUNNEL_TOKEN\s*=\s*[a-zA-Z0-9_\-\.]+").unwrap(),
        // Internal service key
        Regex::new(r"(?i)INTERNAL_SERVICE_KEY\s*=\s*[^\s]+").unwrap(),
        Regex::new(r"(?i)X-Panorama-Service-Key:\s*[^\s\r\n]+").unwrap(),
        // PuTTY password argument
        Regex::new(r#"(?i)-pw\s+("[^"]*"|[^\s]+)"#).unwrap(),
        // JSON Web Tokens (RS256/HS256)
        Regex::new(r"eyJ[a-zA-Z0-9_\-]{10,}\.eyJ[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]+").unwrap(),
        // Bearer tokens in headers
        Regex::new(r"(?i)Bearer\s+([a-zA-Z0-9_\-\.]{20,})").unwrap(),
        // Generic private keys
        Regex::new(r"-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----").unwrap(),
    ]
});

pub fn scrub_secrets(input: &str) -> String {
    let mut scrubbed = input.to_string();
    for regex in SECRET_PATTERNS.iter() {
        scrubbed = regex.replace_all(&scrubbed, "[REDACTED]").to_string();
    }
    scrubbed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scrubs_jwt() {
        let fake_jwt = "header.eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.signature";
        let out = scrub_secrets(fake_jwt);
        assert!(!out.contains("eyJhbGciOiJSUzI1Ni"));
        assert!(out.contains("[REDACTED]"));
    }

    #[test]
    fn test_scrubs_service_key() {
        let raw = "Sending X-Panorama-Service-Key: super_secret_service_key_123 to backend";
        let out = scrub_secrets(raw);
        assert!(!out.contains("super_secret_service_key_123"));
        assert!(out.contains("[REDACTED]"));
    }

    #[test]
    fn test_scrubs_putty_pw() {
        let raw = r#"plink.exe -ssh root@host -pw "mypassword123" ls"#;
        let out = scrub_secrets(raw);
        assert!(!out.contains("mypassword123"));
        assert!(out.contains("[REDACTED]"));
    }
}
