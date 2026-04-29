import { ExternalLink, X } from "lucide-react";
import {
	type MutableRefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { TrafficLightSpacer } from "@/components/chrome/traffic-light-spacer";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { ShortcutDisplay } from "@/features/shortcuts/shortcut-display";
import type { EditorSessionState } from "@/lib/editor-session";
import type {
	DiffLineAnchor,
	DiffLineTarget,
	EditorChangeHunk,
} from "@/lib/monaco-runtime";
import { useSettings } from "@/lib/settings";
import { describeUnknownError } from "@/lib/workspace-helpers";
import { startDiffCommentAiReply } from "./diff-comment-agent";
import { containsHelmorMention } from "./diff-comment-ai";
import {
	createDiffCommentId,
	type DiffComment,
	type DiffCommentScope,
	getDiffCommentStorageKey,
	loadDiffComments,
	saveDiffComments,
	sortDiffComments,
} from "./diff-comment-storage";
import { type DiffCommentComposer, getDiffLineKey } from "./diff-comment-types";
import {
	addDiffCommentReply,
	deleteDiffCommentReply,
	findDiffComment,
	findDiffCommentReply,
	hasDiffCommentOnLine,
	updateDiffCommentBody,
	updateDiffCommentReply,
} from "./diff-comment-updates";
import { DiffCommentLayer } from "./diff-comments";

type WorkspaceEditorSurfaceProps = {
	editorSession: EditorSessionState;
	workspaceId?: string | null;
	workspaceRootPath?: string | null;
	onChangeSession: (session: EditorSessionState) => void;
	onOpenExternalFile?: (path: string) => void;
	externalEditorName?: string | null;
	onExit: () => void;
	onError?: (description: string, title?: string) => void;
};

type SurfaceStatus =
	| { kind: "loading" }
	| { kind: "ready" }
	| { kind: "error"; message: string };

type MonacoRuntimeModule = typeof import("@/lib/monaco-runtime");
type FileController = Awaited<
	ReturnType<MonacoRuntimeModule["createFileEditor"]>
>;
type DiffController = Awaited<
	ReturnType<MonacoRuntimeModule["createDiffEditor"]>
>;

export function WorkspaceEditorSurface({
	editorSession,
	workspaceId,
	workspaceRootPath,
	onChangeSession,
	onOpenExternalFile,
	externalEditorName,
	onExit,
	onError,
}: WorkspaceEditorSurfaceProps) {
	const { settings } = useSettings();
	const editorHostRef = useRef<HTMLDivElement>(null);
	const fileControllerRef = useRef<FileController | null>(null);
	const diffControllerRef = useRef<DiffController | null>(null);
	const changeSubscriptionRef = useRef<{ dispose(): void } | null>(null);
	const latestSessionRef = useRef(editorSession);
	const onChangeSessionRef = useRef(onChangeSession);
	const onErrorRef = useRef(onError);
	const applyValueRef = useRef(false);
	const buildRequestIdRef = useRef(0);
	const diffCommentTargetsRef = useRef<DiffLineTarget[]>([]);
	const diffCommentScopeRef = useRef<DiffCommentScope | null>(null);
	const diffCommentsRef = useRef<DiffComment[]>([]);
	const [surfaceStatus, setSurfaceStatus] = useState<SurfaceStatus>({
		kind: "ready",
	});
	const [fileControllerVersion, setFileControllerVersion] = useState(0);
	const [diffControllerVersion, setDiffControllerVersion] = useState(0);
	const [diffComments, setDiffComments] = useState<DiffComment[]>([]);
	const [diffCommentComposer, setDiffCommentComposer] =
		useState<DiffCommentComposer | null>(null);
	const [diffCommentAnchors, setDiffCommentAnchors] = useState<
		Record<string, DiffLineAnchor>
	>({});
	latestSessionRef.current = editorSession;
	onChangeSessionRef.current = onChangeSession;
	onErrorRef.current = onError;
	diffCommentsRef.current = diffComments;

	const canRenderFile =
		editorSession.kind === "file" &&
		editorSession.originalText !== undefined &&
		editorSession.modifiedText !== undefined;
	const canRenderDiff =
		editorSession.kind === "diff" &&
		editorSession.originalText !== undefined &&
		editorSession.modifiedText !== undefined;
	const closeLabel =
		editorSession.kind === "diff" ? "Close diff view" : "Close editor view";
	const openExternalLabel = externalEditorName
		? `Open file in ${externalEditorName}`
		: "Open file in external editor";
	const diffCommentScope = useMemo<DiffCommentScope | null>(() => {
		if (editorSession.kind !== "diff") {
			return null;
		}

		return {
			workspaceRootPath,
			path: editorSession.path,
			originalRef: editorSession.originalRef ?? null,
			modifiedRef: editorSession.modifiedRef ?? null,
		};
	}, [
		editorSession.kind,
		editorSession.modifiedRef,
		editorSession.originalRef,
		editorSession.path,
		workspaceRootPath,
	]);

	const updateDiffCommentAnchors = useCallback(() => {
		const controller = diffControllerRef.current;
		const latestSession = latestSessionRef.current;

		if (!controller || latestSession.kind !== "diff") {
			setDiffCommentAnchors({});
			return;
		}

		const nextAnchors: Record<string, DiffLineAnchor> = {};
		for (const target of diffCommentTargetsRef.current) {
			const anchor = controller.getLineAnchor(target);
			if (anchor) {
				nextAnchors[getDiffLineKey(target)] = anchor;
			}
		}
		setDiffCommentAnchors(nextAnchors);
	}, []);

	const applyDiffCommentUpdate = useCallback(
		(
			scope: DiffCommentScope,
			updater: (comments: DiffComment[]) => DiffComment[],
		) => {
			const scopeKey = getDiffCommentStorageKey(scope);
			const visibleScope = diffCommentScopeRef.current;
			const isVisibleScope =
				visibleScope !== null &&
				getDiffCommentStorageKey(visibleScope) === scopeKey;
			const baseComments = isVisibleScope
				? diffCommentsRef.current
				: loadDiffComments(scope);
			const sortedComments = sortDiffComments(updater(baseComments));
			saveDiffComments(scope, sortedComments);

			if (isVisibleScope) {
				diffCommentsRef.current = sortedComments;
				setDiffComments(sortedComments);
			}

			return sortedComments;
		},
		[],
	);

	const invokeHelmorFromComment = useCallback(
		(scope: DiffCommentScope, thread: DiffComment, sourceBody: string) => {
			void startDiffCommentAiReply({
				scope,
				thread,
				target: {
					side: thread.side,
					lineNumber: thread.lineNumber,
				},
				sourceBody,
				path: latestSessionRef.current.path,
				workspaceId,
				workspaceRootPath,
				originalRef:
					latestSessionRef.current.kind === "diff"
						? (latestSessionRef.current.originalRef ?? null)
						: null,
				modifiedRef:
					latestSessionRef.current.kind === "diff"
						? (latestSessionRef.current.modifiedRef ?? null)
						: null,
				originalText:
					latestSessionRef.current.kind === "diff"
						? latestSessionRef.current.originalText
						: undefined,
				modifiedText:
					latestSessionRef.current.kind === "diff"
						? latestSessionRef.current.modifiedText
						: undefined,
				settings,
				applyUpdate: applyDiffCommentUpdate,
			});
		},
		[applyDiffCommentUpdate, settings, workspaceId, workspaceRootPath],
	);

	const handleSaveDiffComment = useCallback(() => {
		if (!diffCommentComposer || !diffCommentScope) {
			return;
		}

		const body = diffCommentComposer.body.trim();
		if (!body) {
			return;
		}

		const now = new Date().toISOString();
		let targetThread: DiffComment | null = null;
		let shouldInvokeHelmor = false;

		const nextComments = applyDiffCommentUpdate(
			diffCommentScope,
			(comments) => {
				if (diffCommentComposer.kind === "new") {
					const comment: DiffComment = {
						id: createDiffCommentId(),
						side: diffCommentComposer.side,
						lineNumber: diffCommentComposer.lineNumber,
						body,
						createdAt: now,
						replies: [],
					};
					targetThread = comment;
					shouldInvokeHelmor = containsHelmorMention(body);
					return [...comments, comment];
				}

				if (diffCommentComposer.kind === "reply") {
					const reply = {
						id: createDiffCommentId(),
						author: "user" as const,
						body,
						createdAt: now,
					};
					const next = addDiffCommentReply(
						comments,
						diffCommentComposer.commentId,
						reply,
					);
					targetThread = findDiffComment(next, diffCommentComposer.commentId);
					shouldInvokeHelmor = containsHelmorMention(body);
					return next;
				}

				if (diffCommentComposer.kind === "edit-comment") {
					const existing = findDiffComment(
						comments,
						diffCommentComposer.commentId,
					);
					shouldInvokeHelmor =
						containsHelmorMention(body) &&
						!containsHelmorMention(existing?.body ?? "");
					const next = updateDiffCommentBody(
						comments,
						diffCommentComposer.commentId,
						body,
						now,
					);
					targetThread = findDiffComment(next, diffCommentComposer.commentId);
					return next;
				}

				const existingComment = findDiffComment(
					comments,
					diffCommentComposer.commentId,
				);
				const existingReply =
					existingComment && diffCommentComposer.kind === "edit-reply"
						? findDiffCommentReply(existingComment, diffCommentComposer.replyId)
						: null;
				shouldInvokeHelmor =
					containsHelmorMention(body) &&
					!containsHelmorMention(existingReply?.body ?? "");
				const next = updateDiffCommentReply(
					comments,
					diffCommentComposer.commentId,
					diffCommentComposer.replyId,
					{ body, updatedAt: now },
				);
				targetThread = findDiffComment(next, diffCommentComposer.commentId);
				return next;
			},
		);

		setDiffCommentComposer(null);
		window.requestAnimationFrame(updateDiffCommentAnchors);

		if (shouldInvokeHelmor && targetThread) {
			invokeHelmorFromComment(diffCommentScope, targetThread, body);
			return;
		}

		diffCommentsRef.current = nextComments;
	}, [
		applyDiffCommentUpdate,
		diffCommentComposer,
		diffCommentScope,
		invokeHelmorFromComment,
		updateDiffCommentAnchors,
	]);

	const handleDeleteDiffComment = useCallback(
		(id: string) => {
			if (!diffCommentScope) {
				return;
			}
			applyDiffCommentUpdate(diffCommentScope, (comments) =>
				comments.filter((comment) => comment.id !== id),
			);
		},
		[applyDiffCommentUpdate, diffCommentScope],
	);

	const handleDeleteDiffCommentReply = useCallback(
		(commentId: string, replyId: string) => {
			if (!diffCommentScope) {
				return;
			}
			applyDiffCommentUpdate(diffCommentScope, (comments) =>
				deleteDiffCommentReply(comments, commentId, replyId),
			);
		},
		[applyDiffCommentUpdate, diffCommentScope],
	);

	useEffect(() => {
		if (
			(editorSession.kind === "file" && canRenderFile) ||
			(editorSession.kind === "diff" && canRenderDiff)
		) {
			return;
		}

		let cancelled = false;

		void (async () => {
			try {
				const api = await import("@/lib/api");
				const isDiff = editorSession.kind === "diff";
				const status = editorSession.fileStatus ?? "M";
				const origRef = editorSession.originalRef ?? "HEAD";

				// Fetch original side (from git ref)
				const originalPromise =
					isDiff && status !== "A" && workspaceRootPath
						? api.readFileAtRef(workspaceRootPath, editorSession.path, origRef)
						: Promise.resolve(null);

				// Fetch modified side (from disk or git ref)
				const modifiedPromise = editorSession.modifiedRef
					? workspaceRootPath
						? api.readFileAtRef(
								workspaceRootPath,
								editorSession.path,
								editorSession.modifiedRef,
							)
						: Promise.resolve(null)
					: status !== "D"
						? api.readEditorFile(editorSession.path).then((r) => r.content)
						: Promise.resolve(null);

				const [original, modified] = await Promise.all([
					originalPromise,
					modifiedPromise,
				]);

				if (cancelled) {
					return;
				}

				onChangeSessionRef.current({
					...editorSession,
					originalText:
						editorSession.originalText ??
						(isDiff ? (original ?? "") : (modified ?? "")),
					modifiedText: editorSession.modifiedText ?? modified ?? "",
					dirty: Boolean(editorSession.dirty),
				});
			} catch (error) {
				if (cancelled) {
					return;
				}

				const message = describeUnknownError(
					error,
					"Unable to load the selected file.",
				);
				setSurfaceStatus({ kind: "error", message });
				onErrorRef.current?.(message, "File open failed");
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [canRenderDiff, canRenderFile, editorSession, workspaceRootPath]);

	useEffect(() => {
		if (!diffCommentScope) {
			setDiffComments([]);
			diffCommentsRef.current = [];
			diffCommentScopeRef.current = null;
			setDiffCommentComposer(null);
			setDiffCommentAnchors({});
			return;
		}

		const loadedComments = loadDiffComments(diffCommentScope);
		diffCommentScopeRef.current = diffCommentScope;
		diffCommentsRef.current = loadedComments;
		setDiffComments(loadedComments);
		setDiffCommentComposer(null);
		setDiffCommentAnchors({});
	}, [diffCommentScope]);

	useEffect(() => {
		const targets = new Map<string, DiffLineTarget>();
		for (const comment of diffComments) {
			targets.set(getDiffLineKey(comment), {
				side: comment.side,
				lineNumber: comment.lineNumber,
			});
		}
		if (diffCommentComposer) {
			targets.set(getDiffLineKey(diffCommentComposer), {
				side: diffCommentComposer.side,
				lineNumber: diffCommentComposer.lineNumber,
			});
		}
		diffCommentTargetsRef.current = [...targets.values()];
		updateDiffCommentAnchors();
	}, [diffCommentComposer, diffComments, updateDiffCommentAnchors]);

	useEffect(() => {
		if (editorSession.kind !== "diff" || !diffControllerRef.current) {
			return;
		}

		const controller = diffControllerRef.current;
		const clickSubscription = controller.onDidClickDiffLine((target) => {
			controller.revealLine(target);
			if (hasDiffCommentOnLine(diffCommentsRef.current, target)) {
				window.requestAnimationFrame(updateDiffCommentAnchors);
				return;
			}
			setDiffCommentComposer({
				...target,
				kind: "new",
				body: "",
			});
			window.requestAnimationFrame(updateDiffCommentAnchors);
		});
		const viewportSubscription = controller.onDidChangeDiffViewport(
			updateDiffCommentAnchors,
		);
		updateDiffCommentAnchors();

		return () => {
			clickSubscription.dispose();
			viewportSubscription.dispose();
		};
	}, [diffControllerVersion, editorSession.kind, updateDiffCommentAnchors]);

	// Dispose editors on unmount (separate from the switching effect so the
	// fast-path can skip cleanup without leaking on unmount).
	useEffect(() => {
		return () => {
			disposeControllers({
				fileControllerRef,
				diffControllerRef,
				changeSubscriptionRef,
			});
		};
	}, []);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			onExit();
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [onExit]);

	// useLayoutEffect: run model swap BEFORE browser paint to avoid flicker.
	// The fast path returns NO cleanup — we keep the editor instance alive across
	// path changes. Only the slow path (first creation / kind change) disposes.
	useLayoutEffect(() => {
		const host = editorHostRef.current;
		if (!host) {
			return;
		}

		// ── Fast path: reuse existing file editor on path change ──
		// Runs even when content isn't loaded yet — switchFile uses Monaco model cache.
		if (editorSession.kind === "file" && fileControllerRef.current) {
			const content = editorSession.modifiedText ?? editorSession.originalText;
			const switched = fileControllerRef.current.switchFile(
				editorSession.path,
				content,
				editorSession.line,
				editorSession.column,
			);

			if (switched) {
				setFileControllerVersion((version) => version + 1);
				// Sync parent state from cached model when content wasn't in state yet
				if (content === undefined) {
					const cachedContent = fileControllerRef.current.getValue();
					onChangeSessionRef.current({
						...latestSessionRef.current,
						originalText: cachedContent,
						modifiedText: cachedContent,
						dirty: false,
					});
				}

				changeSubscriptionRef.current?.dispose();
				changeSubscriptionRef.current = null;
				changeSubscriptionRef.current =
					fileControllerRef.current.onDidChangeModelContent((value) => {
						if (applyValueRef.current) {
							return;
						}
						const latest = latestSessionRef.current;
						const nextDirty = value !== (latest.originalText ?? "");
						if (
							value === latest.modifiedText &&
							nextDirty === Boolean(latest.dirty)
						) {
							return;
						}
						onChangeSessionRef.current({
							...latest,
							kind: "file",
							modifiedText: value,
							dirty: nextDirty,
						});
					});
			}

			// No cleanup — editor stays alive. Unmount cleanup handles disposal.
			return;
		}

		// ── Guard: need content for initial editor creation ──
		if (!canRenderFile && !canRenderDiff) {
			return;
		}

		// ── Slow path: first render or kind change ──
		const requestId = buildRequestIdRef.current + 1;
		buildRequestIdRef.current = requestId;
		let disposed = false;

		disposeControllers({
			fileControllerRef,
			diffControllerRef,
			changeSubscriptionRef,
		});
		host.replaceChildren();

		if (editorSession.kind === "file") {
			void (async () => {
				try {
					const { createFileEditor } = await import("@/lib/monaco-runtime");
					const controller = await createFileEditor({
						container: host,
						path: editorSession.path,
						content:
							editorSession.modifiedText ?? editorSession.originalText ?? "",
						workspaceRootPath,
						line: editorSession.line,
						column: editorSession.column,
					});

					if (disposed || requestId !== buildRequestIdRef.current) {
						controller.dispose();
						return;
					}

					fileControllerRef.current = controller;
					setFileControllerVersion((version) => version + 1);
					changeSubscriptionRef.current = controller.onDidChangeModelContent(
						(value) => {
							if (applyValueRef.current) {
								return;
							}
							const latest = latestSessionRef.current;
							const nextDirty = value !== (latest.originalText ?? "");
							if (
								value === latest.modifiedText &&
								nextDirty === Boolean(latest.dirty)
							) {
								return;
							}
							onChangeSessionRef.current({
								...latest,
								kind: "file",
								modifiedText: value,
								dirty: nextDirty,
							});
						},
					);
					setSurfaceStatus({ kind: "ready" });
				} catch (error) {
					const message = describeUnknownError(
						error,
						"Unable to start the editor.",
					);
					setSurfaceStatus({ kind: "error", message });
					onErrorRef.current?.(message, "Editor startup failed");
				}
			})();
		} else {
			void (async () => {
				try {
					const { createDiffEditor } = await import("@/lib/monaco-runtime");
					const controller = await createDiffEditor({
						container: host,
						path: editorSession.path,
						originalText: editorSession.originalText ?? "",
						modifiedText: editorSession.modifiedText ?? "",
						inline: Boolean(editorSession.inline),
						workspaceRootPath,
					});

					if (disposed || requestId !== buildRequestIdRef.current) {
						controller.dispose();
						return;
					}

					diffControllerRef.current = controller;
					setDiffControllerVersion((version) => version + 1);
					setSurfaceStatus({ kind: "ready" });
				} catch (error) {
					const message = describeUnknownError(
						error,
						"Unable to start the review surface.",
					);
					setSurfaceStatus({ kind: "error", message });
					onErrorRef.current?.(message, "Review surface failed");
				}
			})();
		}

		return () => {
			// Only guard against stale async completions — do NOT dispose the
			// editor here.  The slow path's entry block already calls
			// disposeControllers before creating a new editor (handles kind
			// changes), and the separate unmount effect handles final cleanup.
			disposed = true;
		};
	}, [canRenderDiff, canRenderFile, editorSession.kind, editorSession.path]);

	useEffect(() => {
		if (
			editorSession.kind !== "file" ||
			!fileControllerRef.current ||
			editorSession.modifiedText === undefined
		) {
			return;
		}

		applyValueRef.current = true;
		try {
			fileControllerRef.current.setValue(editorSession.modifiedText);
		} finally {
			applyValueRef.current = false;
		}
	}, [editorSession.kind, editorSession.modifiedText]);

	useEffect(() => {
		if (editorSession.kind !== "file" || !fileControllerRef.current) {
			return;
		}

		fileControllerRef.current.revealPosition(
			editorSession.line,
			editorSession.column,
		);
	}, [editorSession.column, editorSession.kind, editorSession.line]);

	useEffect(() => {
		if (editorSession.kind !== "file") {
			fileControllerRef.current?.setChangeHunks([]);
			return;
		}

		const controller = fileControllerRef.current;
		if (!controller) {
			return;
		}

		if (
			!settings.mainlineDiffEnabled ||
			!workspaceRootPath ||
			!editorSession.path
		) {
			controller.setChangeHunks([]);
			return;
		}

		let cancelled = false;
		const baseRef = settings.mainlineDiffBaseRef.trim() || "origin/HEAD";
		controller.setChangeHunks([]);

		void (async () => {
			try {
				const api = await import("@/lib/api");
				const response = await api.getEditorFileChangeHunks(
					workspaceRootPath,
					editorSession.path,
					baseRef,
				);
				if (cancelled || fileControllerRef.current !== controller) {
					return;
				}
				const hunks: EditorChangeHunk[] = response.hunks;
				controller.setChangeHunks(hunks);
			} catch (error) {
				if (cancelled) {
					return;
				}
				controller.setChangeHunks([]);
				onErrorRef.current?.(
					describeUnknownError(error, "Unable to load file change highlights."),
					"Change highlights unavailable",
				);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [
		editorSession.kind,
		editorSession.path,
		fileControllerVersion,
		settings.mainlineDiffBaseRef,
		settings.mainlineDiffEnabled,
		workspaceRootPath,
	]);

	useEffect(() => {
		if (
			editorSession.kind !== "diff" ||
			!diffControllerRef.current ||
			editorSession.originalText === undefined ||
			editorSession.modifiedText === undefined
		) {
			return;
		}

		diffControllerRef.current.setTexts({
			originalText: editorSession.originalText,
			modifiedText: editorSession.modifiedText,
			inline: Boolean(editorSession.inline),
		});
		window.requestAnimationFrame(updateDiffCommentAnchors);
	}, [
		editorSession.inline,
		editorSession.kind,
		editorSession.modifiedText,
		editorSession.originalText,
		updateDiffCommentAnchors,
	]);

	return (
		<section
			aria-label="Workspace editor surface"
			data-focus-scope="editor"
			className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
		>
			<div
				className="flex h-9 items-center border-b border-border"
				data-tauri-drag-region
			>
				{/* Traffic-light inset. macOS: left; Windows / Linux: right. */}
				<TrafficLightSpacer side="left" width={86} />

				<div className="min-w-0 flex-1" data-tauri-drag-region />

				<div className="flex shrink-0 items-center pr-2">
					{editorSession.kind === "file" && onOpenExternalFile ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									onClick={() => onOpenExternalFile(editorSession.path)}
									aria-label={openExternalLabel}
									className="text-muted-foreground hover:text-foreground"
								>
									<ExternalLink className="size-3.5" strokeWidth={1.8} />
								</Button>
							</TooltipTrigger>
							<TooltipContent
								side="bottom"
								sideOffset={4}
								className="flex h-[24px] items-center rounded-md px-2 text-[12px] leading-none"
							>
								{openExternalLabel}
							</TooltipContent>
						</Tooltip>
					) : null}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={onExit}
						aria-label={closeLabel}
						className="gap-1.5 px-2 text-muted-foreground hover:text-foreground"
					>
						<ShortcutDisplay hotkey="Escape" />
						<X className="size-3.5" strokeWidth={1.8} />
					</Button>
				</div>
			</div>

			<div className="relative flex min-h-0 flex-1 bg-background">
				<div
					ref={editorHostRef}
					aria-label="Editor canvas"
					className="h-full min-h-0 flex-1"
				/>

				{surfaceStatus.kind === "error" && (
					<div className="absolute inset-0 flex items-center justify-center bg-background">
						<SurfaceMessage message={surfaceStatus.message} />
					</div>
				)}
				{editorSession.kind === "diff" && (
					<DiffCommentLayer
						comments={diffComments}
						composer={diffCommentComposer}
						anchors={diffCommentAnchors}
						onCancelComposer={() => setDiffCommentComposer(null)}
						onChangeComposer={(body) =>
							setDiffCommentComposer((current) =>
								current ? { ...current, body } : current,
							)
						}
						onDeleteComment={handleDeleteDiffComment}
						onDeleteReply={handleDeleteDiffCommentReply}
						onEditComment={(comment) =>
							setDiffCommentComposer({
								side: comment.side,
								lineNumber: comment.lineNumber,
								kind: "edit-comment",
								commentId: comment.id,
								body: comment.body,
							})
						}
						onEditReply={(comment, reply) =>
							setDiffCommentComposer({
								side: comment.side,
								lineNumber: comment.lineNumber,
								kind: "edit-reply",
								commentId: comment.id,
								replyId: reply.id,
								body: reply.body,
							})
						}
						onReply={(comment) =>
							setDiffCommentComposer({
								side: comment.side,
								lineNumber: comment.lineNumber,
								kind: "reply",
								commentId: comment.id,
								body: "",
							})
						}
						onSubmitComposer={handleSaveDiffComment}
					/>
				)}
			</div>
		</section>
	);
}

function SurfaceMessage({ message }: { message: string }) {
	return (
		<p className="text-[13px] leading-5 text-muted-foreground">{message}</p>
	);
}

function disposeControllers({
	fileControllerRef,
	diffControllerRef,
	changeSubscriptionRef,
}: {
	fileControllerRef: MutableRefObject<FileController | null>;
	diffControllerRef: MutableRefObject<DiffController | null>;
	changeSubscriptionRef: MutableRefObject<{ dispose(): void } | null>;
}) {
	changeSubscriptionRef.current?.dispose();
	changeSubscriptionRef.current = null;
	fileControllerRef.current?.dispose();
	fileControllerRef.current = null;
	diffControllerRef.current?.dispose();
	diffControllerRef.current = null;
}
