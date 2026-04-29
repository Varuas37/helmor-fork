use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorFileReadResponse {
    pub path: String,
    pub content: String,
    pub mtime_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorFileWriteResponse {
    pub path: String,
    pub mtime_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorFileStatResponse {
    pub path: String,
    pub exists: bool,
    pub is_file: bool,
    pub mtime_ms: Option<i64>,
    pub size: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorFileListItem {
    pub path: String,
    pub absolute_path: String,
    pub name: String,
    pub status: String,
    pub insertions: u32,
    pub deletions: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staged_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unstaged_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub committed_status: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorFilePrefetchItem {
    pub absolute_path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorFilesWithContentResponse {
    pub items: Vec<EditorFileListItem>,
    pub prefetched: Vec<EditorFilePrefetchItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDiffRefItem {
    pub name: String,
    pub kind: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorFileChangeHunk {
    pub new_start: u32,
    pub new_lines: u32,
    pub old_start: u32,
    pub old_lines: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_text: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorFileChangeHunksResponse {
    pub base_ref: String,
    pub resolved_ref: String,
    pub base_commit: String,
    pub hunks: Vec<EditorFileChangeHunk>,
}
