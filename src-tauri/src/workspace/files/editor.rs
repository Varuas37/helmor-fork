use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{bail, Context, Result};

use super::{
    support::{
        atomic_write_file, collect_editor_files, collect_workspace_files_for_mention,
        editor_file_sort_key, metadata_mtime_ms, resolve_allowed_path,
    },
    types::{
        EditorFileChangeHunk, EditorFileChangeHunksResponse, EditorFileListItem,
        EditorFilePrefetchItem, EditorFileReadResponse, EditorFileStatResponse,
        EditorFileWriteResponse, EditorFilesWithContentResponse, WorkspaceDiffRefItem,
    },
};
use crate::{
    bail_coded,
    error::{AnyhowCodedExt, ErrorCode},
    git_ops,
};

const MAX_EDITOR_FILE_ITEMS: usize = 24;
const MAX_PREFETCH_BYTES: u64 = 1_048_576;
const DEFAULT_DIFF_BASE_REF: &str = "origin/HEAD";

/// Read a file at a given git ref. Returns `None` when the path doesn't
/// exist in that ref, or when the workspace itself has vanished (e.g. the
/// user deleted the worktree while an old diff view was still open).
pub fn read_file_at_ref(
    workspace_root_path: &str,
    file_path: &str,
    git_ref: &str,
) -> Result<Option<String>> {
    let workspace_root = Path::new(workspace_root_path);
    if !workspace_root.is_absolute() {
        bail!(
            "Workspace root must be an absolute path: {}",
            workspace_root.display()
        );
    }
    if !workspace_root.is_dir() {
        return Ok(None);
    }

    let abs = Path::new(file_path);
    let relative = abs
        .strip_prefix(workspace_root)
        .with_context(|| format!("{file_path} is not inside {workspace_root_path}"))?;
    let relative_str = relative.to_string_lossy().replace('\\', "/");

    let object = format!("{git_ref}:{relative_str}");
    match crate::git_ops::run_git(["show", &object], Some(workspace_root)) {
        Ok(content) => Ok(Some(content)),
        Err(_) => Ok(None),
    }
}

pub fn read_editor_file(path: &str) -> Result<EditorFileReadResponse> {
    let resolved_path = resolve_allowed_path(Path::new(path), false)?;
    let metadata = match fs::metadata(&resolved_path) {
        Ok(metadata) => metadata,
        // File or any parent component vanished after the open — treat as
        // broken workspace so the frontend offers a recovery action rather
        // than a bare "no such file" toast.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(anyhow::Error::new(error)
                .context(format!(
                    "Editor file no longer exists: {}",
                    resolved_path.display()
                ))
                .with_code(ErrorCode::WorkspaceBroken));
        }
        Err(error) => {
            return Err(error)
                .with_context(|| format!("Failed to stat editor file {}", resolved_path.display()))
        }
    };

    if !metadata.is_file() {
        bail!("Editor target is not a file: {}", resolved_path.display());
    }

    let bytes = fs::read(&resolved_path)
        .with_context(|| format!("Failed to read editor file {}", resolved_path.display()))?;
    let content = String::from_utf8(bytes).with_context(|| {
        format!(
            "Editor file is not valid UTF-8: {}",
            resolved_path.display()
        )
    })?;

    Ok(EditorFileReadResponse {
        path: resolved_path.display().to_string(),
        content,
        mtime_ms: metadata_mtime_ms(&metadata)?,
    })
}

pub fn write_editor_file(path: &str, content: &str) -> Result<EditorFileWriteResponse> {
    let resolved_path = resolve_allowed_path(Path::new(path), false)?;
    let metadata = match fs::metadata(&resolved_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // Target file or parent dir vanished between open and save.
            // Bail with a recoverable code; the editor should prompt to
            // reload / save elsewhere rather than surface a plain error.
            bail_coded!(
                ErrorCode::WorkspaceBroken,
                "Cannot save: {} no longer exists on disk",
                resolved_path.display()
            );
        }
        Err(error) => {
            return Err(error)
                .with_context(|| format!("Failed to stat editor file {}", resolved_path.display()))
        }
    };

    if !metadata.is_file() {
        bail!("Editor target is not a file: {}", resolved_path.display());
    }

    atomic_write_file(&resolved_path, content.as_bytes())?;

    let updated_metadata = fs::metadata(&resolved_path).with_context(|| {
        format!(
            "Failed to stat editor file after save {}",
            resolved_path.display()
        )
    })?;

    Ok(EditorFileWriteResponse {
        path: resolved_path.display().to_string(),
        mtime_ms: metadata_mtime_ms(&updated_metadata)?,
    })
}

pub fn stat_editor_file(path: &str) -> Result<EditorFileStatResponse> {
    let resolved_path = resolve_allowed_path(Path::new(path), false)?;

    match fs::metadata(&resolved_path) {
        Ok(metadata) => Ok(EditorFileStatResponse {
            path: resolved_path.display().to_string(),
            exists: true,
            is_file: metadata.is_file(),
            mtime_ms: Some(metadata_mtime_ms(&metadata)?),
            size: Some(metadata.len() as i64),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(EditorFileStatResponse {
            path: resolved_path.display().to_string(),
            exists: false,
            is_file: false,
            mtime_ms: None,
            size: None,
        }),
        Err(error) => Err(error)
            .with_context(|| format!("Failed to stat editor file {}", resolved_path.display())),
    }
}

pub fn list_editor_files(workspace_root_path: &str) -> Result<Vec<EditorFileListItem>> {
    let Some(workspace_root) = resolve_workspace_root_optional(workspace_root_path)? else {
        return Ok(Vec::new());
    };
    let mut discovered_files = Vec::<PathBuf>::new();
    collect_editor_files(&workspace_root, &workspace_root, &mut discovered_files)?;
    discovered_files.sort_by(|left, right| {
        editor_file_sort_key(&workspace_root, left)
            .cmp(&editor_file_sort_key(&workspace_root, right))
    });
    discovered_files.truncate(MAX_EDITOR_FILE_ITEMS);

    Ok(build_list_items(&workspace_root, discovered_files))
}

pub fn list_workspace_files(workspace_root_path: &str) -> Result<Vec<EditorFileListItem>> {
    let Some(workspace_root) = resolve_workspace_root_optional(workspace_root_path)? else {
        return Ok(Vec::new());
    };
    let mut discovered_files = Vec::<PathBuf>::new();
    collect_workspace_files_for_mention(&workspace_root, &mut discovered_files)?;
    discovered_files.sort_by(|left, right| {
        editor_file_sort_key(&workspace_root, left)
            .cmp(&editor_file_sort_key(&workspace_root, right))
    });

    Ok(build_list_items(&workspace_root, discovered_files))
}

pub fn list_workspace_diff_refs(workspace_root_path: &str) -> Result<Vec<WorkspaceDiffRefItem>> {
    let Some(workspace_root) = resolve_workspace_root_optional(workspace_root_path)? else {
        return Ok(Vec::new());
    };

    let default_remote_ref = resolve_default_diff_ref(&workspace_root);
    let output = git_ops::run_git(
        [
            "for-each-ref",
            "--format=%(refname:short)%09%(refname)",
            "refs/remotes",
            "refs/heads",
        ],
        Some(&workspace_root),
    )
    .unwrap_or_default();

    let mut refs = std::collections::BTreeMap::<String, WorkspaceDiffRefItem>::new();
    if default_remote_ref
        .as_deref()
        .is_some_and(|value| value != "HEAD")
    {
        refs.insert(
            DEFAULT_DIFF_BASE_REF.to_string(),
            WorkspaceDiffRefItem {
                name: DEFAULT_DIFF_BASE_REF.to_string(),
                kind: "default".to_string(),
                is_default: true,
            },
        );
    }

    for line in output.lines() {
        let Some((name, full_ref)) = line.split_once('\t') else {
            continue;
        };
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        let kind = if full_ref.starts_with("refs/remotes/") {
            "remote"
        } else if full_ref.starts_with("refs/heads/") {
            "local"
        } else {
            "ref"
        };
        refs.insert(
            name.to_string(),
            WorkspaceDiffRefItem {
                name: name.to_string(),
                kind: kind.to_string(),
                is_default: default_remote_ref.as_deref() == Some(name),
            },
        );
    }

    Ok(refs.into_values().collect())
}

pub fn get_editor_file_change_hunks(
    workspace_root_path: &str,
    file_path: &str,
    base_ref: &str,
) -> Result<EditorFileChangeHunksResponse> {
    let Some(workspace_root) = resolve_workspace_root_optional(workspace_root_path)? else {
        return Ok(EditorFileChangeHunksResponse {
            base_ref: normalized_diff_base_ref(base_ref).to_string(),
            resolved_ref: "HEAD".to_string(),
            base_commit: String::new(),
            hunks: Vec::new(),
        });
    };

    let resolved_path = resolve_allowed_path(Path::new(file_path), false)?;
    let relative = resolved_path
        .strip_prefix(&workspace_root)
        .with_context(|| format!("{file_path} is not inside {workspace_root_path}"))?;
    let relative_str = relative.to_string_lossy().replace('\\', "/");
    let requested_base_ref = normalized_diff_base_ref(base_ref);
    let (resolved_ref, base_commit) =
        resolve_diff_base_commit(&workspace_root, requested_base_ref)?;

    if is_untracked_file(&workspace_root, &relative_str) {
        let content = fs::read_to_string(&resolved_path).unwrap_or_default();
        let line_count = content_line_count(&content);
        let hunks = if line_count == 0 {
            Vec::new()
        } else {
            vec![EditorFileChangeHunk {
                new_start: 1,
                new_lines: line_count,
                old_start: 0,
                old_lines: 0,
                old_text: None,
            }]
        };
        return Ok(EditorFileChangeHunksResponse {
            base_ref: requested_base_ref.to_string(),
            resolved_ref,
            base_commit,
            hunks,
        });
    }

    let diff = git_ops::run_git(
        [
            "diff",
            "--no-ext-diff",
            "--unified=0",
            base_commit.as_str(),
            "--",
            relative_str.as_str(),
        ],
        Some(&workspace_root),
    )
    .unwrap_or_default();

    Ok(EditorFileChangeHunksResponse {
        base_ref: requested_base_ref.to_string(),
        resolved_ref,
        base_commit,
        hunks: parse_unified_zero_change_hunks(&diff),
    })
}

pub fn list_editor_files_with_content(
    workspace_root_path: &str,
) -> Result<EditorFilesWithContentResponse> {
    let items = list_editor_files(workspace_root_path)?;
    let prefetched = prefetch_items(&items, true);

    Ok(EditorFilesWithContentResponse { items, prefetched })
}

/// Best-effort variant for read-only listers. Returns `None` if the
/// workspace directory has vanished (deleted externally, archived, etc.)
/// so callers surface an empty list instead of a red toast. Real errors
/// (permission denied, path outside allowed roots, malformed arg) still
/// propagate.
fn resolve_workspace_root_optional(workspace_root_path: &str) -> Result<Option<PathBuf>> {
    let workspace_root = resolve_allowed_path(Path::new(workspace_root_path), false)?;
    match fs::metadata(&workspace_root) {
        Ok(metadata) if metadata.is_dir() => Ok(Some(workspace_root)),
        Ok(_) => Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            tracing::warn!(
                path = %workspace_root.display(),
                "workspace root missing; returning empty file list",
            );
            Ok(None)
        }
        Err(error) => Err(error)
            .with_context(|| format!("Failed to stat workspace root {}", workspace_root.display())),
    }
}

fn build_list_items(
    workspace_root: &Path,
    discovered_files: Vec<PathBuf>,
) -> Vec<EditorFileListItem> {
    discovered_files
        .into_iter()
        .filter_map(|path| {
            let relative_path = path.strip_prefix(workspace_root).ok()?;
            Some(EditorFileListItem {
                path: relative_path.to_string_lossy().replace('\\', "/"),
                absolute_path: path.display().to_string(),
                name: path.file_name()?.to_string_lossy().to_string(),
                status: "M".to_string(),
                insertions: 0,
                deletions: 0,
                staged_status: None,
                unstaged_status: None,
                committed_status: None,
            })
        })
        .collect()
}

fn prefetch_items(
    items: &[EditorFileListItem],
    include_deleted: bool,
) -> Vec<EditorFilePrefetchItem> {
    items
        .iter()
        .filter(|item| include_deleted || item.status != "D")
        .filter_map(|item| {
            let path = Path::new(&item.absolute_path);
            let metadata = fs::metadata(path).ok()?;
            if metadata.len() > MAX_PREFETCH_BYTES {
                return None;
            }
            let bytes = fs::read(path).ok()?;
            let content = String::from_utf8(bytes).ok()?;
            Some(EditorFilePrefetchItem {
                absolute_path: item.absolute_path.clone(),
                content,
            })
        })
        .collect()
}

fn normalized_diff_base_ref(base_ref: &str) -> &str {
    let trimmed = base_ref.trim();
    if trimmed.is_empty() {
        DEFAULT_DIFF_BASE_REF
    } else {
        trimmed
    }
}

fn resolve_origin_head_alias(workspace_root: &Path) -> Option<String> {
    git_ops::run_git(
        ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
        Some(workspace_root),
    )
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
}

fn resolve_default_diff_ref(workspace_root: &Path) -> Option<String> {
    resolve_origin_head_alias(workspace_root)
        .or_else(|| existing_git_ref(workspace_root, "origin/main"))
        .or_else(|| existing_git_ref(workspace_root, "origin/mainline"))
        .or_else(|| existing_git_ref(workspace_root, "HEAD"))
}

fn existing_git_ref(workspace_root: &Path, git_ref: &str) -> Option<String> {
    let commit_expr = format!("{git_ref}^{{commit}}");
    git_ops::run_git(
        ["rev-parse", "--verify", &commit_expr],
        Some(workspace_root),
    )
    .ok()
    .map(|_| git_ref.to_string())
}

fn resolve_diff_base_commit(workspace_root: &Path, base_ref: &str) -> Result<(String, String)> {
    let resolved_ref = if base_ref == DEFAULT_DIFF_BASE_REF {
        resolve_default_diff_ref(workspace_root).unwrap_or_else(|| "HEAD".to_string())
    } else {
        base_ref.to_string()
    };
    let commit_expr = format!("{resolved_ref}^{{commit}}");
    let target_commit = git_ops::run_git(
        ["rev-parse", "--verify", &commit_expr],
        Some(workspace_root),
    )
    .with_context(|| format!("Unable to resolve diff base ref `{base_ref}`"))?
    .trim()
    .to_string();
    let base_commit = git_ops::run_git(
        ["merge-base", target_commit.as_str(), "HEAD"],
        Some(workspace_root),
    )
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
    .unwrap_or_else(|| target_commit.clone());

    Ok((resolved_ref, base_commit))
}

fn is_untracked_file(workspace_root: &Path, relative_path: &str) -> bool {
    git_ops::run_git(
        [
            "ls-files",
            "--others",
            "--exclude-standard",
            "--",
            relative_path,
        ],
        Some(workspace_root),
    )
    .map(|output| output.lines().any(|line| line.trim() == relative_path))
    .unwrap_or(false)
}

fn content_line_count(content: &str) -> u32 {
    if content.is_empty() {
        0
    } else {
        content.lines().count() as u32
    }
}

#[derive(Debug)]
struct ParsedChangeHunk {
    old_start: u32,
    old_lines: u32,
    new_start: u32,
    new_lines: u32,
    old_text_lines: Vec<String>,
}

fn parse_unified_zero_change_hunks(diff: &str) -> Vec<EditorFileChangeHunk> {
    let mut hunks = Vec::new();
    let mut current: Option<ParsedChangeHunk> = None;

    for line in diff.lines() {
        if line.starts_with("@@ ") {
            push_parsed_change_hunk(&mut hunks, current.take());
            current =
                parse_hunk_header(line).map(|((old_start, old_lines), (new_start, new_lines))| {
                    ParsedChangeHunk {
                        old_start,
                        old_lines,
                        new_start,
                        new_lines,
                        old_text_lines: Vec::new(),
                    }
                });
            continue;
        }

        let Some(hunk) = current.as_mut() else {
            continue;
        };
        if line.starts_with("--- ") || line.starts_with("+++ ") {
            continue;
        }
        if let Some(old_line) = line.strip_prefix('-') {
            hunk.old_text_lines.push(old_line.to_string());
        }
    }

    push_parsed_change_hunk(&mut hunks, current);
    hunks
}

fn push_parsed_change_hunk(
    hunks: &mut Vec<EditorFileChangeHunk>,
    parsed: Option<ParsedChangeHunk>,
) {
    let Some(parsed) = parsed else {
        return;
    };
    if parsed.new_lines == 0 {
        return;
    }
    let old_text = if parsed.old_text_lines.is_empty() {
        None
    } else {
        Some(parsed.old_text_lines.join("\n"))
    };
    hunks.push(EditorFileChangeHunk {
        new_start: parsed.new_start,
        new_lines: parsed.new_lines,
        old_start: parsed.old_start,
        old_lines: parsed.old_lines,
        old_text,
    });
}

fn parse_hunk_header(header: &str) -> Option<((u32, u32), (u32, u32))> {
    let mut parts = header.split_whitespace();
    if parts.next()? != "@@" {
        return None;
    }
    let old_range = parse_diff_range(parts.next()?, '-')?;
    let new_range = parse_diff_range(parts.next()?, '+')?;
    Some((old_range, new_range))
}

fn parse_diff_range(value: &str, sign: char) -> Option<(u32, u32)> {
    let range = value.strip_prefix(sign)?;
    let (start, count) = match range.split_once(',') {
        Some((start, count)) => (start, count),
        None => (range, "1"),
    };
    Some((start.parse().ok()?, count.parse().ok()?))
}
