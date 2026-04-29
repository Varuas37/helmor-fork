import {
	CheckIcon,
	MessageSquareIcon,
	MessageSquarePlusIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { DiffLineAnchor, DiffLineTarget } from "@/lib/monaco-runtime";
import type { DiffComment } from "./diff-comment-storage";

export type DiffCommentDraft = DiffLineTarget & {
	body: string;
};

type DiffCommentLayerProps = {
	comments: DiffComment[];
	draft: DiffCommentDraft | null;
	anchors: Record<string, DiffLineAnchor>;
	onCancelDraft: () => void;
	onChangeDraft: (body: string) => void;
	onDeleteComment: (id: string) => void;
	onSaveDraft: () => void;
};

export function getDiffLineKey(target: DiffLineTarget): string {
	return `${target.side}:${target.lineNumber}`;
}

export function DiffCommentLayer({
	comments,
	draft,
	anchors,
	onCancelDraft,
	onChangeDraft,
	onDeleteComment,
	onSaveDraft,
}: DiffCommentLayerProps) {
	const groupedComments = useMemo(
		() => groupCommentsByLine(comments),
		[comments],
	);
	const visibleLines = useMemo(() => {
		const keys = new Set<string>(Object.keys(groupedComments));
		if (draft) {
			keys.add(getDiffLineKey(draft));
		}
		return [...keys];
	}, [draft, groupedComments]);

	if (visibleLines.length === 0) {
		return null;
	}

	return (
		<div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
			{visibleLines.map((lineKey) => {
				const anchor = anchors[lineKey];
				if (!anchor?.visible) {
					return null;
				}

				const lineComments = groupedComments[lineKey] ?? [];
				const draftForLine =
					draft && getDiffLineKey(draft) === lineKey ? draft : null;

				return (
					<div
						key={lineKey}
						className="pointer-events-auto absolute max-w-[42rem]"
						style={{
							left: anchor.left,
							right: anchor.right,
							top: anchor.top + anchor.lineHeight + 3,
						}}
						onClick={(event) => event.stopPropagation()}
						onKeyDown={(event) => event.stopPropagation()}
					>
						<div className="space-y-1.5">
							{lineComments.map((comment) => (
								<SavedDiffComment
									key={comment.id}
									comment={comment}
									onDelete={() => onDeleteComment(comment.id)}
								/>
							))}
							{draftForLine && (
								<DiffCommentDraftForm
									draft={draftForLine}
									onCancel={onCancelDraft}
									onChange={onChangeDraft}
									onSave={onSaveDraft}
								/>
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}

function SavedDiffComment({
	comment,
	onDelete,
}: {
	comment: DiffComment;
	onDelete: () => void;
}) {
	return (
		<div className="rounded-md border border-border/80 bg-popover/95 text-popover-foreground shadow-lg backdrop-blur">
			<div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1 text-[10.5px] text-muted-foreground">
				<MessageSquareIcon className="size-3" strokeWidth={1.8} />
				<span className="min-w-0 flex-1 truncate">
					{formatLineLabel(comment)}
				</span>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					aria-label="Delete comment"
					onClick={onDelete}
					className="size-5 text-muted-foreground hover:text-foreground"
				>
					<Trash2Icon className="size-3" strokeWidth={1.8} />
				</Button>
			</div>
			<p className="whitespace-pre-wrap px-2 py-1.5 text-[12px] leading-5 text-foreground">
				{comment.body}
			</p>
		</div>
	);
}

function DiffCommentDraftForm({
	draft,
	onCancel,
	onChange,
	onSave,
}: {
	draft: DiffCommentDraft;
	onCancel: () => void;
	onChange: (body: string) => void;
	onSave: () => void;
}) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const canSave = draft.body.trim().length > 0;

	useEffect(() => {
		textareaRef.current?.focus();
	}, []);

	return (
		<form
			className="rounded-md border border-primary/40 bg-popover/95 p-2 text-popover-foreground shadow-xl backdrop-blur"
			onSubmit={(event) => {
				event.preventDefault();
				if (canSave) {
					onSave();
				}
			}}
		>
			<div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
				<MessageSquarePlusIcon className="size-3" strokeWidth={1.8} />
				<span>{formatLineLabel(draft)}</span>
			</div>
			<Textarea
				ref={textareaRef}
				aria-label="Diff comment"
				value={draft.body}
				placeholder="Add a comment..."
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						onCancel();
						return;
					}
					if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
						event.preventDefault();
						if (canSave) {
							onSave();
						}
					}
				}}
				className="min-h-20 resize-none rounded-md bg-background/80 px-2 py-1.5 font-sans text-[12px] leading-5 md:text-[12px]"
			/>
			<div className="mt-2 flex justify-end gap-1">
				<Button
					type="button"
					variant="ghost"
					size="xs"
					onClick={onCancel}
					className="text-muted-foreground"
				>
					<XIcon
						data-icon="inline-start"
						className="size-3"
						strokeWidth={1.8}
					/>
					Cancel
				</Button>
				<Button type="submit" size="xs" disabled={!canSave}>
					<CheckIcon
						data-icon="inline-start"
						className="size-3"
						strokeWidth={1.8}
					/>
					Save
				</Button>
			</div>
		</form>
	);
}

function groupCommentsByLine(comments: DiffComment[]) {
	return comments.reduce<Record<string, DiffComment[]>>((groups, comment) => {
		const key = getDiffLineKey(comment);
		groups[key] = [...(groups[key] ?? []), comment];
		return groups;
	}, {});
}

function formatLineLabel(target: DiffLineTarget) {
	const sideLabel = target.side === "original" ? "Original" : "Modified";
	return `${sideLabel} line ${target.lineNumber}`;
}
