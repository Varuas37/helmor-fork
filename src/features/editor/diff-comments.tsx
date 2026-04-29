import {
	FlagIcon,
	MessageSquareIcon,
	PencilIcon,
	ReplyIcon,
	Trash2Icon,
} from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import type { DiffLineAnchor } from "@/lib/monaco-runtime";
import { cn } from "@/lib/utils";
import {
	DiffCommentForm,
	DiffCommentMarkdown,
	DiffCommentReplyItem,
} from "./diff-comment-parts";
import type { DiffComment, DiffCommentReply } from "./diff-comment-storage";
import {
	type DiffCommentComposer,
	formatLineLabel,
	getDiffLineKey,
} from "./diff-comment-types";

type DiffCommentLayerProps = {
	comments: DiffComment[];
	composer: DiffCommentComposer | null;
	anchors: Record<string, DiffLineAnchor>;
	onCancelComposer: () => void;
	onChangeComposer: (body: string) => void;
	onDeleteComment: (id: string) => void;
	onDeleteReply: (commentId: string, replyId: string) => void;
	onEditComment: (comment: DiffComment) => void;
	onEditReply: (comment: DiffComment, reply: DiffCommentReply) => void;
	onReply: (comment: DiffComment) => void;
	onSubmitComposer: () => void;
	onToggleBlocking: (id: string) => void;
};

export function DiffCommentLayer({
	comments,
	composer,
	anchors,
	onCancelComposer,
	onChangeComposer,
	onDeleteComment,
	onDeleteReply,
	onEditComment,
	onEditReply,
	onReply,
	onSubmitComposer,
	onToggleBlocking,
}: DiffCommentLayerProps) {
	const groupedComments = useMemo(
		() => groupCommentsByLine(comments),
		[comments],
	);
	const visibleLines = useMemo(() => {
		const keys = new Set<string>(Object.keys(groupedComments));
		if (composer) {
			keys.add(getDiffLineKey(composer));
		}
		return [...keys];
	}, [composer, groupedComments]);

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
				const composerForLine =
					composer && getDiffLineKey(composer) === lineKey ? composer : null;

				return (
					<div
						key={lineKey}
						className="pointer-events-auto absolute max-w-none"
						style={{
							left: 72,
							right: 24,
							top: anchor.top + anchor.lineHeight + 3,
							maxHeight: `min(520px, calc(100% - ${
								anchor.top + anchor.lineHeight + 12
							}px))`,
						}}
						onClick={(event) => event.stopPropagation()}
						onKeyDown={(event) => event.stopPropagation()}
						onTouchMove={(event) => event.stopPropagation()}
						onWheel={(event) => event.stopPropagation()}
					>
						<div className="max-h-[inherit] space-y-1.5 overflow-y-auto overscroll-contain pr-1">
							{lineComments.map((comment) => (
								<SavedDiffComment
									key={comment.id}
									comment={comment}
									composer={composerForLine}
									onCancelComposer={onCancelComposer}
									onChangeComposer={onChangeComposer}
									onDeleteComment={() => onDeleteComment(comment.id)}
									onDeleteReply={(replyId) =>
										onDeleteReply(comment.id, replyId)
									}
									onEditComment={() => onEditComment(comment)}
									onEditReply={(reply) => onEditReply(comment, reply)}
									onReply={() => onReply(comment)}
									onSubmitComposer={onSubmitComposer}
									onToggleBlocking={() => onToggleBlocking(comment.id)}
								/>
							))}
							{composerForLine?.kind === "new" && (
								<DiffCommentForm
									composer={composerForLine}
									onCancel={onCancelComposer}
									onChange={onChangeComposer}
									onSave={onSubmitComposer}
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
	composer,
	onCancelComposer,
	onChangeComposer,
	onDeleteComment,
	onDeleteReply,
	onEditComment,
	onEditReply,
	onReply,
	onSubmitComposer,
	onToggleBlocking,
}: {
	comment: DiffComment;
	composer: DiffCommentComposer | null;
	onCancelComposer: () => void;
	onChangeComposer: (body: string) => void;
	onDeleteComment: () => void;
	onDeleteReply: (replyId: string) => void;
	onEditComment: () => void;
	onEditReply: (reply: DiffCommentReply) => void;
	onReply: () => void;
	onSubmitComposer: () => void;
	onToggleBlocking: () => void;
}) {
	const editRootComposer =
		composer?.kind === "edit-comment" && composer.commentId === comment.id
			? composer
			: null;
	const replyComposer =
		composer?.kind === "reply" && composer.commentId === comment.id
			? composer
			: null;

	return (
		<div className="flex max-h-[42vh] min-h-0 flex-col overflow-hidden rounded-md border border-border/80 bg-popover/95 text-popover-foreground shadow-lg backdrop-blur">
			<div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-2 py-1 text-[10.5px] text-muted-foreground">
				<MessageSquareIcon className="size-3" strokeWidth={1.8} />
				<span className="min-w-0 flex-1 truncate">
					{formatLineLabel(comment)}
					{comment.author === "review-agent"
						? ` · ${comment.authorName ?? "Review agent"}`
						: ""}
					{comment.blocking ? " · Blocking" : ""}
				</span>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					aria-label={
						comment.blocking
							? "Unmark blocking comment"
							: "Mark blocking comment"
					}
					onClick={onToggleBlocking}
					className={cn(
						"size-5 text-muted-foreground hover:text-foreground",
						comment.blocking && "text-destructive hover:text-destructive",
					)}
				>
					<FlagIcon
						className={cn("size-3", comment.blocking && "fill-current")}
						strokeWidth={1.8}
					/>
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					aria-label="Edit comment"
					onClick={onEditComment}
					className="size-5 text-muted-foreground hover:text-foreground"
				>
					<PencilIcon className="size-3" strokeWidth={1.8} />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					aria-label="Delete comment"
					onClick={onDeleteComment}
					className="size-5 text-muted-foreground hover:text-foreground"
				>
					<Trash2Icon className="size-3" strokeWidth={1.8} />
				</Button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
				<div className="px-2 py-1.5">
					{editRootComposer ? (
						<DiffCommentForm
							composer={editRootComposer}
							onCancel={onCancelComposer}
							onChange={onChangeComposer}
							onSave={onSubmitComposer}
						/>
					) : (
						<DiffCommentMarkdown body={comment.body} />
					)}
				</div>

				{comment.replies.length > 0 && (
					<div className="border-t border-border/50">
						{comment.replies.map((reply) => {
							const editReplyComposer =
								composer?.kind === "edit-reply" &&
								composer.commentId === comment.id &&
								composer.replyId === reply.id
									? composer
									: null;

							return (
								<DiffCommentReplyItem
									key={reply.id}
									reply={reply}
									editComposer={editReplyComposer}
									onCancelComposer={onCancelComposer}
									onChangeComposer={onChangeComposer}
									onDeleteReply={() => onDeleteReply(reply.id)}
									onEditReply={() => onEditReply(reply)}
									onSubmitComposer={onSubmitComposer}
								/>
							);
						})}
					</div>
				)}

				{replyComposer ? (
					<div className="border-t border-border/50 p-2">
						<DiffCommentForm
							composer={replyComposer}
							onCancel={onCancelComposer}
							onChange={onChangeComposer}
							onSave={onSubmitComposer}
						/>
					</div>
				) : (
					<div className="flex justify-end border-t border-border/50 px-2 py-1">
						<Button
							type="button"
							variant="ghost"
							size="xs"
							onClick={onReply}
							className="text-muted-foreground"
						>
							<ReplyIcon
								data-icon="inline-start"
								className="size-3"
								strokeWidth={1.8}
							/>
							Reply
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}

function groupCommentsByLine(comments: DiffComment[]) {
	return comments.reduce<Record<string, DiffComment[]>>((groups, comment) => {
		const key = getDiffLineKey(comment);
		groups[key] = [...(groups[key] ?? []), comment];
		return groups;
	}, {});
}
