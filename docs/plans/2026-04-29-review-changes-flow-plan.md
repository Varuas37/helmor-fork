# Review Changes Flow Plan

## Objective

Build an experimental code review flow on top of Helmor's existing Git diff UI. The flow should let a user inspect changed files, generate natural-language summaries, see a lightweight architecture/layer map, ask an independent review agent to leave diff comments, hide/show long comment threads, and feed review feedback back into chat for fixes.

## Relevant Existing Context

- `AGENTS.md`: new frontend features belong under `src/features/<name>/`; use shared UI primitives and lucide icons; every custom clickable element needs `cursor-pointer`; avoid monoliths.
- `src/features/editor/*diff-comment*`: existing diff comment storage, Monaco line anchors, thread rendering, and inline Helmor replies are the source of truth for review comments in this pass.
- `src/features/inspector/sections/changes.tsx`: the Git changes panel is the existing changed-file navigation surface and should receive comment counts/actions without replacing staging/discard behavior.
- `src/features/conversation` and `src/lib/api.ts`: visible review/fix work should be represented as real workspace chat sessions, not a hidden side channel.

## Behavior Contract

### New Behavior

- Diff header includes a summarize action for file-level natural-language review.
- A dedicated Review settings tab is marked experimental and lets users define the default summary prompt.
- The diff surface can toggle between the file diff and a full-file summary view that auto-renders structured summary fields, Mermaid, sandboxed HTML, or Markdown based on the AI response.
- File summaries are cached by diff scope plus effective prompt in frontend localStorage with TTL cleanup, so switching files or restarting the app keeps generated summaries until refresh or expiry.
- Review settings can append user preferences after the default prompt or overwrite the default prompt entirely.
- Diff header includes a show/hide comments toggle with a count for the current file.
- Git changes rows show comment counts per file.
- Git changes header exposes review-agent and fix-from-comments actions.
- The review agent opens a visible chat session, streams its review, and emits structured `helmor_review_comments` JSON that the frontend applies as anchored diff comments.
- Review comments can be flagged as blocking; the fix flow opens a visible chat session seeded only with blocking comments and asks the agent to address them.
- Diff comment composers open from line-number clicks, and multi-line selections are stored as range comments.

### Preserved Behavior

- Existing manual diff comments, replies, edit/delete, and `@helmor` inline replies continue to work.
- Existing staging, unstaging, discard, PR/create action, and branch-diff behavior remains unchanged.
- Existing localStorage diff comment persistence remains backward compatible.

### Removed Behavior

- None.

## Frontend / Visual Contract

- Keep the feature inside the existing editor and Git inspector surfaces rather than introducing a new full-screen app.
- Use compact icon buttons in the header/action rows; avoid large marketing-style panels.
- Summary content appears as an alternate view inside the file surface so the user can switch between code and explanation without reading a narrow side panel.
- HTML-only summary artifacts should occupy the summary view, hide empty default sections, and provide a fullscreen preview action.
- The artifact type is not selected from a UI picker; users steer the output through the prompt and the UI detects what came back.
- Comments should be hideable without deleting them.
- Long comment threads should be scrollable within the overlay and should not permanently block reading the file.
- Comment counts should be small badges near file names/status and should not disrupt row density.
- The UI should feel like a review tool: dense, restrained, and easy to scan.

## Implementation Workstreams

1. Extend diff comment storage with author metadata, blocking flags, line ranges, change notifications, and helpers to count/load comments across changed files.
2. Add `src/features/review-changes/` for prompts, parsing, summary generation, review-agent dispatch, and fix-prompt building.
3. Integrate summary panel and comment visibility controls into `WorkspaceEditorSurface`.
4. Integrate comment badges and review/fix actions into the Git changes panel.
5. Wire App-level session creation and queued prompts so review/fix flows open visible chat tabs.

## Validation Plan

- Run `bun run typecheck`.
- Run focused frontend tests for editor/inspector if typecheck exposes test fixture drift.
- If feasible after implementation, run the Tauri app and inspect the editor/inspector UI visually through the Tauri MCP bridge.

## Risk / Gotcha Carry-Forward

- Do not introduce a backend schema migration for the first experiment; comment and summary persistence remains frontend-local unless a later pass makes review state shared/collaborative.
- Summary cache keys must include the effective prompt, because appended preferences and overwrite mode can produce different artifacts for the same diff.
- Review-agent comments must be parsed from an explicit JSON action block. Invalid file paths or line numbers should be skipped, not forced into broken anchors.
- Summary generation should use hidden sessions; review/fix flows should use visible sessions because users need a real chat tab.
- Keep changed-file row actions from swallowing stage/discard clicks; use stopPropagation for action buttons.
