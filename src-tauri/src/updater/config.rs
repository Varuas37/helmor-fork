use std::time::Duration;

use anyhow::Context;
use url::Url;

use crate::settings;

const UPDATER_ENDPOINTS_ENV: Option<&str> = option_env!("HELMOR_UPDATER_ENDPOINTS");
const UPDATER_PUBKEY_ENV: Option<&str> = option_env!("HELMOR_UPDATER_PUBKEY");

pub const DEFAULT_RELEASE_REPOSITORY: &str = "Varuas37/helmor-fork";
pub const DEFAULT_UPDATER_ENDPOINT: &str =
    "https://github.com/Varuas37/helmor-fork/releases/latest/download/latest.json";
pub const DEFAULT_UPDATER_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDFEMDcyNURCMEQzM0U2REUKUldUZTVqTU4yeVVISGZVd0sxc3EycTBtQVRZZGp0WU9IL2lGMjQyVnNQM1luSXJJcnVnWGJQQ2EK";

const AUTO_UPDATE_ENABLED_KEY: &str = "app.auto_update_enabled";
const AUTO_UPDATE_ON_LAUNCH_KEY: &str = "app.auto_update_check_on_launch";
const AUTO_UPDATE_ON_FOCUS_KEY: &str = "app.auto_update_check_on_focus";

const DEFAULT_AUTO_UPDATE_ENABLED: bool = true;
const DEFAULT_AUTO_UPDATE_ON_LAUNCH: bool = true;
const DEFAULT_AUTO_UPDATE_ON_FOCUS: bool = true;
const DEFAULT_AUTO_UPDATE_INTERVAL_MINUTES: u64 = 30;
const DEFAULT_FOCUS_TTL_MINUTES: u64 = 10;

// Exponential backoff after consecutive failures: 1, 2, 4, 8, 16, 32, 60 (capped).
const FAILURE_BACKOFF_BASE_MINUTES: u64 = 1;
const FAILURE_BACKOFF_MAX_MINUTES: u64 = 60;
const FAILURE_BACKOFF_MAX_SHIFT: u32 = 6;

#[derive(Clone, Debug)]
pub struct UpdaterConfig {
    pub endpoints: Vec<Url>,
    pub pubkey: Option<String>,
    pub release_repository: String,
}

impl UpdaterConfig {
    pub fn load() -> anyhow::Result<Self> {
        let endpoint_source =
            normalize_opt(UPDATER_ENDPOINTS_ENV).unwrap_or_else(|| DEFAULT_UPDATER_ENDPOINT.into());
        let endpoints = parse_endpoints(&endpoint_source)?;
        let pubkey =
            normalize_opt(UPDATER_PUBKEY_ENV).or_else(|| Some(DEFAULT_UPDATER_PUBKEY.to_string()));
        let release_repository = endpoints
            .iter()
            .find_map(github_release_repository)
            .unwrap_or(DEFAULT_RELEASE_REPOSITORY)
            .to_string();

        Ok(Self {
            endpoints,
            pubkey,
            release_repository,
        })
    }

    pub fn is_configured(&self) -> bool {
        !self.endpoints.is_empty() && self.pubkey.is_some()
    }
}

#[derive(Clone, Debug)]
pub struct UpdateBehavior {
    pub auto_update_enabled: bool,
    pub check_on_launch: bool,
    pub check_on_focus: bool,
    pub interval: Duration,
    pub focus_ttl: Duration,
}

impl UpdateBehavior {
    pub fn load() -> Self {
        let auto_update_enabled =
            load_bool_setting(AUTO_UPDATE_ENABLED_KEY, DEFAULT_AUTO_UPDATE_ENABLED);
        let check_on_launch =
            load_bool_setting(AUTO_UPDATE_ON_LAUNCH_KEY, DEFAULT_AUTO_UPDATE_ON_LAUNCH);
        let check_on_focus =
            load_bool_setting(AUTO_UPDATE_ON_FOCUS_KEY, DEFAULT_AUTO_UPDATE_ON_FOCUS);

        Self {
            auto_update_enabled,
            check_on_launch,
            check_on_focus,
            interval: Duration::from_secs(DEFAULT_AUTO_UPDATE_INTERVAL_MINUTES * 60),
            focus_ttl: Duration::from_secs(DEFAULT_FOCUS_TTL_MINUTES * 60),
        }
    }
}

/// Compute exponential backoff after `n` consecutive failures.
/// 1 → 1m, 2 → 2m, 3 → 4m, 4 → 8m, 5 → 16m, 6 → 32m, 7+ → 60m (capped).
pub fn failure_backoff(consecutive_failures: u32) -> Duration {
    if consecutive_failures == 0 {
        return Duration::ZERO;
    }
    let shift = (consecutive_failures - 1).min(FAILURE_BACKOFF_MAX_SHIFT);
    let minutes = FAILURE_BACKOFF_BASE_MINUTES
        .saturating_mul(1u64 << shift)
        .min(FAILURE_BACKOFF_MAX_MINUTES);
    Duration::from_secs(minutes * 60)
}

fn parse_endpoints(raw: &str) -> anyhow::Result<Vec<Url>> {
    raw.split([',', '\n'])
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            Url::parse(value).with_context(|| format!("Invalid updater endpoint URL: {value}"))
        })
        .collect()
}

fn github_release_repository(url: &Url) -> Option<&str> {
    if url.host_str() != Some("github.com") {
        return None;
    }

    let mut segments = url.path_segments()?;
    let owner = segments.next()?;
    let repo = segments.next()?;
    let marker = segments.next()?;
    if owner.is_empty() || repo.is_empty() || marker != "releases" {
        return None;
    }

    url.path()
        .strip_prefix('/')
        .and_then(|path| path.split_once("/releases/"))
        .map(|(repo_path, _)| repo_path)
}

fn normalize_opt(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn load_bool_setting(key: &str, default: bool) -> bool {
    settings::load_setting_value(key)
        .ok()
        .flatten()
        .and_then(|value| match value.trim() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        })
        .unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failure_backoff_progression() {
        assert_eq!(failure_backoff(0), Duration::ZERO);
        assert_eq!(failure_backoff(1), Duration::from_secs(60));
        assert_eq!(failure_backoff(2), Duration::from_secs(2 * 60));
        assert_eq!(failure_backoff(3), Duration::from_secs(4 * 60));
        assert_eq!(failure_backoff(4), Duration::from_secs(8 * 60));
        assert_eq!(failure_backoff(5), Duration::from_secs(16 * 60));
        assert_eq!(failure_backoff(6), Duration::from_secs(32 * 60));
        assert_eq!(failure_backoff(7), Duration::from_secs(60 * 60));
        assert_eq!(failure_backoff(99), Duration::from_secs(60 * 60));
    }

    #[test]
    fn default_updater_endpoint_targets_this_github_release() {
        assert_eq!(
            DEFAULT_UPDATER_ENDPOINT,
            "https://github.com/Varuas37/helmor-fork/releases/latest/download/latest.json"
        );
    }

    #[test]
    fn github_release_repository_extracts_owner_and_repo() {
        let url = Url::parse(
            "https://github.com/Varuas37/helmor-fork/releases/latest/download/latest.json",
        )
        .unwrap();

        assert_eq!(
            github_release_repository(&url),
            Some("Varuas37/helmor-fork")
        );
    }

    #[test]
    fn github_release_repository_ignores_non_release_urls() {
        let url = Url::parse("https://github.com/Varuas37/helmor-fork/issues").unwrap();

        assert_eq!(github_release_repository(&url), None);
    }
}
