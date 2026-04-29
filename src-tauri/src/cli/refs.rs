//! Reference resolvers — turn user-friendly strings into UUIDs.
//!
//! The service-layer already handles workspace (`repo-name/dir-name` or
//! UUID) and repository (UUID or name) refs. This module adds the
//! missing session resolver, which accepts either a UUID or a short
//! substring match within a specified workspace.

use anyhow::{bail, Result};

use crate::service;

/// Resolve a session reference. `reference` may be:
/// - A UUID (returned as-is once verified)
/// - The literal `"active"` — the workspace's active session
/// - A title prefix / substring — matched case-insensitively against
///   visible sessions in `workspace_id`.
pub fn resolve_session_ref(workspace_id: &str, reference: &str) -> Result<String> {
    if looks_like_uuid(reference) {
        return Ok(reference.to_string());
    }

    if reference.eq_ignore_ascii_case("active") {
        let detail = service::get_workspace(workspace_id)?;
        return detail
            .active_session_id
            .ok_or_else(|| anyhow::anyhow!("Workspace has no active session"));
    }

    let sessions = service::list_workspace_sessions(workspace_id)?;
    let needle = reference.to_lowercase();
    let matches: Vec<_> = sessions
        .iter()
        .filter(|s| s.title.to_lowercase().contains(&needle))
        .collect();

    match matches.len() {
        0 => bail!("No session found matching '{reference}'"),
        1 => Ok(matches[0].id.clone()),
        n => bail!("Ambiguous session ref '{reference}' matches {n} sessions. Use a UUID instead."),
    }
}

fn looks_like_uuid(s: &str) -> bool {
    s.len() == 36 && s.chars().filter(|c| *c == '-').count() == 4
}
