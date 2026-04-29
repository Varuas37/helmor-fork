import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "@/components/ui/popover";
import type { ComposerPreviewPayload } from "@/lib/composer-insert";
import { cn } from "@/lib/utils";
import {
	PreviewErrorFrame,
	PreviewLoadingFrame,
	renderInlineBadgePreview,
} from "./preview-renderers";

export type { ComposerPreviewPayload } from "@/lib/composer-insert";
export { createFilePreviewLoader } from "./preview-loader";
export {
	PreviewErrorFrame,
	PreviewLoadingFrame,
} from "./preview-renderers";

type LoaderState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "ready"; payload: ComposerPreviewPayload }
	| { status: "error" };

const HOVER_PREVIEW_CLOSE_DELAY_MS = 100;
const PREVIEW_POPOVER_WIDTH_CLASS = "w-[min(720px,calc(100vw-2rem))]";

export type InlineBadgeProps = {
	/** Leading icon. Callers should use `size-3.5` (14px) to match the 14px label. */
	icon: React.ReactNode;
	/** Label text, truncated at 200px. */
	label: string;
	/** Sync preview payload. Pass `null` (default) for no preview. */
	preview?: ComposerPreviewPayload | null;
	/**
	 * Async preview loader. Called on first hover; result cached per-badge.
	 * Ignored when `preview` is also provided. Reject to show an error frame.
	 * Callers should memoize the loader reference (e.g. via `useMemo`).
	 */
	previewLoader?: () => Promise<ComposerPreviewPayload>;
	/** Optional remove action — when set, a trailing X button is rendered. */
	onRemove?: () => void;
	removeLabel?: string;
	/** Extra classes on the outer wrapper. */
	className?: string;
	/** Extra classes on the label span. */
	labelClassName?: string;
	/**
	 * If true (default), applies `select-none cursor-default` — correct for
	 * non-editable decorator nodes inside Lexical. Bubble / inline contexts
	 * should pass `false` so users can select and copy the label.
	 */
	nonSelectable?: boolean;
};

/**
 * Unified inline badge/chip. Replaces `ComposerPreviewBadge`,
 * `FileBadgeInline`, and `ImagePreviewBadge`.
 *
 * Styling uses pure baseline alignment — internal text baseline lines up
 * naturally with surrounding text regardless of font/size. See fix commits
 * where `align-middle` + `items-center` geometry was replaced with
 * `items-baseline` + icon `self-center`.
 */
export function InlineBadge({
	icon,
	label,
	preview = null,
	previewLoader,
	onRemove,
	removeLabel = "Remove item",
	className,
	labelClassName,
	nonSelectable = true,
}: InlineBadgeProps) {
	const [open, setOpen] = useState(false);
	const [loaderState, setLoaderState] = useState<LoaderState>({
		status: "idle",
	});
	const closeTimerRef = useRef<number | null>(null);
	const hasFetchedRef = useRef(false);

	const syncPreviewContent = useMemo(
		() => renderInlineBadgePreview(preview ?? null),
		[preview],
	);
	const hasSyncPreview = syncPreviewContent !== null;
	const hasAsyncPreview = !preview && typeof previewLoader === "function";
	const canPreview = hasSyncPreview || hasAsyncPreview;

	const popoverContent = useMemo(() => {
		if (hasSyncPreview) return syncPreviewContent;
		if (!hasAsyncPreview) return null;
		switch (loaderState.status) {
			case "loading":
				return <PreviewLoadingFrame title={label} />;
			case "ready":
				return renderInlineBadgePreview(loaderState.payload);
			case "error":
				return <PreviewErrorFrame title={label} />;
			default:
				return <PreviewLoadingFrame title={label} />;
		}
	}, [hasSyncPreview, syncPreviewContent, hasAsyncPreview, loaderState, label]);

	const clearCloseTimer = useCallback(() => {
		if (closeTimerRef.current !== null) {
			window.clearTimeout(closeTimerRef.current);
			closeTimerRef.current = null;
		}
	}, []);

	const ensureAsyncPreview = useCallback(() => {
		if (!hasAsyncPreview || !previewLoader || hasFetchedRef.current) return;
		hasFetchedRef.current = true;
		setLoaderState({ status: "loading" });
		previewLoader()
			.then((payload) => setLoaderState({ status: "ready", payload }))
			.catch(() => setLoaderState({ status: "error" }));
	}, [hasAsyncPreview, previewLoader]);

	const openPreview = useCallback(() => {
		if (!canPreview) return;
		clearCloseTimer();
		ensureAsyncPreview();
		setOpen(true);
	}, [canPreview, clearCloseTimer, ensureAsyncPreview]);

	const scheduleClose = useCallback(() => {
		if (!canPreview) return;
		clearCloseTimer();
		closeTimerRef.current = window.setTimeout(() => {
			setOpen(false);
			closeTimerRef.current = null;
		}, HOVER_PREVIEW_CLOSE_DELAY_MS);
	}, [canPreview, clearCloseTimer]);

	useEffect(() => clearCloseTimer, [clearCloseTimer]);

	const badge = (
		<span
			className={cn(
				"mx-0.5 inline-flex items-baseline rounded-sm border border-border/60 text-[14px] leading-none transition-colors hover:border-muted-foreground/40 hover:bg-accent/40",
				nonSelectable && "cursor-default select-none",
				canPreview && "cursor-pointer",
				className,
			)}
			onPointerEnter={openPreview}
			onPointerLeave={scheduleClose}
		>
			<span
				className={cn(
					"inline-flex min-w-0 items-baseline gap-1.5 py-[3px] pl-2",
					onRemove ? "pr-1" : "pr-2",
				)}
			>
				<span className="inline-flex self-center">{icon}</span>
				<span
					className={cn(
						"max-w-[200px] truncate text-muted-foreground",
						labelClassName,
					)}
				>
					{label}
				</span>
			</span>
			{onRemove ? (
				<button
					type="button"
					aria-label={removeLabel}
					className="mr-1 inline-flex size-4 shrink-0 cursor-pointer items-center justify-center self-center rounded-sm text-muted-foreground/40 transition-colors hover:text-muted-foreground"
					onMouseDown={(event) => {
						event.preventDefault();
						event.stopPropagation();
					}}
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onRemove();
					}}
				>
					<X className="size-3" strokeWidth={1.8} />
				</button>
			) : null}
		</span>
	);

	if (!canPreview) {
		return badge;
	}

	return (
		<Popover open={open}>
			<PopoverAnchor asChild>{badge}</PopoverAnchor>
			<PopoverContent
				side="top"
				align="start"
				sideOffset={10}
				onOpenAutoFocus={(event) => event.preventDefault()}
				onCloseAutoFocus={(event) => event.preventDefault()}
				onPointerEnter={openPreview}
				onPointerLeave={scheduleClose}
				className={cn(
					PREVIEW_POPOVER_WIDTH_CLASS,
					"max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0",
				)}
			>
				{popoverContent}
			</PopoverContent>
		</Popover>
	);
}
