import { useQuery } from "@tanstack/react-query";
import {
	getMaterialFileIcon,
	getMaterialFolderIcon,
} from "file-extension-icon-js";
import {
	ChevronRight,
	FileText,
	Folder,
	FolderOpen,
	Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InspectorFileItem } from "@/lib/editor-session";
import { workspaceFilesQueryOptions } from "@/lib/query-client";
import { type FileIconPack, useSettings } from "@/lib/settings";
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
	const { settings } = useSettings();
	const query = useQuery({
		...workspaceFilesQueryOptions(workspaceRootPath ?? "__missing__"),
		enabled: active && !!workspaceRootPath,
	});
	const files = query.data ?? EMPTY_FILES;
	const [filter, setFilter] = useState("");
	const [expandedDirs, setExpandedDirs] = useState<Set<string>>(
		() => new Set(),
	);
	const [pendingSelectedPath, setPendingSelectedPath] = useState<string | null>(
		null,
	);
	const fileIconPack = settings.fileIconPack;
	const didSeedDefaultExpansionRef = useRef(false);

	useEffect(() => {
		setFilter("");
		setExpandedDirs(new Set());
		setPendingSelectedPath(null);
		didSeedDefaultExpansionRef.current = false;
	}, [workspaceRootPath]);

	useEffect(() => {
		if (files.length === 0 || didSeedDefaultExpansionRef.current) return;
		didSeedDefaultExpansionRef.current = true;
		setExpandedDirs(defaultExpandedDirs(files));
	}, [files]);

	const selectedPath = activeEditorPath ?? pendingSelectedPath;

	useEffect(() => {
		const selectedFile = files.find(
			(file) => file.absolutePath === selectedPath,
		);
		if (!selectedFile) return;
		setExpandedDirs((current) => {
			const next = new Set(current);
			for (const ancestor of directoryAncestors(selectedFile.path)) {
				next.add(ancestor);
			}
			return next;
		});
	}, [files, selectedPath]);

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
	const selectFile = useCallback(
		(path: string) => {
			setPendingSelectedPath(path);
			onOpenWorkspaceFile?.(path);
		},
		[onOpenWorkspaceFile],
	);

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

				<div
					aria-label="Workspace file tree"
					className="min-h-0 flex-1 overflow-auto py-1"
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
									iconPack={fileIconPack}
									selectedPath={selectedPath}
									onToggleDirectory={toggleDirectory}
									onSelectFile={selectFile}
								/>
							))}
						</ul>
					)}
				</div>
			</div>
		</section>
	);
}

function FileTreeRow({
	node,
	depth,
	expanded,
	iconPack,
	selectedPath,
	onToggleDirectory,
	onSelectFile,
}: {
	node: FileTreeNode;
	depth: number;
	expanded: boolean;
	iconPack: FileIconPack;
	selectedPath: string | null;
	onToggleDirectory: (dirId: string) => void;
	onSelectFile: (path: string) => void;
}) {
	const isDirectory = node.type === "directory";
	const isSelected = node.file?.absolutePath === selectedPath;

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
				<FileTreeIcon node={node} expanded={expanded} iconPack={iconPack} />
				<span className="min-w-0 flex-1 truncate">{node.name}</span>
			</button>
		</li>
	);
}

function FileTreeIcon({
	node,
	expanded,
	iconPack,
}: {
	node: FileTreeNode;
	expanded: boolean;
	iconPack: FileIconPack;
}) {
	if (iconPack === "material") {
		return node.type === "directory" ? (
			<img
				src={getMaterialFolderIcon(node.name, expanded)}
				alt=""
				className="size-4 shrink-0"
			/>
		) : (
			<img
				src={getMaterialFileIcon(node.file?.name ?? node.name)}
				alt=""
				className="size-4 shrink-0"
			/>
		);
	}

	const Icon =
		node.type === "directory" ? (expanded ? FolderOpen : Folder) : FileText;
	return <Icon className="size-3.5 shrink-0" strokeWidth={1.7} />;
}

function FileTreeEmpty({ label }: { label: string }) {
	return (
		<div className="flex h-full min-h-[96px] items-center justify-center px-4 text-center text-[12px] text-muted-foreground">
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
