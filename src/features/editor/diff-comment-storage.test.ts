import { beforeEach, describe, expect, it } from "vitest";
import {
	countDiffCommentsByPath,
	type DiffComment,
	type DiffCommentScope,
	loadAllDiffCommentsForPaths,
	saveDiffComments,
} from "./diff-comment-storage";

const scope: DiffCommentScope = {
	workspaceRootPath: "/tmp/helmor-workspace",
	path: "/tmp/helmor-workspace/src/App.tsx",
	originalRef: null,
	modifiedRef: null,
};

const comments: DiffComment[] = [
	{
		id: "comment-1",
		side: "modified",
		lineNumber: 10,
		body: "Regular note",
		createdAt: "2026-04-29T00:00:00.000Z",
		replies: [],
	},
	{
		id: "comment-2",
		blocking: true,
		side: "modified",
		lineNumber: 12,
		body: "Blocking note",
		createdAt: "2026-04-29T00:00:01.000Z",
		replies: [],
	},
];

describe("diff comment storage", () => {
	beforeEach(() => {
		installLocalStorageMock();
	});

	it("counts and loads blocking comments separately from regular comments", () => {
		saveDiffComments(scope, comments);
		const paths = [{ path: "src/App.tsx", absolutePath: scope.path }];

		expect(
			countDiffCommentsByPath({
				workspaceRootPath: scope.workspaceRootPath,
				paths,
			}),
		).toEqual({ "src/App.tsx": 2 });
		expect(
			countDiffCommentsByPath({
				workspaceRootPath: scope.workspaceRootPath,
				paths,
				onlyBlocking: true,
			}),
		).toEqual({ "src/App.tsx": 1 });
		expect(
			loadAllDiffCommentsForPaths({
				workspaceRootPath: scope.workspaceRootPath,
				paths,
				onlyBlocking: true,
			})[0]?.comments.map((comment) => comment.body),
		).toEqual(["Blocking note"]);
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
