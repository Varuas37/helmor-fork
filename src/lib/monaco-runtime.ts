import "monaco-editor/min/vs/editor/editor.main.css";
import "monaco-editor/esm/vs/language/typescript/monaco.contribution.js";
import type * as Monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

type MonacoModule = typeof Monaco;
type StandaloneEditor = Monaco.editor.IStandaloneCodeEditor;
type StandaloneDiffEditor = Monaco.editor.IStandaloneDiffEditor;
type TextModel = Monaco.editor.ITextModel;
type TypeScriptLanguageServiceDefaults = {
	setCompilerOptions(options: Record<string, unknown>): void;
	setDiagnosticsOptions(options: Record<string, unknown>): void;
	setEagerModelSync(value: boolean): void;
};
type TypeScriptLanguageContribution = {
	JsxEmit: { ReactJSX: number };
	ModuleKind: { ESNext: number };
	ScriptTarget: { ESNext: number };
	javascriptDefaults: TypeScriptLanguageServiceDefaults;
	typescriptDefaults: TypeScriptLanguageServiceDefaults;
};

export type DiffLineSide = "original" | "modified";

export type DiffLineTarget = {
	side: DiffLineSide;
	lineNumber: number;
};

export type DiffLineAnchor = DiffLineTarget & {
	top: number;
	left: number;
	right: number;
	lineHeight: number;
	visible: boolean;
};

export type EditorChangeHunk = {
	newStart: number;
	newLines: number;
	oldStart: number;
	oldLines: number;
	oldText?: string;
};

type MonacoRuntime = {
	monaco: MonacoModule;
};

type DisposableLike = {
	dispose(): void;
};

type FileEditorController = {
	editor: StandaloneEditor;
	dispose(): void;
	getValue(): string;
	setValue(value: string): void;
	setChangeHunks(hunks: ReadonlyArray<EditorChangeHunk>): void;
	revealPosition(line?: number, column?: number): void;
	onDidChangeModelContent(callback: (value: string) => void): DisposableLike;
	/** Swap the active model. Returns false if no cached model and no content provided. */
	switchFile(
		path: string,
		content?: string,
		line?: number,
		column?: number,
	): boolean;
};

type DiffEditorController = {
	editor: StandaloneDiffEditor;
	dispose(): void;
	getLineAnchor(target: DiffLineTarget): DiffLineAnchor | null;
	onDidChangeDiffViewport(callback: () => void): DisposableLike;
	onDidClickDiffLine(
		callback: (target: DiffLineTarget) => void,
	): DisposableLike;
	revealLine(target: DiffLineTarget): void;
	setTexts(options: {
		originalText: string;
		modifiedText: string;
		inline: boolean;
	}): void;
};

let runtimePromise: Promise<MonacoRuntime> | null = null;

/** Content cache for pre-fetched files — avoids IPC on first switch. */
const fileContentCache = new Map<string, string>();
const TYPESCRIPT_BUNDLER_MODULE_RESOLUTION = 100;
const PROJECTLESS_DIAGNOSTIC_CODES_TO_IGNORE = [
	2307, // Cannot find module. Monaco cannot read unopened workspace/node_modules files.
	2792, // Cannot find module under older non-bundler wording.
	7016, // Missing declaration file for third-party modules.
];

let configuredTypeScriptWorkspaceRoot: string | null | undefined;

type EditorTheme = "light" | "dark";

/** Pending theme applied once runtime is ready (or the current one). */
let desiredTheme: EditorTheme = detectInitialTheme();

function detectInitialTheme(): EditorTheme {
	if (typeof document === "undefined") {
		return "dark";
	}
	return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function themeId(theme: EditorTheme): string {
	return theme === "dark" ? "helmor-editor-dark" : "helmor-editor-light";
}

export async function createFileEditor(options: {
	container: HTMLElement;
	path: string;
	content: string;
	workspaceRootPath?: string | null;
	line?: number;
	column?: number;
	readOnly?: boolean;
	compact?: boolean;
}): Promise<FileEditorController> {
	const runtime = await ensureRuntime();
	const { monaco } = runtime;
	configureTypeScriptLanguageService(monaco, options.workspaceRootPath);
	installChangeHighlightStyles();

	const language = resolveLanguageId(monaco, options.path);

	const modelByPath = new Map<string, TextModel>();
	let currentModel = getOrCreateFileModel({
		monaco,
		modelByPath,
		path: options.path,
		content: options.content,
		language,
	});

	// Seed content cache for future switches
	fileContentCache.set(options.path, options.content);

	const editor = monaco.editor.create(options.container, {
		automaticLayout: true,
		bracketPairColorization: { enabled: true },
		domReadOnly: Boolean(options.readOnly),
		fontFamily:
			'"SF Mono","Monaco","Cascadia Mono","Roboto Mono","Menlo",monospace',
		fontLigatures: true,
		fontSize: options.compact ? 12 : 13,
		lineHeight: options.compact ? 19 : 21,
		minimap: { enabled: false },
		model: currentModel,
		overviewRulerLanes: 0,
		padding: options.compact
			? { top: 10, bottom: 18 }
			: { top: 14, bottom: 24 },
		readOnly: Boolean(options.readOnly),
		renderValidationDecorations: "off",
		scrollBeyondLastLine: false,
		smoothScrolling: true,
		tabSize: 2,
		theme: themeId(desiredTheme),
		wordWrap: "on",
	});
	const changeDecorations = editor.createDecorationsCollection();

	revealEditorPosition(editor, options.line, options.column);

	return {
		editor,
		dispose() {
			changeDecorations.clear();
			editor.dispose();
			for (const ownedModel of modelByPath.values()) {
				ownedModel.dispose();
			}
			modelByPath.clear();
		},
		getValue() {
			return currentModel.getValue();
		},
		setValue(value: string) {
			if (currentModel.getValue() === value) {
				return;
			}

			currentModel.setValue(value);
		},
		setChangeHunks(hunks) {
			changeDecorations.set(
				buildChangeHighlightDecorations(monaco, currentModel, hunks),
			);
		},
		revealPosition(line?: number, column?: number) {
			revealEditorPosition(editor, line, column);
		},
		onDidChangeModelContent(callback) {
			return currentModel.onDidChangeContent(() => {
				callback(currentModel.getValue());
			});
		},
		switchFile(path: string, content?: string, line?: number, column?: number) {
			// Resolve content: explicit param → cache → give up
			const resolvedContent = content ?? fileContentCache.get(path);
			if (resolvedContent === undefined) {
				return false;
			}

			const nextLanguage = resolveLanguageId(monaco, path);
			const nextModel = getOrCreateFileModel({
				monaco,
				modelByPath,
				path,
				content: resolvedContent,
				language: nextLanguage,
			});
			if (nextModel !== currentModel) {
				editor.setModel(nextModel);
				currentModel = nextModel;
			}
			changeDecorations.clear();

			// Keep cache fresh for future switches back to this file
			fileContentCache.set(path, resolvedContent);

			revealEditorPosition(editor, line, column);
			return true;
		},
	};
}

export async function createDiffEditor(options: {
	container: HTMLElement;
	path: string;
	originalText: string;
	modifiedText: string;
	inline: boolean;
	workspaceRootPath?: string | null;
}): Promise<DiffEditorController> {
	const runtime = await ensureRuntime();
	const { monaco } = runtime;
	configureTypeScriptLanguageService(monaco, options.workspaceRootPath);
	const language = resolveLanguageId(monaco, options.path);

	const originalUri = monaco.Uri.file(options.path).with({
		query: "helmor-review=original",
	});
	const modifiedUri = monaco.Uri.file(options.path).with({
		query: "helmor-review=modified",
	});
	monaco.editor.getModel(originalUri)?.dispose();
	monaco.editor.getModel(modifiedUri)?.dispose();

	const originalModel = monaco.editor.createModel(
		options.originalText,
		language,
		originalUri,
	);
	const modifiedModel = monaco.editor.createModel(
		options.modifiedText,
		language,
		modifiedUri,
	);

	const editor = monaco.editor.createDiffEditor(options.container, {
		automaticLayout: true,
		enableSplitViewResizing: true,
		fontFamily:
			'"SF Mono","Monaco","Cascadia Mono","Roboto Mono","Menlo",monospace',
		fontLigatures: true,
		fontSize: 13,
		hideUnchangedRegions: {
			enabled: true,
			contextLineCount: 4,
			minimumLineCount: 2,
			revealLineCount: 3,
		},
		lineHeight: 21,
		minimap: { enabled: false },
		originalEditable: false,
		padding: { top: 14, bottom: 24 },
		readOnly: true,
		renderOverviewRuler: false,
		renderValidationDecorations: "off",
		renderSideBySide: !options.inline,
		scrollBeyondLastLine: false,
		smoothScrolling: true,
		theme: themeId(desiredTheme),
	});

	editor.setModel({
		original: originalModel,
		modified: modifiedModel,
	});

	const originalEditor = editor.getOriginalEditor();
	const modifiedEditor = editor.getModifiedEditor();

	return {
		editor,
		dispose() {
			editor.dispose();
			originalModel.dispose();
			modifiedModel.dispose();
		},
		getLineAnchor(target) {
			const sideEditor =
				target.side === "original" ? originalEditor : modifiedEditor;
			return getDiffLineAnchor({
				container: options.container,
				editor: sideEditor,
				lineNumber: target.lineNumber,
				side: target.side,
				monaco,
			});
		},
		onDidChangeDiffViewport(callback) {
			const disposables = [
				originalEditor.onDidScrollChange(callback),
				originalEditor.onDidLayoutChange(callback),
				modifiedEditor.onDidScrollChange(callback),
				modifiedEditor.onDidLayoutChange(callback),
			];

			return {
				dispose() {
					for (const disposable of disposables) {
						disposable.dispose();
					}
				},
			};
		},
		onDidClickDiffLine(callback) {
			const disposables = [
				watchDiffLineClicks({
					editor: originalEditor,
					monaco,
					side: "original",
					callback,
				}),
				watchDiffLineClicks({
					editor: modifiedEditor,
					monaco,
					side: "modified",
					callback,
				}),
			];

			return {
				dispose() {
					for (const disposable of disposables) {
						disposable.dispose();
					}
				},
			};
		},
		revealLine(target) {
			const sideEditor =
				target.side === "original" ? originalEditor : modifiedEditor;
			sideEditor.revealLineInCenterIfOutsideViewport(target.lineNumber);
		},
		setTexts({ originalText, modifiedText, inline }) {
			if (originalModel.getValue() !== originalText) {
				originalModel.setValue(originalText);
			}
			if (modifiedModel.getValue() !== modifiedText) {
				modifiedModel.setValue(modifiedText);
			}
			editor.updateOptions({ renderSideBySide: !inline });
		},
	};
}

function watchDiffLineClicks({
	editor,
	monaco,
	side,
	callback,
}: {
	editor: StandaloneEditor;
	monaco: MonacoModule;
	side: DiffLineSide;
	callback: (target: DiffLineTarget) => void;
}): DisposableLike {
	return editor.onMouseDown((event) => {
		const position = event.target.position;
		if (!position || !isCommentableLineTarget(monaco, event.target.type)) {
			return;
		}

		callback({ side, lineNumber: position.lineNumber });
	});
}

function isCommentableLineTarget(
	monaco: MonacoModule,
	targetType: Monaco.editor.MouseTargetType,
) {
	const mouseTargetType = monaco.editor.MouseTargetType;
	return (
		targetType === mouseTargetType.CONTENT_EMPTY ||
		targetType === mouseTargetType.CONTENT_TEXT ||
		targetType === mouseTargetType.GUTTER_GLYPH_MARGIN ||
		targetType === mouseTargetType.GUTTER_LINE_DECORATIONS ||
		targetType === mouseTargetType.GUTTER_LINE_NUMBERS
	);
}

function getDiffLineAnchor({
	container,
	editor,
	lineNumber,
	side,
	monaco,
}: {
	container: HTMLElement;
	editor: StandaloneEditor;
	lineNumber: number;
	side: DiffLineSide;
	monaco: MonacoModule;
}): DiffLineAnchor | null {
	const model = editor.getModel();
	const editorNode = editor.getDomNode();
	if (
		!model ||
		!editorNode ||
		lineNumber < 1 ||
		lineNumber > model.getLineCount()
	) {
		return null;
	}

	const containerRect = container.getBoundingClientRect();
	const editorRect = editorNode.getBoundingClientRect();
	const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
	const top =
		editorRect.top -
		containerRect.top +
		editor.getTopForLineNumber(lineNumber) -
		editor.getScrollTop();
	const visibleRanges = editor.getVisibleRanges();
	const visible =
		top > -lineHeight &&
		top < containerRect.height + lineHeight &&
		visibleRanges.some(
			(range) =>
				lineNumber >= range.startLineNumber &&
				lineNumber <= range.endLineNumber,
		);

	return {
		side,
		lineNumber,
		top,
		left: Math.max(8, editorRect.left - containerRect.left + 52),
		right: Math.max(8, containerRect.right - editorRect.right + 12),
		lineHeight,
		visible,
	};
}

/** Cache file contents so future switchFile calls resolve instantly (no IPC). */
export function preWarmFileContents(
	files: ReadonlyArray<{ absolutePath: string; content: string }>,
) {
	for (const file of files) {
		fileContentCache.set(file.absolutePath, file.content);
	}
}

export function syncVirtualFile(path: string, content: string) {
	fileContentCache.set(path, content);
}

function getOrCreateFileModel({
	monaco,
	modelByPath,
	path,
	content,
	language,
}: {
	monaco: MonacoModule;
	modelByPath: Map<string, TextModel>;
	path: string;
	content: string;
	language?: string;
}) {
	const cachedModel = modelByPath.get(path);
	if (cachedModel && !cachedModel.isDisposed()) {
		syncModel(monaco, cachedModel, content, language);
		return cachedModel;
	}

	const uri = monaco.Uri.file(path);
	const existingModel = monaco.editor.getModel(uri);
	if (existingModel && !existingModel.isDisposed()) {
		syncModel(monaco, existingModel, content, language);
		modelByPath.set(path, existingModel);
		return existingModel;
	}

	const model = monaco.editor.createModel(content, language, uri);
	modelByPath.set(path, model);
	return model;
}

function syncModel(
	monaco: MonacoModule,
	model: TextModel,
	content: string,
	language?: string,
) {
	if (model.getValue() !== content) {
		model.setValue(content);
	}
	if (language && model.getLanguageId() !== language) {
		monaco.editor.setModelLanguage(model, language);
	}
}

function buildChangeHighlightDecorations(
	monaco: MonacoModule,
	model: TextModel,
	hunks: ReadonlyArray<EditorChangeHunk>,
): Monaco.editor.IModelDeltaDecoration[] {
	const lineCount = model.getLineCount();
	return hunks
		.filter((hunk) => hunk.newLines > 0)
		.map((hunk) => {
			const startLineNumber = Math.max(1, Math.min(lineCount, hunk.newStart));
			const endLineNumber = Math.max(
				startLineNumber,
				Math.min(lineCount, hunk.newStart + hunk.newLines - 1),
			);
			const hoverMessage = hunk.oldText?.trim()
				? [
						{
							value: `Previous:\n\n${indentMarkdownCodeBlock(hunk.oldText)}`,
						},
					]
				: undefined;

			return {
				range: new monaco.Range(
					startLineNumber,
					1,
					endLineNumber,
					model.getLineMaxColumn(endLineNumber),
				),
				options: {
					className: "helmor-editor-change-line",
					hoverMessage,
					isWholeLine: true,
					linesDecorationsClassName: "helmor-editor-change-gutter",
				},
			};
		});
}

function indentMarkdownCodeBlock(value: string): string {
	const trimmed = value.length > 5000 ? `${value.slice(0, 5000)}\n...` : value;
	return trimmed
		.split("\n")
		.map((line) => `    ${line}`)
		.join("\n");
}

function installChangeHighlightStyles() {
	if (typeof document === "undefined") {
		return;
	}
	const id = "helmor-editor-change-highlight-styles";
	if (document.getElementById(id)) {
		return;
	}
	const style = document.createElement("style");
	style.id = id;
	style.textContent = `
.monaco-editor .helmor-editor-change-line {
	background: rgba(35, 134, 54, 0.18);
	border-left: 2px solid rgba(63, 185, 80, 0.9);
}
.monaco-editor .helmor-editor-change-gutter {
	border-left: 2px solid rgba(63, 185, 80, 0.95);
}
`;
	document.head.appendChild(style);
}

function configureTypeScriptLanguageService(
	monaco: MonacoModule,
	workspaceRootPath?: string | null,
) {
	const workspaceRoot = workspaceRootPath ?? null;
	if (configuredTypeScriptWorkspaceRoot === workspaceRoot) {
		return;
	}
	configuredTypeScriptWorkspaceRoot = workspaceRoot;

	const ts = (
		monaco.languages as unknown as {
			typescript?: TypeScriptLanguageContribution;
		}
	).typescript;
	if (!ts) {
		return;
	}

	const compilerOptions: Record<string, unknown> = {
		allowImportingTsExtensions: true,
		allowJs: true,
		allowNonTsExtensions: true,
		allowSyntheticDefaultImports: true,
		checkJs: false,
		esModuleInterop: true,
		isolatedModules: true,
		jsx: ts.JsxEmit.ReactJSX,
		lib: ["ES2022", "DOM", "DOM.Iterable"],
		module: ts.ModuleKind.ESNext,
		moduleResolution: TYPESCRIPT_BUNDLER_MODULE_RESOLUTION,
		noEmit: true,
		resolveJsonModule: true,
		skipLibCheck: true,
		strict: true,
		target: ts.ScriptTarget.ESNext,
		useDefineForClassFields: true,
	};

	if (workspaceRoot) {
		compilerOptions.baseUrl = workspaceRoot;
		compilerOptions.paths = {
			"@/*": ["src/*"],
		};
	}

	const diagnosticsOptions: Record<string, unknown> = {
		noSemanticValidation: true,
		noSuggestionDiagnostics: true,
		noSyntaxValidation: true,
		diagnosticCodesToIgnore: PROJECTLESS_DIAGNOSTIC_CODES_TO_IGNORE,
	};

	ts.typescriptDefaults.setCompilerOptions(compilerOptions);
	ts.javascriptDefaults.setCompilerOptions(compilerOptions);
	ts.typescriptDefaults.setDiagnosticsOptions(diagnosticsOptions);
	ts.javascriptDefaults.setDiagnosticsOptions(diagnosticsOptions);
	ts.typescriptDefaults.setEagerModelSync(true);
	ts.javascriptDefaults.setEagerModelSync(true);
}

async function ensureRuntime(): Promise<MonacoRuntime> {
	if (!runtimePromise) {
		runtimePromise = (async () => {
			const monaco = await import("monaco-editor");

			installMonacoEnvironment();
			installEditorTheme(monaco);
			installThemeObserver(monaco);

			return { monaco };
		})();
	}

	return runtimePromise;
}

// Sync Monaco's theme with the app's `dark` class on <html>. Avoids having
// callers import this module just to push a theme update, which would pull
// Monaco's runtime into the critical path on every theme change.
function installThemeObserver(monaco: MonacoModule) {
	if (
		typeof document === "undefined" ||
		typeof MutationObserver === "undefined"
	) {
		return;
	}
	const syncTheme = () => {
		const nextTheme = detectInitialTheme();
		if (nextTheme === desiredTheme) {
			return;
		}
		desiredTheme = nextTheme;
		monaco.editor.setTheme(themeId(nextTheme));
	};
	const observer = new MutationObserver(syncTheme);
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["class"],
	});
	syncTheme();
}

function installMonacoEnvironment() {
	const target = globalThis as typeof globalThis & {
		MonacoEnvironment?: {
			getWorker: (_moduleId: string, label: string) => Worker;
		};
	};

	if (target.MonacoEnvironment) {
		return;
	}

	target.MonacoEnvironment = {
		getWorker(_moduleId, label) {
			switch (label) {
				case "json":
					return new jsonWorker();
				case "css":
				case "scss":
				case "less":
					return new cssWorker();
				case "html":
				case "handlebars":
				case "razor":
					return new htmlWorker();
				case "typescript":
				case "javascript":
					return new tsWorker();
				default:
					return new editorWorker();
			}
		},
	};
}

function installEditorTheme(monaco: MonacoModule) {
	monaco.editor.defineTheme("helmor-editor-dark", {
		base: "vs-dark",
		inherit: true,
		rules: [
			{ token: "comment", foreground: "868584" },
			{ token: "string", foreground: "c9b18f" },
			{ token: "keyword", foreground: "c5a3a8" },
			{ token: "number", foreground: "c6b48a" },
			{ token: "regexp", foreground: "9ea693" },
			{ token: "type.identifier", foreground: "a9b0c6" },
			{ token: "identifier", foreground: "faf9f6" },
			{ token: "delimiter", foreground: "afaeac" },
		],
		colors: {
			"editor.background": "#161514",
			"editor.foreground": "#FAF9F6",
			"editor.lineHighlightBackground": "#1f1e1d",
			"editor.lineHighlightBorder": "#00000000",
			"editor.selectionBackground": "#353534",
			"editor.inactiveSelectionBackground": "#2a2928",
			"editor.wordHighlightBackground": "#35353488",
			"editor.wordHighlightStrongBackground": "#45454588",
			"editorCursor.foreground": "#FAF9F6",
			"editorWhitespace.foreground": "#595755",
			"editorIndentGuide.background1": "#2b2a29",
			"editorIndentGuide.activeBackground1": "#4b4946",
			"editorLineNumber.foreground": "#868584",
			"editorLineNumber.activeForeground": "#FAF9F6",
			"editorGutter.background": "#161514",
			"editorWidget.background": "#1e1d1c",
			"editorWidget.border": "#343332",
			"editorSuggestWidget.background": "#1e1d1c",
			"editorSuggestWidget.border": "#343332",
			"editorHoverWidget.background": "#1e1d1c",
			"editorHoverWidget.border": "#343332",
			"scrollbarSlider.background": "#faf9f626",
			"scrollbarSlider.hoverBackground": "#faf9f640",
			"scrollbarSlider.activeBackground": "#faf9f655",
			"minimap.background": "#161514",
			"diffEditor.insertedLineBackground": "#2ea04318",
			"diffEditor.insertedTextBackground": "#2ea04340",
			"diffEditor.removedLineBackground": "#da363318",
			"diffEditor.removedTextBackground": "#da363340",
			"diffEditorGutter.insertedLineBackground": "#2ea04326",
			"diffEditorGutter.removedLineBackground": "#da363326",
			"diffEditorOverview.insertedForeground": "#2ea04399",
			"diffEditorOverview.removedForeground": "#da363399",
			"diffEditor.diagonalFill": "#faf9f608",
		},
	});
	monaco.editor.defineTheme("helmor-editor-light", {
		base: "vs",
		inherit: true,
		rules: [
			{ token: "comment", foreground: "7a7775" },
			{ token: "string", foreground: "8a6b3d" },
			{ token: "keyword", foreground: "8a3d51" },
			{ token: "number", foreground: "8a6e2f" },
			{ token: "regexp", foreground: "5a6b3d" },
			{ token: "type.identifier", foreground: "3d4d75" },
			{ token: "identifier", foreground: "1a1918" },
			{ token: "delimiter", foreground: "5a5857" },
		],
		colors: {
			"editor.background": "#FFFFFF",
			"editor.foreground": "#1a1918",
			"editor.lineHighlightBackground": "#f4f3f1",
			"editor.lineHighlightBorder": "#00000000",
			"editor.selectionBackground": "#c9d9ef",
			"editor.inactiveSelectionBackground": "#dde3ec",
			"editor.wordHighlightBackground": "#c9d9ef88",
			"editor.wordHighlightStrongBackground": "#a8c1e288",
			"editorCursor.foreground": "#1a1918",
			"editorWhitespace.foreground": "#c7c5c2",
			"editorIndentGuide.background1": "#eceae6",
			"editorIndentGuide.activeBackground1": "#c7c5c2",
			"editorLineNumber.foreground": "#a4a19d",
			"editorLineNumber.activeForeground": "#1a1918",
			"editorGutter.background": "#FFFFFF",
			"editorWidget.background": "#f8f7f5",
			"editorWidget.border": "#e4e2de",
			"editorSuggestWidget.background": "#f8f7f5",
			"editorSuggestWidget.border": "#e4e2de",
			"editorHoverWidget.background": "#f8f7f5",
			"editorHoverWidget.border": "#e4e2de",
			"scrollbarSlider.background": "#1a191826",
			"scrollbarSlider.hoverBackground": "#1a191840",
			"scrollbarSlider.activeBackground": "#1a191855",
			"minimap.background": "#FFFFFF",
			"diffEditor.insertedLineBackground": "#2ea04318",
			"diffEditor.insertedTextBackground": "#2ea04333",
			"diffEditor.removedLineBackground": "#da363318",
			"diffEditor.removedTextBackground": "#da363333",
			"diffEditorGutter.insertedLineBackground": "#2ea04326",
			"diffEditorGutter.removedLineBackground": "#da363326",
			"diffEditorOverview.insertedForeground": "#2ea04399",
			"diffEditorOverview.removedForeground": "#da363399",
			"diffEditor.diagonalFill": "#1a19180a",
		},
	});
	monaco.editor.setTheme(themeId(desiredTheme));
}

function resolveLanguageId(
	monaco: MonacoModule,
	path: string,
): string | undefined {
	const normalizedPath = path.replace(/\\/g, "/");
	const fileName = normalizedPath.split("/").pop()?.toLowerCase() ?? "";
	const extension = fileName.includes(".")
		? fileName.slice(fileName.lastIndexOf("."))
		: "";

	const explicitMap: Record<string, string> = {
		".cjs": "javascript",
		".css": "css",
		".go": "go",
		".html": "html",
		".java": "java",
		".js": "javascript",
		".json": "json",
		".jsx": "javascript",
		".md": "markdown",
		".mjs": "javascript",
		".py": "python",
		".rs": "rust",
		".scss": "scss",
		".sh": "shell",
		".sql": "sql",
		".toml": "ini",
		".ts": "typescript",
		".tsx": "typescript",
		".txt": "plaintext",
		".yaml": "yaml",
		".yml": "yaml",
	};

	if (fileName === "dockerfile") {
		return "dockerfile";
	}

	if (fileName.endsWith(".test.tsx") || fileName.endsWith(".spec.tsx")) {
		return "typescript";
	}

	if (explicitMap[extension]) {
		return explicitMap[extension];
	}

	return monaco.languages.getLanguages().find((language) => {
		const extensions = language.extensions ?? [];
		const filenames = language.filenames ?? [];
		return extensions.includes(extension) || filenames.includes(fileName);
	})?.id;
}

function revealEditorPosition(
	editor: StandaloneEditor,
	line?: number,
	column?: number,
) {
	if (!line) {
		return;
	}

	const position = {
		lineNumber: Math.max(1, line),
		column: Math.max(1, column ?? 1),
	};
	editor.setPosition(position);
	editor.revealPositionInCenter(position);
	editor.focus();
}
