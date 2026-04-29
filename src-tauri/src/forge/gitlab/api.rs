//! Thin wrapper around `glab api …` plus the URL-encoding helpers every
//! endpoint call needs. Higher-level modules (`merge_request`, `pipeline`,
//! `review`) call [`glab_api`] with ready-to-go argv and get the raw
//! process output back.

use crate::{
    error::{AnyhowCodedExt, ErrorCode},
    forge::command::{run_command, CommandOutput},
};

/// Run `glab api --hostname <host> …args`, capturing stdout/stderr.
pub(super) fn glab_api<'a>(
    host: &str,
    args: impl IntoIterator<Item = &'a str>,
) -> anyhow::Result<CommandOutput> {
    let mut full_args = vec![
        "api".to_string(),
        "--hostname".to_string(),
        host.to_string(),
    ];
    full_args.extend(args.into_iter().map(str::to_string));
    tracing::debug!(host, args = ?full_args, "Running glab api");
    let output = run_command("glab", full_args);
    match &output {
        Ok(output) if output.success => {
            tracing::debug!(host, status = ?output.status, "glab api completed");
        }
        Ok(output) => {
            tracing::warn!(
                host,
                status = ?output.status,
                detail = %command_detail(output),
                "glab api failed"
            );
        }
        Err(error) => {
            if error.kind() == std::io::ErrorKind::NotFound {
                tracing::warn!(host, error = %error, "GitLab CLI is missing");
                return Err(
                    anyhow::anyhow!(error.to_string()).with_code(ErrorCode::ForgeOnboarding)
                );
            } else {
                tracing::error!(host, error = %error, "Failed to run glab api");
            }
        }
    }
    output.map_err(anyhow::Error::new)
}

/// Render a command's combined output as a single user-facing detail
/// string. Prefers stderr (where `glab` writes errors) and falls back to
/// stdout or the process exit code.
pub(super) fn command_detail(output: &CommandOutput) -> String {
    let stderr = output.stderr.trim();
    if !stderr.is_empty() {
        return stderr.to_string();
    }
    let stdout = output.stdout.trim();
    if !stdout.is_empty() {
        return stdout.to_string();
    }
    match output.status {
        Some(code) => format!("glab exited with status {code}"),
        None => "glab exited unsuccessfully".to_string(),
    }
}

/// Percent-encode a segment destined for a GitLab API path (e.g. the
/// `group/sub/project` component becomes `group%2Fsub%2Fproject`).
pub(super) fn encode_path_component(value: &str) -> String {
    encode_percent(value)
}

/// Percent-encode a query-string value.
pub(super) fn encode_query_value(value: &str) -> String {
    encode_percent(value)
}

fn encode_percent(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

pub(super) fn looks_like_missing_error(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    normalized.contains("404") || normalized.contains("not found")
}

pub(super) fn looks_like_auth_error(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    normalized.contains("401")
        || normalized.contains("403")
        || normalized.contains("no token found")
        || normalized.contains("unauthenticated")
        || normalized.contains("unauthorized")
        || normalized.contains("forbidden")
        || normalized.contains("not logged in")
        || normalized.contains("not logged into")
        || normalized.contains("authentication required")
        || normalized.contains("authentication failed")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_gitlab_project_path_for_api() {
        assert_eq!(
            encode_path_component("platform/tools/api"),
            "platform%2Ftools%2Fapi"
        );
    }

    #[test]
    fn classifies_missing_and_auth_errors() {
        assert!(looks_like_missing_error("404 Not Found"));
        assert!(!looks_like_missing_error("401 Unauthorized"));
        assert!(looks_like_auth_error("401 Unauthorized"));
        assert!(looks_like_auth_error("Unauthenticated."));
        assert!(looks_like_auth_error("No token found"));
        assert!(looks_like_auth_error("authentication required"));
        assert!(looks_like_auth_error("authentication failed"));
        assert!(!looks_like_auth_error("authentication is optional"));
        assert!(!looks_like_auth_error("500 Internal Server Error"));
    }
}
