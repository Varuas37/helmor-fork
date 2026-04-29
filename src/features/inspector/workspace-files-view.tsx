import { useQuery } from "@tanstack/react-query";
import {
	ChevronRight,
	ExternalLink,
	FileText,
	Folder,
	FolderOpen,
	Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { type EditorFileReadResponse, readEditorFile } from "@/lib/api";
import type { InspectorFileItem } from "@/lib/editor-session";
import { workspaceFilesQueryOptions } from "@/lib/query-client";
import { cn } from "@/lib/utils";

type WorkspaceFilesViewProps = {
	active: boolean;
	workspaceRootPath?: string | null;
	activeEditorPath?: string | null;
	onOpenWorkspaceFile?: (path: string) => void;
};

type FileTreeNode = {
	id: string;
	name: string;
	type: "directory" | "file";
	file?: InspectorFileItem;
	children: FileTreeNode[];
};

type VisibleTreeNode = {
	node: FileTreeNode;
	depth: number;
};

const EMPTY_FILES: InspectorFileItem[] = [];

export function WorkspaceFilesView({
	active,
	workspaceRootPath,
	activeEditorPath,
	onOpenWorkspaceFile,
}: WorkspaceFilesViewProps) {
	const query = useQuery({
		...workspaceFilesQueryOptions(workspaceRootPath ?? "__missing__"),
		enabled: active && !!workspaceRootPath,
	});
	const files = query.data ?? EMPTY_FILES;
	const [filter, setFilter] = useState("");
	const [expandedDirs, setExpandedDirs] = useState<Set<string>>(
		() => new Set(),
	);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const didSeedDefaultExpansionRef = useRef(false);

	useEffect(() => {
		setFilter("");
		setExpandedDirs(new Set());
		setSelectedPath(null);
		didSeedDefaultExpansionRef.current = false;
	}, [workspaceRootPath]);

	useEffect(() => {
		if (!active || files.length === 0 || selectedPath) return;
		setSelectedPath(files[0]?.absolutePath ?? null);
	}, [active, files, selectedPath]);

	useEffect(() => {
		if (files.length === 0 || didSeedDefaultExpansionRef.current) return;
		didSeedDefaultExpansionRef.current = true;
		setExpandedDirs(defaultExpandedDirs(files));
	}, [files]);

	const selectedFile = useMemo(
		() => files.find((file) => file.absolutePath === selectedPath) ?? null,
		[files, selectedPath],
	);

	useEffect(() => {
		if (!selectedFile) return;
		setExpandedDirs((current) => {
			const next = new Set(current);
			for (const ancestor of directoryAncestors(selectedFile.path)) {
				next.add(ancestor);
			}
			return next;
		});
	}, [selectedFile]);

	const trimmedFilter = filter.trim().toLowerCase();
	const filteredFiles = useMemo(() => {
		if (!trimmedFilter) return files;
		return files.filter((file) =>
			file.path.toLowerCase().includes(trimmedFilter),
		);
	}, [files, trimmedFilter]);

	const treeNodes = useMemo(
		() => buildFileTree(filteredFiles),
		[filteredFiles],
	);
	const visibleNodes = useMemo(
		() =>
			trimmedFilter
				? filteredFiles.map((file) => ({
						node: {
							id: file.absolutePath,
							name: file.path,
							type: "file" as const,
							file,
							children: [],
						},
						depth: 0,
					}))
				: flattenTree(treeNodes, expandedDirs),
		[expandedDirs, filteredFiles, treeNodes, trimmedFilter],
	);

	const toggleDirectory = useCallback((dirId: string) => {
		setExpandedDirs((current) => {
			const next = new Set(current);
			if (next.has(dirId)) {
				next.delete(dirId);
			} else {
				next.add(dirId);
			}
			return next;
		});
	}, []);

	return (
		<section
			aria-label="Workspace files"
			className="flex h-full min-h-0 flex-col bg-sidebar"
		>
			<div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/60 bg-muted/25 px-3">
				<div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
					<FileText className="size-3.5 shrink-0" strokeWidth={1.8} />
					<span className="truncate">Files</span>
				</div>
				<span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
					{files.length}
				</span>
			</div>

			<div className="flex min-h-0 flex-1 flex-col">
				<div className="shrink-0 border-b border-border/50 p-2">
					<label className="flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-background/55 px-2 text-muted-foreground focus-within:border-border">
						<Search className="size-3.5 shrink-0" strokeWidth={1.8} />
						<input
							value={filter}
							onChange={(event) => setFilter(event.target.value)}
							placeholder="Search files"
							className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/70"
						/>
					</label>
				</div>

				<div className="grid min-h-0 flex-1 grid-rows-[minmax(120px,38%)_1fr]">
					<div
						aria-label="Workspace file tree"
						className="min-h-0 overflow-auto border-b border-border/60 py-1"
					>
						{!workspaceRootPath ? (
							<FileTreeEmpty label="No workspace" />
						) : query.isLoading ? (
							<FileTreeEmpty label="Loading files" />
						) : query.isError ? (
							<FileTreeEmpty label="Unable to load files" />
						) : visibleNodes.length === 0 ? (
							<FileTreeEmpty label="No files" />
						) : (
							<ul className="space-y-0.5 px-1">
								{visibleNodes.map(({ node, depth }) => (
									<FileTreeRow
										key={node.id}
										node={node}
										depth={depth}
										expanded={expandedDirs.has(node.id)}
										selectedPath={selectedPath}
										activeEditorPath={activeEditorPath}
										onToggleDirectory={toggleDirectory}
										onSelectFile={setSelectedPath}
									/>
								))}
							</ul>
						)}
					</div>

					<FilePreview
						file={selectedFile}
						active={active}
						onOpenWorkspaceFile={onOpenWorkspaceFile}
					/>
				</div>
			</div>
		</section>
	);
}

function FileTreeRow({
	node,
	depth,
	expanded,
	selectedPath,
	activeEditorPath,
	onToggleDirectory,
	onSelectFile,
}: {
	node: FileTreeNode;
	depth: number;
	expanded: boolean;
	selectedPath: string | null;
	activeEditorPath?: string | null;
	onToggleDirectory: (dirId: string) => void;
	onSelectFile: (path: string) => void;
}) {
	const isDirectory = node.type === "directory";
	const isSelected = node.file?.absolutePath === selectedPath;
	const isActiveEditor = node.file?.absolutePath === activeEditorPath;
	const Icon = isDirectory ? (expanded ? FolderOpen : Folder) : FileText;

	return (
		<li>
			<button
				type="button"
				className={cn(
					"flex h-6 w-full cursor-pointer items-center gap-1.5 rounded-[4px] pr-2 text-left text-[12px] leading-none text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground",
					isSelected && "bg-accent/75 text-foreground",
				)}
				style={{ paddingLeft: `${Math.min(depth * 14 + 6, 70)}px` }}
				onClick={() => {
					if (isDirectory) {
						onToggleDirectory(node.id);
						return;
					}
					if (node.file) onSelectFile(node.file.absolutePath);
				}}
				aria-label={isDirectory ? node.name : `Open ${node.name}`}
			>
				{isDirectory ? (
					<ChevronRight
						className={cn(
							"size-3 shrink-0 transition-transform",
							expanded && "rotate-90",
						)}
						strokeWidth={1.8}
					/>
				) : (
					<span className="w-3 shrink-0" />
				)}
				<Icon className="size-3.5 shrink-0" strokeWidth={1.7} />
				<span className="min-w-0 flex-1 truncate">{node.name}</span>
				{isActiveEditor ? (
					<span className="size-1.5 shrink-0 rounded-full bg-foreground/70" />
				) : null}
			</button>
		</li>
	);
}

function FileTreeEmpty({ label }: { label: string }) {
	return (
		<div className="flex h-full min-h-[96px] items-center justify-center px-4 text-center text-[12px] text-muted-foreground">
			{label}
		</div>
	);
}

function FilePreview({
	file,
	active,
	onOpenWorkspaceFile,
}: {
	file: InspectorFileItem | null;
	active: boolean;
	onOpenWorkspaceFile?: (path: string) => void;
}) {
	const editorHostRef = useRef<HTMLDivElement>(null);
	const controllerRef = useRef<{
		dispose(): void;
		switchFile(path: string, content?: string): boolean;
	} | null>(null);
	const disposePreviewController = useCallback(() => {
		controllerRef.current?.dispose();
		controllerRef.current = null;
	}, []);
	const [readState, setReadState] = useState<
		| { kind: "idle" }
		| { kind: "loading"; path: string }
		| { kind: "ready"; path: string }
		| { kind: "error"; path: string; message: string }
	>({ kind: "idle" });

	useEffect(() => {
		if (!active || !file) {
			disposePreviewController();
			setReadState({ kind: "idle" });
			return;
		}

		let cancelled = false;
		const filePath = file.absolutePath;
		setReadState({ kind: "loading", path: filePath });

		async function loadFile() {
			try {
				const response = await readEditorFile(filePath);
				if (cancelled) return;
				await renderPreview(filePath, response);
				if (!cancelled) {
					setReadState({ kind: "ready", path: filePath });
				}
			} catch (error) {
				if (cancelled) return;
				setReadState({
					kind: "error",
					path: filePath,
					message: error instanceof Error ? error.message : String(error),
				});
			}
		}

		async function renderPreview(
			path: string,
			response: EditorFileReadResponse,
		) {
			const host = editorHostRef.current;
			if (!host) return;

			if (!controllerRef.current) {
				const runtime = await import("@/lib/monaco-runtime");
				if (cancelled || !editorHostRef.current) return;
				const controller = await runtime.createFileEditor({
					container: editorHostRef.current,
					path,
					content: response.content,
					readOnly: true,
					compact: true,
				});
				if (cancelled) {
					controller.dispose();
					return;
				}
				controllerRef.current = controller;
				return;
			}

			controllerRef.current.switchFile(path, response.content);
		}

		void loadFile();

		return () => {
			cancelled = true;
		};
	}, [active, disposePreviewController, file]);

	useEffect(() => {
		return () => {
			disposePreviewController();
		};
	}, [disposePreviewController]);

	if (!file) {
		return <FilePreviewEmpty label="Select a file" />;
	}

	const isLoading =
		readState.kind === "loading" && readState.path === file.absolutePath;
	const error =
		readState.kind === "error" && readState.path === file.absolutePath
			? readState.message
			: null;

	return (
		<div className="flex min-h-0 flex-col">
			<div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/50 bg-background/35 px-3">
				<span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
					{file.path}
				</span>
				{onOpenWorkspaceFile ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								aria-label="Open in editor"
								variant="ghost"
								size="icon-xs"
								className="shrink-0 text-muted-foreground hover:text-foreground"
								onClick={() => onOpenWorkspaceFile(file.absolutePath)}
							>
								<ExternalLink className="size-3.5" strokeWidth={1.8} />
							</Button>
						</TooltipTrigger>
						<TooltipContent
							side="bottom"
							className="flex h-[24px] items-center rounded-md px-2 text-[12px] leading-none"
						>
							Open in editor
						</TooltipContent>
					</Tooltip>
				) : null}
			</div>
			<div className="relative min-h-0 flex-1 bg-background">
				<div
					ref={editorHostRef}
					aria-label="Workspace file preview"
					className={cn("h-full min-h-0", (isLoading || error) && "opacity-40")}
				/>
				{isLoading ? <FilePreviewOverlay label="Loading file" /> : null}
				{error ? <FilePreviewOverlay label="Unable to open file" /> : null}
			</div>
		</div>
	);
}

function FilePreviewEmpty({ label }: { label: string }) {
	return (
		<div className="flex min-h-0 flex-col">
			<div className="h-8 shrink-0 border-b border-border/50 bg-background/35" />
			<div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-[12px] text-muted-foreground">
				{label}
			</div>
		</div>
	);
}

function FilePreviewOverlay({ label }: { label: string }) {
	return (
		<div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/55 text-[12px] text-muted-foreground">
			{label}
		</div>
	);
}

function buildFileTree(files: InspectorFileItem[]): FileTreeNode[] {
	const root: FileTreeNode = {
		id: "",
		name: "",
		type: "directory",
		children: [],
	};
	const directoryByPath = new Map<string, FileTreeNode>([["", root]]);

	for (const file of files) {
		const parts = file.path.split("/").filter(Boolean);
		let current = root;
		let currentPath = "";

		parts.forEach((part, index) => {
			const isFile = index === parts.length - 1;
			currentPath = currentPath ? `${currentPath}/${part}` : part;

			if (isFile) {
				current.children.push({
					id: file.absolutePath,
					name: part,
					type: "file",
					file,
					children: [],
				});
				return;
			}

			let directory = directoryByPath.get(currentPath);
			if (!directory) {
				directory = {
					id: currentPath,
					name: part,
					type: "directory",
					children: [],
				};
				directoryByPath.set(currentPath, directory);
				current.children.push(directory);
			}
			current = directory;
		});
	}

	sortTree(root.children);
	return root.children;
}

function sortTree(nodes: FileTreeNode[]) {
	nodes.sort((left, right) => {
		if (left.type !== right.type) {
			return left.type === "directory" ? -1 : 1;
		}
		return left.name.localeCompare(right.name);
	});

	for (const node of nodes) {
		sortTree(node.children);
	}
}

function flattenTree(
	nodes: FileTreeNode[],
	expandedDirs: Set<string>,
	depth = 0,
): VisibleTreeNode[] {
	const flattened: VisibleTreeNode[] = [];

	for (const node of nodes) {
		flattened.push({ node, depth });
		if (node.type === "directory" && expandedDirs.has(node.id)) {
			flattened.push(...flattenTree(node.children, expandedDirs, depth + 1));
		}
	}

	return flattened;
}

function defaultExpandedDirs(files: InspectorFileItem[]) {
	const expanded = new Set<string>();
	for (const file of files) {
		const firstSegment = file.path.split("/").filter(Boolean)[0];
		if (firstSegment && file.path.includes("/")) {
			expanded.add(firstSegment);
		}
	}
	return expanded;
}

function directoryAncestors(path: string) {
	const parts = path.split("/").filter(Boolean);
	const ancestors: string[] = [];
	let current = "";

	for (let index = 0; index < parts.length - 1; index += 1) {
		current = current ? `${current}/${parts[index]}` : parts[index];
		ancestors.push(current);
	}

	return ancestors;
}
