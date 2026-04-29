use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use anyhow::{bail, Context, Result};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::{
    error::{extract_code, outermost_message, ErrorCode},
    git_watcher,
};

use super::lifecycle::{execute_archive_plan, prepare_archive_plan, ArchivePreparedPlan};

pub const ARCHIVE_EXECUTION_FAILED_EVENT: &str = "archive-execution-failed";
pub const ARCHIVE_EXECUTION_SUCCEEDED_EVENT: &str = "archive-execution-succeeded";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareArchiveWorkspaceResponse {
    pub workspace_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveExecutionFailedPayload {
    pub workspace_id: String,
    pub code: ErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveExecutionSucceededPayload {
    pub workspace_id: String,
}

#[derive(Default)]
struct ArchiveJobState {
    prepared: HashMap<String, ArchivePreparedPlan>,
    running: HashSet<String>,
}

pub struct ArchiveJobManager {
    state: Mutex<ArchiveJobState>,
}

impl Default for ArchiveJobManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ArchiveJobManager {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(ArchiveJobState::default()),
        }
    }

    pub fn prepare(&self, workspace_id: &str) -> Result<PrepareArchiveWorkspaceResponse> {
        let plan = prepare_archive_plan(workspace_id)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("archive job lock poisoned"))?;

        if state.running.contains(workspace_id) {
            bail!("Archive already in progress: {workspace_id}");
        }

        state.prepared.insert(workspace_id.to_string(), plan);

        Ok(PrepareArchiveWorkspaceResponse {
            workspace_id: workspace_id.to_string(),
        })
    }

    fn start_prepared(&self, workspace_id: &str) -> Result<ArchivePreparedPlan> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("archive job lock poisoned"))?;

        if state.running.contains(workspace_id) {
            bail!("Archive already in progress: {workspace_id}");
        }

        let plan = state
            .prepared
            .remove(workspace_id)
            .with_context(|| format!("Archive preflight is missing for {workspace_id}"))?;
        state.running.insert(workspace_id.to_string());
        Ok(plan)
    }

    fn finish(&self, workspace_id: &str) {
        if let Ok(mut state) = self.state.lock() {
            state.running.remove(workspace_id);
        }
    }
}

pub fn start_archive_workspace<R: Runtime>(app: &AppHandle<R>, workspace_id: &str) -> Result<()> {
    let manager = app.state::<ArchiveJobManager>();
    let plan = manager.start_prepared(workspace_id)?;
    let app_handle = app.clone();
    let workspace_id = workspace_id.to_string();

    tauri::async_runtime::spawn(async move {
        let task_started = std::time::Instant::now();

        let unwatch_started = std::time::Instant::now();
        app_handle
            .state::<git_watcher::GitWatcherManager>()
            .unwatch(&workspace_id);
        tracing::debug!(
            workspace_id,
            elapsed_ms = unwatch_started.elapsed().as_millis(),
            "Archive: git unwatch finished"
        );

        let result =
            tauri::async_runtime::spawn_blocking(move || execute_archive_plan(&plan)).await;

        match result {
            Ok(Ok(_)) => {
                let sync_started = std::time::Instant::now();
                git_watcher::notify_workspace_changed(&app_handle);
                tracing::debug!(
                    workspace_id,
                    elapsed_ms = sync_started.elapsed().as_millis(),
                    "Archive: notify_workspace_changed finished"
                );
                tracing::info!(
                    workspace_id,
                    total_ms = task_started.elapsed().as_millis(),
                    "Archive: task finished (success)"
                );
                let _ = app_handle.emit(
                    ARCHIVE_EXECUTION_SUCCEEDED_EVENT,
                    ArchiveExecutionSucceededPayload {
                        workspace_id: workspace_id.clone(),
                    },
                );
            }
            Ok(Err(error)) => {
                tracing::error!(
                    workspace_id,
                    code = ?extract_code(&error),
                    error = %format!("{error:#}"),
                    "Archive execution failed"
                );
                git_watcher::notify_workspace_changed(&app_handle);
                let _ = app_handle.emit(
                    ARCHIVE_EXECUTION_FAILED_EVENT,
                    ArchiveExecutionFailedPayload {
                        workspace_id: workspace_id.clone(),
                        code: extract_code(&error),
                        message: outermost_message(&error),
                    },
                );
            }
            Err(error) => {
                tracing::error!(workspace_id, error = %error, "Archive execution task crashed");
                git_watcher::notify_workspace_changed(&app_handle);
                let _ = app_handle.emit(
                    ARCHIVE_EXECUTION_FAILED_EVENT,
                    ArchiveExecutionFailedPayload {
                        workspace_id: workspace_id.clone(),
                        code: ErrorCode::Unknown,
                        message: format!("Archive task failed: {error}"),
                    },
                );
            }
        }

        app_handle
            .state::<ArchiveJobManager>()
            .finish(&workspace_id);
    });

    Ok(())
}
