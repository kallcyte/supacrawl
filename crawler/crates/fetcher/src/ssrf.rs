use std::net::IpAddr;
use std::str::FromStr;
use url::Url;

const BLOCKED_IP_RANGES: &[&str] = &[
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "0.0.0.0/8",
    "::1/128",
    "fc00::/7",
    "fe80::/10",
];

const BLOCKED_HOSTS: &[&str] = &[
    "metadata.google.internal",
    "169.254.169.254",
    "metadata.tencentyun.com",
    "100.100.100.200",
];

pub fn is_ssrf_safe(url: &Url) -> bool {
    let host = url.host_str().unwrap_or("");
    let host_lower = host.to_lowercase();

    for blocked in BLOCKED_HOSTS {
        if host_lower == *blocked || host_lower.ends_with(&format!(".{}", blocked)) {
            return false;
        }
    }

    if let Ok(ip) = IpAddr::from_str(host) {
        for range_str in BLOCKED_IP_RANGES {
            let range: ipnet::IpNet = match range_str.parse() {
                Ok(r) => r,
                Err(_) => continue,
            };
            if range.contains(&ip) {
                return false;
            }
        }
    }

    true
}
