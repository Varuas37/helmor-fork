import type { DiffLineSide } from "@/lib/monaco-runtime";

const STORAGE_PREFIX = "helmor:diff-comments:";
const STORAGE_FIELD_SEPARATOR = "\u001f";

export const DIFF_COMMENTS_CHANGED_EVENT = "helmor:diff-comments-changed";

export type DiffCommentScope = {
	workspaceRootPath?: string | null;
	path: string;
	originalRef?: string | null;
	modifiedRef?: string | null;
};

export type DiffCommentAuthor = "user" | "helmor" | "review-agent";

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
	author?: DiffCommentAuthor;
	authorName?: string;
	blocking?: boolean;
	side: DiffLineSide;
	lineNumber: number;
	endLineNumber?: number;
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
	].join(STORAGE_FIELD_SEPARATOR);

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
		window.dispatchEvent(
			new CustomEvent(DIFF_COMMENTS_CHANGED_EVENT, {
				detail: {
					path: scope.path,
					workspaceRootPath: scope.workspaceRootPath ?? null,
					originalRef: scope.originalRef ?? null,
					modifiedRef: scope.modifiedRef ?? null,
					commentCount: comments.length,
				},
			}),
		);
	} catch (error) {
		console.error("[helmor] diff comment save failed", error);
	}
}

export function countDiffCommentsByPath({
	workspaceRootPath,
	paths,
	onlyBlocking = false,
}: {
	workspaceRootPath?: string | null;
	paths: Array<{ path: string; absolutePath?: string | null }>;
	onlyBlocking?: boolean;
}): Record<string, number> {
	if (typeof window === "undefined" || !workspaceRootPath) {
		return {};
	}

	const normalizedRoot = normalizePath(workspaceRootPath);
	const targetPaths = buildTargetPathMap(paths);
	const counts: Record<string, number> = {};

	for (const scope of iterateStoredDiffCommentScopes()) {
		if (normalizePath(scope.workspaceRootPath ?? "") !== normalizedRoot) {
			continue;
		}

		const displayPath = resolveDisplayPathForScope({
			scope,
			normalizedRoot,
			targetPaths,
		});
		if (!displayPath) {
			continue;
		}

		const commentCount = loadDiffComments(scope).filter(
			(comment) => !onlyBlocking || comment.blocking,
		).length;
		if (commentCount === 0) {
			continue;
		}

		counts[displayPath] = (counts[displayPath] ?? 0) + commentCount;
	}

	return counts;
}

export function loadAllDiffCommentsForPaths({
	workspaceRootPath,
	paths,
	onlyBlocking = false,
}: {
	workspaceRootPath?: string | null;
	paths: Array<{ path: string; absolutePath?: string | null }>;
	onlyBlocking?: boolean;
}): Array<{ path: string; scope: DiffCommentScope; comments: DiffComment[] }> {
	if (typeof window === "undefined" || !workspaceRootPath) {
		return [];
	}

	const normalizedRoot = normalizePath(workspaceRootPath);
	const targetPaths = buildTargetPathMap(paths);
	const entries: Array<{
		path: string;
		scope: DiffCommentScope;
		comments: DiffComment[];
	}> = [];

	for (const scope of iterateStoredDiffCommentScopes()) {
		if (normalizePath(scope.workspaceRootPath ?? "") !== normalizedRoot) {
			continue;
		}

		const displayPath = resolveDisplayPathForScope({
			scope,
			normalizedRoot,
			targetPaths,
		});
		if (!displayPath) {
			continue;
		}

		const comments = loadDiffComments(scope).filter(
			(comment) => !onlyBlocking || comment.blocking,
		);
		if (comments.length > 0) {
			entries.push({ path: displayPath, scope, comments });
		}
	}

	return entries.sort((left, right) => left.path.localeCompare(right.path));
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
				author: normalizeDiffCommentAuthor(candidate.author) ?? undefined,
				authorName:
					typeof candidate.authorName === "string"
						? candidate.authorName
						: undefined,
				blocking: candidate.blocking === true ? true : undefined,
				side: candidate.side,
				lineNumber: candidate.lineNumber,
				endLineNumber: normalizeEndLineNumber(
					candidate.endLineNumber,
					candidate.lineNumber,
				),
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

function normalizeEndLineNumber(
	value: unknown,
	lineNumber: number,
): number | undefined {
	return typeof value === "number" &&
		Number.isInteger(value) &&
		value > lineNumber
		? value
		: undefined;
}

function normalizeDiffCommentReply(value: unknown): DiffCommentReply[] {
	if (!value || typeof value !== "object") {
		return [];
	}

	const candidate = value as Partial<DiffCommentReply>;
	const author = normalizeDiffCommentAuthor(candidate.author);
	if (
		typeof candidate.id !== "string" ||
		!author ||
		typeof candidate.body !== "string" ||
		typeof candidate.createdAt !== "string"
	) {
		return [];
	}

	return [
		{
			id: candidate.id,
			author,
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

function normalizeDiffCommentAuthor(value: unknown): DiffCommentAuthor | null {
	if (value === "user" || value === "helmor" || value === "review-agent") {
		return value;
	}

	return null;
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

function buildTargetPathMap(
	paths: Array<{ path: string; absolutePath?: string | null }>,
): Map<string, string> {
	const targetPaths = new Map<string, string>();
	for (const item of paths) {
		targetPaths.set(normalizePath(item.path), item.path);
		if (item.absolutePath) {
			targetPaths.set(normalizePath(item.absolutePath), item.path);
		}
	}
	return targetPaths;
}

function resolveDisplayPathForScope({
	scope,
	normalizedRoot,
	targetPaths,
}: {
	scope: DiffCommentScope;
	normalizedRoot: string;
	targetPaths: Map<string, string>;
}): string | null {
	const normalizedScopePath = normalizePath(scope.path);
	const relativeScopePath = normalizeWorkspaceRelativePath(
		normalizedScopePath,
		normalizedRoot,
	);

	return (
		targetPaths.get(normalizedScopePath) ??
		targetPaths.get(relativeScopePath) ??
		null
	);
}

function iterateStoredDiffCommentScopes(): DiffCommentScope[] {
	if (typeof window === "undefined") {
		return [];
	}

	const scopes: DiffCommentScope[] = [];
	for (let index = 0; index < window.localStorage.length; index += 1) {
		const key = window.localStorage.key(index);
		if (!key?.startsWith(STORAGE_PREFIX)) {
			continue;
		}
		const scope = parseDiffCommentStorageKey(key);
		if (scope) {
			scopes.push(scope);
		}
	}
	return scopes;
}

function parseDiffCommentStorageKey(key: string): DiffCommentScope | null {
	if (!key.startsWith(STORAGE_PREFIX)) {
		return null;
	}

	try {
		const raw = decodeURIComponent(key.slice(STORAGE_PREFIX.length));
		const [workspaceRootPath, path, originalRef, modifiedRef] = raw.split(
			STORAGE_FIELD_SEPARATOR,
		);
		if (!path) {
			return null;
		}

		return {
			workspaceRootPath: workspaceRootPath || null,
			path,
			originalRef: originalRef || null,
			modifiedRef: modifiedRef || null,
		};
	} catch {
		return null;
	}
}

function normalizeWorkspaceRelativePath(path: string, root: string): string {
	const rootWithSlash = root.endsWith("/") ? root : `${root}/`;
	return path.startsWith(rootWithSlash)
		? path.slice(rootWithSlash.length)
		: path;
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/");
}
