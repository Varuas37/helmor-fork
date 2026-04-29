import {
	createDiffCommentId,
	type DiffComment,
	type DiffCommentScope,
	loadDiffComments,
	saveDiffComments,
	sortDiffComments,
} from "@/features/editor/diff-comment-storage";
import type { InspectorFileItem } from "@/lib/editor-session";
import type { ReviewAgentComment } from "./types";

export type AppliedReviewCommentResult = {
	applied: number;
	skipped: number;
};

export function applyReviewAgentCommentsToStorage({
	workspaceRootPath,
	targetBranch,
	changes,
	comments,
}: {
	workspaceRootPath: string;
	targetBranch?: string | null;
	changes: InspectorFileItem[];
	comments: ReviewAgentComment[];
}): AppliedReviewCommentResult {
	const changeByPath = buildChangeLookup(changes);
	let applied = 0;
	let skipped = 0;

	for (const comment of comments) {
		const change = changeByPath.get(normalizePath(comment.filePath));
		if (!change) {
			skipped += 1;
			continue;
		}

		const scope: DiffCommentScope = {
			workspaceRootPath,
			path: change.absolutePath,
			originalRef: change.committedStatus && targetBranch ? targetBranch : null,
			modifiedRef: change.committedStatus && targetBranch ? "HEAD" : null,
		};
		const now = new Date().toISOString();
		const prefix = comment.severity
			? `**${formatSeverity(comment.severity)}**: `
			: "";
		const nextComment: DiffComment = {
			id: createDiffCommentId(),
			author: "review-agent",
			authorName: "Review agent",
			blocking: comment.severity === "blocking" ? true : undefined,
			side: comment.side,
			lineNumber: comment.lineNumber,
			body: `${prefix}${comment.body}`,
			createdAt: now,
			replies: [],
		};
		const existing = loadDiffComments(scope);
		saveDiffComments(scope, sortDiffComments([...existing, nextComment]));
		applied += 1;
	}

	return { applied, skipped };
}

function buildChangeLookup(
	changes: InspectorFileItem[],
): Map<string, InspectorFileItem> {
	const lookup = new Map<string, InspectorFileItem>();
	for (const change of changes) {
		lookup.set(normalizePath(change.path), change);
		lookup.set(normalizePath(change.absolutePath), change);
	}
	return lookup;
}

function formatSeverity(severity: NonNullable<ReviewAgentComment["severity"]>) {
	switch (severity) {
		case "blocking":
			return "Blocking";
		case "warning":
			return "Warning";
		case "suggestion":
			return "Suggestion";
		case "info":
			return "Info";
	}
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/^\.\/+/, "");
}
