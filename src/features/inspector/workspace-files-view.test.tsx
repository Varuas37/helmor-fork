import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render-with-providers";
import { WorkspaceFilesView } from "./workspace-files-view";

const apiMocks = vi.hoisted(() => ({
	listWorkspaceFiles: vi.fn(),
	readEditorFile: vi.fn(),
}));

const runtimeMocks = vi.hoisted(() => ({
	createFileEditor: vi.fn(),
	switchFile: vi.fn(),
	dispose: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();

	return {
		...actual,
		listWorkspaceFiles: apiMocks.listWorkspaceFiles,
		readEditorFile: apiMocks.readEditorFile,
	};
});

vi.mock("@/lib/monaco-runtime", () => ({
	createFileEditor: runtimeMocks.createFileEditor,
}));

const FILES = [
	{
		path: "package.json",
		absolutePath: "/tmp/workspace/package.json",
		name: "package.json",
		status: "M" as const,
		insertions: 0,
		deletions: 0,
	},
	{
		path: "src/App.tsx",
		absolutePath: "/tmp/workspace/src/App.tsx",
		name: "App.tsx",
		status: "M" as const,
		insertions: 0,
		deletions: 0,
	},
];

const OTHER_FILES = [
	{
		path: "README.md",
		absolutePath: "/tmp/other/README.md",
		name: "README.md",
		status: "M" as const,
		insertions: 0,
		deletions: 0,
	},
];

describe("WorkspaceFilesView", () => {
	beforeEach(() => {
		apiMocks.listWorkspaceFiles.mockReset();
		apiMocks.readEditorFile.mockReset();
		runtimeMocks.createFileEditor.mockReset();
		runtimeMocks.switchFile.mockReset();
		runtimeMocks.dispose.mockReset();

		apiMocks.listWorkspaceFiles.mockImplementation(
			async (workspaceRoot: string) =>
				workspaceRoot === "/tmp/other" ? OTHER_FILES : FILES,
		);
		apiMocks.readEditorFile.mockImplementation(async (path: string) => ({
			path,
			content: path.endsWith("App.tsx")
				? "export function App() { return null; }\n"
				: path.endsWith("README.md")
					? "# Other\n"
					: '{ "name": "helmor" }\n',
			mtimeMs: 1,
		}));
		runtimeMocks.createFileEditor.mockResolvedValue({
			dispose: runtimeMocks.dispose,
			switchFile: runtimeMocks.switchFile,
		});
	});

	afterEach(() => {
		cleanup();
	});

	it("loads workspace files and previews the selected file", async () => {
		const user = userEvent.setup();

		renderWithProviders(
			<WorkspaceFilesView
				active
				workspaceRootPath="/tmp/workspace"
				activeEditorPath={null}
			/>,
		);

		await screen.findByRole("button", { name: "Open package.json" });

		await waitFor(() => {
			expect(runtimeMocks.createFileEditor).toHaveBeenCalledWith(
				expect.objectContaining({
					path: "/tmp/workspace/package.json",
					content: '{ "name": "helmor" }\n',
					readOnly: true,
					compact: true,
				}),
			);
		});

		await user.click(screen.getByRole("button", { name: "Open App.tsx" }));

		await waitFor(() => {
			expect(apiMocks.readEditorFile).toHaveBeenCalledWith(
				"/tmp/workspace/src/App.tsx",
			);
			expect(runtimeMocks.switchFile).toHaveBeenCalledWith(
				"/tmp/workspace/src/App.tsx",
				"export function App() { return null; }\n",
			);
		});
	});

	it("opens the selected file in the full editor", async () => {
		const user = userEvent.setup();
		const onOpenWorkspaceFile = vi.fn();

		renderWithProviders(
			<WorkspaceFilesView
				active
				workspaceRootPath="/tmp/workspace"
				activeEditorPath={null}
				onOpenWorkspaceFile={onOpenWorkspaceFile}
			/>,
		);

		await screen.findByRole("button", { name: "Open package.json" });
		await user.click(screen.getByRole("button", { name: "Open in editor" }));

		expect(onOpenWorkspaceFile).toHaveBeenCalledWith(
			"/tmp/workspace/package.json",
		);
	});

	it("recreates the preview editor after workspace changes clear the selection", async () => {
		const view = renderWithProviders(
			<WorkspaceFilesView
				active
				workspaceRootPath="/tmp/workspace"
				activeEditorPath={null}
			/>,
		);

		await waitFor(() => {
			expect(runtimeMocks.createFileEditor).toHaveBeenCalledWith(
				expect.objectContaining({ path: "/tmp/workspace/package.json" }),
			);
		});

		view.rerender(
			<WorkspaceFilesView
				active
				workspaceRootPath="/tmp/other"
				activeEditorPath={null}
			/>,
		);

		await waitFor(() => {
			expect(runtimeMocks.dispose).toHaveBeenCalled();
			expect(runtimeMocks.createFileEditor).toHaveBeenCalledWith(
				expect.objectContaining({ path: "/tmp/other/README.md" }),
			);
		});
	});

	it("keeps the tree fully collapsed after the last directory is collapsed", async () => {
		const user = userEvent.setup();

		renderWithProviders(
			<WorkspaceFilesView
				active
				workspaceRootPath="/tmp/workspace"
				activeEditorPath={null}
			/>,
		);

		await screen.findByRole("button", { name: "Open App.tsx" });
		await user.click(screen.getByRole("button", { name: "src" }));

		expect(
			screen.queryByRole("button", { name: "Open App.tsx" }),
		).not.toBeInTheDocument();
	});
});
