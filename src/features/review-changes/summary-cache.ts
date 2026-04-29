import {
	type DiffCommentScope,
	getDiffCommentStorageKey,
} from "@/features/editor/diff-comment-storage";
import type {
	FileReviewSummary,
	ReviewBeforeAfterRow,
	ReviewLayerSummary,
	ReviewSequenceStep,
} from "./types";

const SUMMARY_CACHE_PREFIX = "helmor:review-summary:";
const SUMMARY_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

type CachedFileReviewSummary = {
	version: 1;
	createdAt: string;
	expiresAt: number;
	summary: FileReviewSummary;
};

export function getFileReviewSummaryCacheKey(
	scope: DiffCommentScope,
	prompt: string,
): string {
	return `${SUMMARY_CACHE_PREFIX}${hashString(
		[getDiffCommentStorageKey(scope), prompt.trim()].join("\n"),
	)}`;
}

export function loadFileReviewSummaryCache(
	scope: DiffCommentScope,
	prompt: string,
): FileReviewSummary | null {
	if (typeof window === "undefined") {
		return null;
	}

	pruneExpiredFileReviewSummaryCache();
	try {
		const raw = window.localStorage.getItem(
			getFileReviewSummaryCacheKey(scope, prompt),
		);
		if (!raw) {
			return null;
		}
		const parsed = JSON.parse(raw) as Partial<CachedFileReviewSummary>;
		if (parsed.expiresAt && parsed.expiresAt <= Date.now()) {
			window.localStorage.removeItem(
				getFileReviewSummaryCacheKey(scope, prompt),
			);
			return null;
		}
		return normalizeSummary(parsed.summary);
	} catch {
		return null;
	}
}

export function saveFileReviewSummaryCache({
	scope,
	prompt,
	summary,
}: {
	scope: DiffCommentScope;
	prompt: string;
	summary: FileReviewSummary;
}) {
	if (typeof window === "undefined") {
		return;
	}

	const payload: CachedFileReviewSummary = {
		version: 1,
		createdAt: new Date().toISOString(),
		expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS,
		summary,
	};

	try {
		window.localStorage.setItem(
			getFileReviewSummaryCacheKey(scope, prompt),
			JSON.stringify(payload),
		);
	} catch (error) {
		console.warn("[review-changes] failed to persist summary cache:", error);
	}
}

export function pruneExpiredFileReviewSummaryCache() {
	if (typeof window === "undefined") {
		return;
	}

	try {
		const keys: string[] = [];
		for (let index = 0; index < window.localStorage.length; index += 1) {
			const key = window.localStorage.key(index);
			if (key?.startsWith(SUMMARY_CACHE_PREFIX)) {
				keys.push(key);
			}
		}

		const now = Date.now();
		for (const key of keys) {
			const raw = window.localStorage.getItem(key);
			if (!raw) {
				continue;
			}
			const parsed = JSON.parse(raw) as Partial<CachedFileReviewSummary>;
			if (!parsed.expiresAt || parsed.expiresAt <= now) {
				window.localStorage.removeItem(key);
			}
		}
	} catch {
		// Cache cleanup is best-effort.
	}
}

function normalizeSummary(value: unknown): FileReviewSummary | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const candidate = value as Partial<FileReviewSummary>;
	const plainLanguageSummary = readString(candidate.plainLanguageSummary);
	if (!plainLanguageSummary) {
		return null;
	}

	return {
		plainLanguageSummary,
		beforeAfter: readBeforeAfter(candidate.beforeAfter),
		userFeatureImpact: readStringArray(candidate.userFeatureImpact),
		technicalChanges: readStringArray(candidate.technicalChanges),
		riskNotes: readStringArray(candidate.riskNotes),
		layers: readLayers(candidate.layers),
		sequence: readSequence(candidate.sequence),
		markdown: readNullableString(candidate.markdown),
		mermaid: readNullableString(candidate.mermaid),
		html: readNullableString(candidate.html),
	};
}

function readBeforeAfter(value: unknown): ReviewBeforeAfterRow[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.flatMap((item) => {
		if (!item || typeof item !== "object") {
			return [];
		}
		const candidate = item as Partial<ReviewBeforeAfterRow>;
		const before = readString(candidate.before);
		const after = readString(candidate.after);
		if (!before || !after) {
			return [];
		}
		return [
			{
				before,
				after,
				impact: readString(candidate.impact) || undefined,
			},
		];
	});
}

function readLayers(value: unknown): ReviewLayerSummary[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.flatMap((item) => {
		if (!item || typeof item !== "object") {
			return [];
		}
		const candidate = item as Partial<ReviewLayerSummary>;
		const name = readString(candidate.name);
		const summary = readString(candidate.summary);
		if (!name || !summary) {
			return [];
		}
		return [{ name, summary, files: readStringArray(candidate.files) }];
	});
}

function readSequence(value: unknown): ReviewSequenceStep[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.flatMap((item) => {
		if (!item || typeof item !== "object") {
			return [];
		}
		const candidate = item as Partial<ReviewSequenceStep>;
		const from = readString(candidate.from);
		const to = readString(candidate.to);
		const label = readString(candidate.label);
		return from && to && label ? [{ from, to, label }] : [];
	});
}

function readStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.flatMap((item) => {
		const text = readString(item);
		return text ? [text] : [];
	});
}

function readNullableString(value: unknown): string | null {
	const text = readString(value);
	return text || null;
}

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function hashString(value: string): string {
	let hash = 0;
	for (let index = 0; index < value.length; index += 1) {
		hash = (hash * 31 + value.charCodeAt(index)) | 0;
	}
	return Math.abs(hash).toString(36);
}
