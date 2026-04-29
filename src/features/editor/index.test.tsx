import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { EditorSessionState } from "@/lib/editor-session";
import type { DiffLineTarget } from "@/lib/monaco-runtime";
import { getDiffCommentStorageKey } from "./diff-comment-storage";

const apiMocks = vi.hoisted(() => ({
	createSession: vi.fn(),
	getEditorFileChangeHunks: vi.fn(),
	hideSession: vi.fn(),
	loadAgentModelSections: vi.fn(),
	readEditorFile: vi.fn(),
	renameSession: vi.fn(),
	startAgentMessageStream: vi.fn(),
}));

const runtimeMocks = vi.hoisted(() => {
	let fileValue = "";
	let changeHandler: ((value: string) => void) | null = null;
	let diffLineClickHandler: ((target: DiffLineTarget) => void) | null = null;
	let diffViewportHandler: (() => void) | null = null;

	const fileController = {
		dispose: vi.fn(),
		getValue: vi.fn(() => fileValue),
		onDidChangeModelContent: vi.fn((callback: (value: string) => void) => {
			changeHandler = callback;
			return { dispose: vi.fn() };
		}),
		revealPosition: vi.fn(),
		setChangeHunks: vi.fn(),
		setValue: vi.fn((value: string) => {
			fileValue = value;
		}),
		switchFile: vi.fn(() => true),
	};

	const diffController = {
		dispose: vi.fn(),
		getLineAnchor: vi.fn((target: DiffLineTarget) => ({
			...target,
			left: target.side === "modified" ? 120 : 40,
			lineHeight: 21,
			right: 24,
			top: target.lineNumber * 21,
			visible: true,
		})),
		onDidChangeDiffViewport: vi.fn((callback: () => void) => {
			diffViewportHandler = callback;
			return {
				dispose: vi.fn(() => {
					if (diffViewportHandler === callback) {
						diffViewportHandler = null;
					}
				}),
			};
		}),
		onDidClickDiffLine: vi.fn((callback: (target: DiffLineTarget) => void) => {
			diffLineClickHandler = callback;
			return {
				dispose: vi.fn(() => {
					if (diffLineClickHandler === callback) {
						diffLineClickHandler = null;
					}
				}),
			};
		}),
		revealLine: vi.fn(),
		setTexts: vi.fn(),
	};

	return {
		createDiffEditor: vi.fn(async () => diffController),
		createFileEditor: vi.fn(
			async (options: { content: string; path: string }) => {
				fileValue = options.content;
				return fileController;
			},
		),
		diffController,
		emitDiffLineClick: (target: DiffLineTarget) => {
			diffLineClickHandler?.(target);
		},
		emitDiffViewportChange: () => {
			diffViewportHandler?.();
		},
		emitFileChange: (value: string) => {
			fileValue = value;
			changeHandler?.(value);
		},
		fileController,
		reset() {
			fileValue = "";
			changeHandler = null;
			this.createDiffEditor.mockClear();
			this.createFileEditor.mockClear();
			this.diffController.dispose.mockClear();
			this.diffController.getLineAnchor.mockClear();
			this.diffController.onDidChangeDiffViewport.mockClear();
			this.diffController.onDidClickDiffLine.mockClear();
			this.diffController.revealLine.mockClear();
			this.diffController.setTexts.mockClear();
			this.fileController.dispose.mockClear();
			this.fileController.getValue.mockClear();
			this.fileController.onDidChangeModelContent.mockClear();
			this.fileController.revealPosition.mockClear();
			this.fileController.setChangeHunks.mockClear();
			this.fileController.setValue.mockClear();
			this.fileController.switchFile.mockClear();
			this.syncVirtualFile.mockClear();
		},
		syncVirtualFile: vi.fn(async () => undefined),
	};
});

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();

	return {
		...actual,
		createSession: apiMocks.createSession,
		getEditorFileChangeHunks: apiMocks.getEditorFileChangeHunks,
		hideSession: apiMocks.hideSession,
		loadAgentModelSections: apiMocks.loadAgentModelSections,
		readEditorFile: apiMocks.readEditorFile,
		renameSession: apiMocks.renameSession,
		startAgentMessageStream: apiMocks.startAgentMessageStream,
	};
});

vi.mock("@/components/streamdown-loader", () => ({
	LazyStreamdown: ({ children }: { children?: ReactNode }) => (
		<div>{children}</div>
	),
	preloadStreamdown: vi.fn(),
}));

vi.mock("@/lib/monaco-runtime", () => ({
	createDiffEditor: runtimeMocks.createDiffEditor,
	createFileEditor: runtimeMocks.createFileEditor,
	syncVirtualFile: runtimeMocks.syncVirtualFile,
}));

import { WorkspaceEditorSurface } from "./index";

function EditorSurfaceHarness({
	initialSession,
	onChangeSpy,
	onError,
}: {
	initialSession: EditorSessionState;
	onChangeSpy: (session: EditorSessionState) => void;
	onError?: (description: string, title?: string) => void;
}) {
	const [session, setSession] = useState(initialSession);

	return (
		<WorkspaceEditorSurface
			editorSession={session}
			workspaceId="workspace-1"
			workspaceRootPath="/tmp/helmor-workspace"
			onChangeSession={(next) => {
				onChangeSpy(next);
				setSession(next);
			}}
			onError={onError}
			onExit={vi.fn()}
		/>
	);
}

describe("WorkspaceEditorSurface", () => {
	beforeEach(() => {
		installLocalStorageMock();
		runtimeMocks.reset();
		apiMocks.createSession.mockReset();
		apiMocks.getEditorFileChangeHunks.mockReset();
		apiMocks.hideSession.mockReset();
		apiMocks.loadAgentModelSections.mockReset();
		apiMocks.readEditorFile.mockReset();
		apiMocks.renameSession.mockReset();
		apiMocks.startAgentMessageStream.mockReset();
		apiMocks.createSession.mockResolvedValue({ sessionId: "session-ai" });
		apiMocks.getEditorFileChangeHunks.mockResolvedValue({
			baseCommit: "base",
			baseRef: "origin/HEAD",
			hunks: [],
			resolvedRef: "origin/main",
		});
		apiMocks.hideSession.mockResolvedValue(undefined);
		apiMocks.renameSession.mockResolvedValue(undefined);
		apiMocks.loadAgentModelSections.mockResolvedValue([
			{
				id: "codex",
				label: "Codex",
				options: [
					{
						id: "gpt-5.4",
						provider: "codex",
						label: "GPT-5.4",
						cliModel: "gpt-5.4",
						effortLevels: ["low", "medium", "high"],
						supportsFastMode: true,
					},
				],
			},
		]);
		apiMocks.startAgentMessageStream.mockImplementation(
			async (_request, callback) => {
				callback({
					kind: "streamingPartial",
					message: {
						role: "assistant",
						content: [
							{
								type: "text",
								id: "answer-part",
								text: "AI **answer**",
							},
						],
						streaming: true,
					},
				});
				callback({
					kind: "done",
					provider: "codex",
					modelId: "gpt-5.4",
					resolvedModel: "gpt-5.4",
					sessionId: null,
					workingDirectory: "/tmp/helmor-workspace",
					persisted: true,
				});
			},
		);
		resetDiffCommentStorage();
	});

	afterEach(() => {
		cleanup();
	});

	it("loads a file and tracks dirty state", async () => {
		const onChangeSpy = vi.fn();

		apiMocks.readEditorFile.mockResolvedValue({
			path: "/tmp/helmor-workspace/src/App.tsx",
			content: "const value = 1;\n",
			mtimeMs: 10,
		});

		render(
			<TooltipProvider delayDuration={0}>
				<EditorSurfaceHarness
					initialSession={{
						kind: "file",
						path: "/tmp/helmor-workspace/src/App.tsx",
					}}
					onChangeSpy={onChangeSpy}
				/>
			</TooltipProvider>,
		);

		await waitFor(() => {
			expect(apiMocks.readEditorFile).toHaveBeenCalledWith(
				"/tmp/helmor-workspace/src/App.tsx",
			);
			expect(runtimeMocks.createFileEditor).toHaveBeenCalled();
		});

		runtimeMocks.emitFileChange("const value = 2;\n");

		await waitFor(() => {
			expect(onChangeSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					dirty: true,
					kind: "file",
					modifiedText: "const value = 2;\n",
				}),
			);
		});
	});

	it("applies mainline change highlights to file editor", async () => {
		const onChangeSpy = vi.fn();
		apiMocks.readEditorFile.mockResolvedValue({
			path: "/tmp/helmor-workspace/src/App.tsx",
			content: "const value = 2;\n",
			mtimeMs: 10,
		});
		apiMocks.getEditorFileChangeHunks.mockResolvedValue({
			baseCommit: "abc123",
			baseRef: "origin/HEAD",
			resolvedRef: "origin/main",
			hunks: [
				{
					newStart: 1,
					newLines: 1,
					oldStart: 1,
					oldLines: 1,
					oldText: "const value = 1;",
				},
			],
		});

		render(
			<TooltipProvider delayDuration={0}>
				<EditorSurfaceHarness
					initialSession={{
						kind: "file",
						path: "/tmp/helmor-workspace/src/App.tsx",
					}}
					onChangeSpy={onChangeSpy}
				/>
			</TooltipProvider>,
		);

		await waitFor(() => {
			expect(apiMocks.getEditorFileChangeHunks).toHaveBeenCalledWith(
				"/tmp/helmor-workspace",
				"/tmp/helmor-workspace/src/App.tsx",
				"origin/HEAD",
			);
			expect(runtimeMocks.fileController.setChangeHunks).toHaveBeenCalledWith([
				expect.objectContaining({
					newLines: 1,
					newStart: 1,
					oldText: "const value = 1;",
				}),
			]);
		});
	});

	it("surfaces read failures without breaking the shell", async () => {
		const onChangeSpy = vi.fn();
		const onError = vi.fn();

		apiMocks.readEditorFile.mockRejectedValue(new Error("No such file"));

		render(
			<TooltipProvider delayDuration={0}>
				<EditorSurfaceHarness
					initialSession={{
						kind: "file",
						path: "/tmp/helmor-workspace/src/missing.ts",
					}}
					onChangeSpy={onChangeSpy}
					onError={onError}
				/>
			</TooltipProvider>,
		);

		await waitFor(() => {
			expect(onError).toHaveBeenCalledWith("No such file", "File open failed");
			expect(
				screen.getByLabelText("Workspace editor surface"),
			).toBeInTheDocument();
			expect(screen.getByLabelText("Editor canvas")).toBeInTheDocument();
			expect(screen.getByText("No such file")).toBeInTheDocument();
		});
	});

	it("adds a persisted comment on a clicked diff line", async () => {
		const user = userEvent.setup();
		const onChangeSpy = vi.fn();

		render(
			<TooltipProvider delayDuration={0}>
				<EditorSurfaceHarness
					initialSession={{
						kind: "diff",
						path: "/tmp/helmor-workspace/src/App.tsx",
						originalText: "const value = 1;\n",
						modifiedText: "const value = 2;\n",
					}}
					onChangeSpy={onChangeSpy}
				/>
			</TooltipProvider>,
		);

		await waitFor(() => {
			expect(runtimeMocks.createDiffEditor).toHaveBeenCalled();
			expect(runtimeMocks.diffController.onDidClickDiffLine).toHaveBeenCalled();
		});

		runtimeMocks.emitDiffLineClick({ side: "modified", lineNumber: 1 });

		const textarea = await screen.findByLabelText("Diff comment");
		await user.type(textarea, "This needs a clearer value.");
		await user.click(screen.getByRole("button", { name: "Save" }));

		expect(screen.getByText("This needs a clearer value.")).toBeInTheDocument();
		expect(screen.getByText("Modified line 1")).toBeInTheDocument();
		expect(
			window.localStorage.getItem(
				getDiffCommentStorageKey({
					workspaceRootPath: "/tmp/helmor-workspace",
					path: "/tmp/helmor-workspace/src/App.tsx",
				}),
			),
		).toContain("This needs a clearer value.");
	});

	it("does not open another composer when an existing comment line is clicked", async () => {
		const user = userEvent.setup();
		const onChangeSpy = vi.fn();

		render(
			<TooltipProvider delayDuration={0}>
				<EditorSurfaceHarness
					initialSession={{
						kind: "diff",
						path: "/tmp/helmor-workspace/src/App.tsx",
						originalText: "const value = 1;\n",
						modifiedText: "const value = 2;\n",
					}}
					onChangeSpy={onChangeSpy}
				/>
			</TooltipProvider>,
		);

		await waitFor(() => {
			expect(runtimeMocks.createDiffEditor).toHaveBeenCalled();
		});

		runtimeMocks.emitDiffLineClick({ side: "modified", lineNumber: 1 });
		await user.type(await screen.findByLabelText("Diff comment"), "Existing");
		await user.click(screen.getByRole("button", { name: "Save" }));

		runtimeMocks.emitDiffLineClick({ side: "modified", lineNumber: 1 });

		expect(screen.queryByLabelText("Diff comment")).not.toBeInTheDocument();
		expect(screen.getByText("Existing")).toBeInTheDocument();
	});

	it("edits comments and replies on a diff thread", async () => {
		const user = userEvent.setup();
		const onChangeSpy = vi.fn();

		render(
			<TooltipProvider delayDuration={0}>
				<EditorSurfaceHarness
					initialSession={{
						kind: "diff",
						path: "/tmp/helmor-workspace/src/App.tsx",
						originalText: "const value = 1;\n",
						modifiedText: "const value = 2;\n",
					}}
					onChangeSpy={onChangeSpy}
				/>
			</TooltipProvider>,
		);

		await waitFor(() => {
			expect(runtimeMocks.createDiffEditor).toHaveBeenCalled();
		});

		runtimeMocks.emitDiffLineClick({ side: "modified", lineNumber: 1 });
		await user.type(await screen.findByLabelText("Diff comment"), "Initial");
		await user.click(screen.getByRole("button", { name: "Save" }));

		await user.click(screen.getByRole("button", { name: "Edit comment" }));
		const editComment = await screen.findByLabelText("Edit diff comment");
		await user.clear(editComment);
		await user.type(editComment, "Edited **markdown**");
		await user.click(screen.getByRole("button", { name: "Save" }));

		expect(screen.getByText("Edited **markdown**")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Reply" }));
		await user.type(
			await screen.findByLabelText("Diff comment"),
			"First reply",
		);
		await user.click(screen.getByRole("button", { name: "Save" }));

		expect(screen.getByText("First reply")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Edit reply" }));
		const editReply = await screen.findByLabelText("Edit diff comment");
		await user.clear(editReply);
		await user.type(editReply, "Edited reply");
		await user.click(screen.getByRole("button", { name: "Save" }));

		expect(screen.getByText("Edited reply")).toBeInTheDocument();
		expect(screen.queryByText("First reply")).not.toBeInTheDocument();
	});

	it("streams a Helmor reply when a comment mentions @helmor", async () => {
		const user = userEvent.setup();
		const onChangeSpy = vi.fn();

		render(
			<TooltipProvider delayDuration={0}>
				<EditorSurfaceHarness
					initialSession={{
						kind: "diff",
						path: "/tmp/helmor-workspace/src/App.tsx",
						originalText: "const value = 1;\n",
						modifiedText: "const value = 2;\n",
					}}
					onChangeSpy={onChangeSpy}
				/>
			</TooltipProvider>,
		);

		await waitFor(() => {
			expect(runtimeMocks.createDiffEditor).toHaveBeenCalled();
		});

		runtimeMocks.emitDiffLineClick({ side: "modified", lineNumber: 1 });
		await user.type(
			await screen.findByLabelText("Diff comment"),
			"@helmor why did this change?",
		);
		await user.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => {
			expect(apiMocks.startAgentMessageStream).toHaveBeenCalled();
			expect(screen.getByText("AI **answer**")).toBeInTheDocument();
		});

		const request = apiMocks.startAgentMessageStream.mock.calls[0][0];
		expect(request).toEqual(
			expect.objectContaining({
				helmorSessionId: "session-ai",
				workingDirectory: "/tmp/helmor-workspace",
			}),
		);
		expect(request.prompt).toContain("Diff comment thread so far:");
		expect(request.prompt).toContain("User question:");
		expect(request.prompt).toContain("why did this change?");
		expect(apiMocks.hideSession).toHaveBeenCalledWith("session-ai");
	});
});

function resetDiffCommentStorage() {
	if (typeof window === "undefined") {
		return;
	}

	const storage = window.localStorage;
	if (typeof storage.key !== "function") {
		return;
	}

	const keys: string[] = [];
	for (let index = 0; index < storage.length; index += 1) {
		const key = storage.key(index);
		if (key?.startsWith("helmor:diff-comments:")) {
			keys.push(key);
		}
	}

	for (const key of keys) {
		storage.removeItem(key);
	}
}

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
