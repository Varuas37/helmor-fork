import { beforeEach, describe, expect, it } from "vitest";
import {
	type DiffCommentScope,
	loadDiffComments,
} from "@/features/editor/diff-comment-storage";
import type { InspectorFileItem } from "@/lib/editor-session";
import { applyReviewAgentCommentsToStorage } from "./comment-actions";

describe("review agent comment actions", () => {
	beforeEach(() => {
		installLocalStorageMock();
	});

	it("stores review comments under the same absolute scope the diff editor loads", () => {
		const change: InspectorFileItem = {
			path: "src/App.tsx",
			absolutePath: "/repo/src/App.tsx",
			name: "App.tsx",
			status: "M",
			insertions: 2,
			deletions: 1,
			committedStatus: "M",
		};

		const result = applyReviewAgentCommentsToStorage({
			workspaceRootPath: "/repo",
			targetBranch: "origin/main",
			changes: [change],
			comments: [
				{
					filePath: "src/App.tsx",
					side: "modified",
					lineNumber: 12,
					severity: "blocking",
					body: "This needs to be fixed before merging.",
				},
			],
		});

		const relativeScope: DiffCommentScope = {
			workspaceRootPath: "/repo",
			path: "src/App.tsx",
			originalRef: "origin/main",
			modifiedRef: "HEAD",
		};
		const editorScope: DiffCommentScope = {
			...relativeScope,
			path: "/repo/src/App.tsx",
		};

		expect(result).toEqual({ applied: 1, skipped: 0 });
		expect(loadDiffComments(editorScope)).toMatchObject([
			{
				author: "review-agent",
				authorName: "Review agent",
				blocking: true,
				side: "modified",
				lineNumber: 12,
				body: "**Blocking**: This needs to be fixed before merging.",
			},
		]);
		expect(loadDiffComments(relativeScope)).toEqual([]);
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
