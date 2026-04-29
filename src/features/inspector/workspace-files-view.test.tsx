import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, SettingsContext } from "@/lib/settings";
import { renderWithProviders } from "@/test/render-with-providers";
import { WorkspaceFilesView } from "./workspace-files-view";

const apiMocks = vi.hoisted(() => ({
	listWorkspaceFiles: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();

	return {
		...actual,
		listWorkspaceFiles: apiMocks.listWorkspaceFiles,
	};
});

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

		apiMocks.listWorkspaceFiles.mockImplementation(
			async (workspaceRoot: string) =>
				workspaceRoot === "/tmp/other" ? OTHER_FILES : FILES,
		);
	});

	afterEach(() => {
		cleanup();
	});

	it("loads workspace files without mounting an embedded preview", async () => {
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

		expect(
			screen.queryByLabelText("Workspace file preview"),
		).not.toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Open App.tsx" }));

		expect(onOpenWorkspaceFile).toHaveBeenCalledWith(
			"/tmp/workspace/src/App.tsx",
		);
	});

	it("uses material icons only when the file icon pack setting is enabled", async () => {
		const defaultView = renderWithProviders(
			<WorkspaceFilesView
				active
				workspaceRootPath="/tmp/workspace"
				activeEditorPath={null}
			/>,
		);

		await screen.findByRole("button", { name: "Open package.json" });
		expect(defaultView.container.querySelector("img")).toBeNull();

		cleanup();

		const materialView = renderWithProviders(
			<SettingsContext.Provider
				value={{
					settings: { ...DEFAULT_SETTINGS, fileIconPack: "material" },
					isLoaded: true,
					updateSettings: vi.fn(),
				}}
			>
				<WorkspaceFilesView
					active
					workspaceRootPath="/tmp/workspace"
					activeEditorPath={null}
				/>
			</SettingsContext.Provider>,
		);

		await screen.findByRole("button", { name: "Open package.json" });
		expect(materialView.container.querySelector("img")).not.toBeNull();
	});

	it("opens a file in the main editor when the row is selected", async () => {
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
		await user.click(screen.getByRole("button", { name: "Open package.json" }));

		expect(onOpenWorkspaceFile).toHaveBeenCalledWith(
			"/tmp/workspace/package.json",
		);
	});

	it("keeps the whole sidebar as a file tree across workspace changes", async () => {
		const view = renderWithProviders(
			<WorkspaceFilesView
				active
				workspaceRootPath="/tmp/workspace"
				activeEditorPath={null}
			/>,
		);

		await screen.findByRole("button", { name: "Open package.json" });

		view.rerender(
			<WorkspaceFilesView
				active
				workspaceRootPath="/tmp/other"
				activeEditorPath={null}
			/>,
		);

		await screen.findByRole("button", { name: "Open README.md" });
		expect(
			screen.queryByLabelText("Workspace file preview"),
		).not.toBeInTheDocument();
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
