import type { DiffLineSide } from "@/lib/monaco-runtime";

const STORAGE_PREFIX = "helmor:diff-comments:";

export type DiffCommentScope = {
	workspaceRootPath?: string | null;
	path: string;
	originalRef?: string | null;
	modifiedRef?: string | null;
};

export type DiffCommentAuthor = "user" | "helmor";

export type DiffCommentReplyStatus = "pending" | "streaming" | "done" | "error";

export type DiffCommentReply = {
	id: string;
	author: DiffCommentAuthor;
	body: string;
	createdAt: string;
	updatedAt?: string;
	status?: DiffCommentReplyStatus;
	errorMessage?: string;
	helmorSessionId?: string | null;
};

export type DiffComment = {
	id: string;
	side: DiffLineSide;
	lineNumber: number;
	body: string;
	createdAt: string;
	updatedAt?: string;
	replies: DiffCommentReply[];
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

		return sortDiffComments(parsed.flatMap(normalizeDiffComment));
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

function normalizeDiffComment(value: unknown): DiffComment[] {
	if (!value || typeof value !== "object") {
		return [];
	}

	const candidate = value as Partial<DiffComment> & {
		replies?: unknown;
	};
	if (
		typeof candidate.id === "string" &&
		(candidate.side === "original" || candidate.side === "modified") &&
		typeof candidate.lineNumber === "number" &&
		Number.isInteger(candidate.lineNumber) &&
		candidate.lineNumber > 0 &&
		typeof candidate.body === "string" &&
		typeof candidate.createdAt === "string"
	) {
		return [
			{
				id: candidate.id,
				side: candidate.side,
				lineNumber: candidate.lineNumber,
				body: candidate.body,
				createdAt: candidate.createdAt,
				updatedAt:
					typeof candidate.updatedAt === "string"
						? candidate.updatedAt
						: undefined,
				replies: Array.isArray(candidate.replies)
					? candidate.replies.flatMap(normalizeDiffCommentReply)
					: [],
			},
		];
	}

	return [];
}

function normalizeDiffCommentReply(value: unknown): DiffCommentReply[] {
	if (!value || typeof value !== "object") {
		return [];
	}

	const candidate = value as Partial<DiffCommentReply>;
	if (
		typeof candidate.id !== "string" ||
		(candidate.author !== "user" && candidate.author !== "helmor") ||
		typeof candidate.body !== "string" ||
		typeof candidate.createdAt !== "string"
	) {
		return [];
	}

	return [
		{
			id: candidate.id,
			author: candidate.author,
			body: candidate.body,
			createdAt: candidate.createdAt,
			updatedAt:
				typeof candidate.updatedAt === "string"
					? candidate.updatedAt
					: undefined,
			status: isDiffCommentReplyStatus(candidate.status)
				? candidate.status
				: undefined,
			errorMessage:
				typeof candidate.errorMessage === "string"
					? candidate.errorMessage
					: undefined,
			helmorSessionId:
				typeof candidate.helmorSessionId === "string"
					? candidate.helmorSessionId
					: null,
		},
	];
}

function isDiffCommentReplyStatus(
	value: unknown,
): value is DiffCommentReplyStatus {
	return (
		value === "pending" ||
		value === "streaming" ||
		value === "done" ||
		value === "error"
	);
}
