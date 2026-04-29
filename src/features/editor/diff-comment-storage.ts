import type { DiffLineSide } from "@/lib/monaco-runtime";

const STORAGE_PREFIX = "helmor:diff-comments:";

export type DiffCommentScope = {
	workspaceRootPath?: string | null;
	path: string;
	originalRef?: string | null;
	modifiedRef?: string | null;
};

export type DiffComment = {
	id: string;
	side: DiffLineSide;
	lineNumber: number;
	body: string;
	createdAt: string;
};

export function getDiffCommentStorageKey(scope: DiffCommentScope): string {
	const raw = [
		scope.workspaceRootPath ?? "",
		scope.path,
		scope.originalRef ?? "",
		scope.modifiedRef ?? "",
	].join("\u001f");

	return `${STORAGE_PREFIX}${encodeURIComponent(raw)}`;
}

export function createDiffCommentId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}

	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function loadDiffComments(scope: DiffCommentScope): DiffComment[] {
	if (typeof window === "undefined") {
		return [];
	}

	try {
		const raw = window.localStorage.getItem(getDiffCommentStorageKey(scope));
		if (!raw) {
			return [];
		}

		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			return [];
		}

		return sortDiffComments(parsed.filter(isDiffComment));
	} catch {
		return [];
	}
}

export function saveDiffComments(
	scope: DiffCommentScope,
	comments: DiffComment[],
) {
	if (typeof window === "undefined") {
		return;
	}

	try {
		window.localStorage.setItem(
			getDiffCommentStorageKey(scope),
			JSON.stringify(sortDiffComments(comments)),
		);
	} catch (error) {
		console.error("[helmor] diff comment save failed", error);
	}
}

export function sortDiffComments(comments: DiffComment[]): DiffComment[] {
	return [...comments].sort((left, right) => {
		if (left.side !== right.side) {
			return left.side === "original" ? -1 : 1;
		}
		if (left.lineNumber !== right.lineNumber) {
			return left.lineNumber - right.lineNumber;
		}
		return left.createdAt.localeCompare(right.createdAt);
	});
}

function isDiffComment(value: unknown): value is DiffComment {
	if (!value || typeof value !== "object") {
		return false;
	}

	const candidate = value as Partial<DiffComment>;
	return (
		typeof candidate.id === "string" &&
		(candidate.side === "original" || candidate.side === "modified") &&
		typeof candidate.lineNumber === "number" &&
		Number.isInteger(candidate.lineNumber) &&
		candidate.lineNumber > 0 &&
		typeof candidate.body === "string" &&
		typeof candidate.createdAt === "string"
	);
}
