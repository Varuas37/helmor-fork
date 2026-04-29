import { beforeEach, describe, expect, it } from "vitest";
import type { DiffCommentScope } from "@/features/editor/diff-comment-storage";
import {
	getFileReviewSummaryCacheKey,
	loadFileReviewSummaryCache,
	saveFileReviewSummaryCache,
} from "./summary-cache";
import type { FileReviewSummary } from "./types";

const scope: DiffCommentScope = {
	workspaceRootPath: "/tmp/helmor-workspace",
	path: "/tmp/helmor-workspace/src/App.tsx",
	originalRef: "origin/main",
	modifiedRef: null,
};

const summary: FileReviewSummary = {
	plainLanguageSummary: "The file now summarizes review changes.",
	beforeAfter: [],
	userFeatureImpact: ["Reviewers can reopen the summary later."],
	technicalChanges: [],
	riskNotes: [],
	layers: [],
	sequence: [],
	markdown: null,
	mermaid: null,
	html: null,
};

describe("review summary cache", () => {
	beforeEach(() => {
		installLocalStorageMock();
		window.localStorage.clear();
	});

	it("persists summaries by diff scope and prompt", () => {
		saveFileReviewSummaryCache({
			scope,
			prompt: "Summarize for reviewers",
			summary,
		});

		expect(
			loadFileReviewSummaryCache(scope, "Summarize for reviewers"),
		).toEqual(summary);
		expect(loadFileReviewSummaryCache(scope, "Different prompt")).toBeNull();
	});

	it("drops expired summaries", () => {
		const key = getFileReviewSummaryCacheKey(scope, "Summarize for reviewers");
		window.localStorage.setItem(
			key,
			JSON.stringify({
				version: 1,
				createdAt: "2026-04-01T00:00:00.000Z",
				expiresAt: Date.now() - 1000,
				summary,
			}),
		);

		expect(
			loadFileReviewSummaryCache(scope, "Summarize for reviewers"),
		).toBeNull();
		expect(window.localStorage.getItem(key)).toBeNull();
	});
});

function installLocalStorageMock() {
	const store = new Map<string, string>();
	const storage: Storage = {
		get length() {
			return store.size;
		},
		clear() {
			store.clear();
		},
		getItem(key: string) {
			return store.get(key) ?? null;
		},
		key(index: number) {
			return [...store.keys()][index] ?? null;
		},
		removeItem(key: string) {
			store.delete(key);
		},
		setItem(key: string, value: string) {
			store.set(key, value);
		},
	};

	Object.defineProperty(window, "localStorage", {
		configurable: true,
		value: storage,
	});
}
