import {
	BotIcon,
	CheckIcon,
	Loader2Icon,
	MessageSquarePlusIcon,
	PencilIcon,
	ReplyIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import { Suspense, useEffect, useRef } from "react";
import { LazyStreamdown } from "@/components/streamdown-loader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { DiffCommentReply } from "./diff-comment-storage";
import {
	type DiffCommentComposer,
	formatLineLabel,
} from "./diff-comment-types";

export function DiffCommentReplyItem({
	reply,
	editComposer,
	onCancelComposer,
	onChangeComposer,
	onDeleteReply,
	onEditReply,
	onSubmitComposer,
}: {
	reply: DiffCommentReply;
	editComposer: DiffCommentComposer | null;
	onCancelComposer: () => void;
	onChangeComposer: (body: string) => void;
	onDeleteReply: () => void;
	onEditReply: () => void;
	onSubmitComposer: () => void;
}) {
	const isHelmor = reply.author === "helmor";
	const isLive = reply.status === "pending" || reply.status === "streaming";

	return (
		<div className="border-b border-border/40 px-2 py-1.5 last:border-b-0">
			<div className="mb-1 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
				{isHelmor ? (
					<BotIcon className="size-3" strokeWidth={1.8} />
				) : (
					<ReplyIcon className="size-3" strokeWidth={1.8} />
				)}
				<span className="min-w-0 flex-1 truncate">
					{isHelmor ? "Helmor" : "Reply"}
				</span>
				{isLive && (
					<Loader2Icon className="size-3 animate-spin" strokeWidth={1.8} />
				)}
				{!isHelmor && (
					<>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label="Edit reply"
							onClick={onEditReply}
							className="size-5 text-muted-foreground hover:text-foreground"
						>
							<PencilIcon className="size-3" strokeWidth={1.8} />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label="Delete reply"
							onClick={onDeleteReply}
							className="size-5 text-muted-foreground hover:text-foreground"
						>
							<Trash2Icon className="size-3" strokeWidth={1.8} />
						</Button>
					</>
				)}
			</div>
			{editComposer ? (
				<DiffCommentForm
					composer={editComposer}
					onCancel={onCancelComposer}
					onChange={onChangeComposer}
					onSave={onSubmitComposer}
				/>
			) : reply.status === "pending" && !reply.body ? (
				<p className="text-[12px] leading-5 text-muted-foreground">
					Thinking...
				</p>
			) : (
				<>
					<DiffCommentMarkdown body={reply.body} />
					{reply.status === "error" && reply.errorMessage && (
						<p className="mt-1 text-[11px] leading-4 text-destructive">
							{reply.errorMessage}
						</p>
					)}
				</>
			)}
		</div>
	);
}

export function DiffCommentMarkdown({ body }: { body: string }) {
	return (
		<div className="assistant-markdown-scale max-w-none break-words text-[12px] leading-5 text-foreground">
			<Suspense fallback={<MarkdownFallback body={body} />}>
				<LazyStreamdown className="conversation-streamdown" mode="static">
					{body}
				</LazyStreamdown>
			</Suspense>
		</div>
	);
}

function MarkdownFallback({ body }: { body: string }) {
	return <div className="whitespace-pre-wrap break-words">{body}</div>;
}

export function DiffCommentForm({
	composer,
	onCancel,
	onChange,
	onSave,
}: {
	composer: DiffCommentComposer;
	onCancel: () => void;
	onChange: (body: string) => void;
	onSave: () => void;
}) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const canSave = composer.body.trim().length > 0;
	const isEdit =
		composer.kind === "edit-comment" || composer.kind === "edit-reply";

	useEffect(() => {
		textareaRef.current?.focus();
	}, []);

	return (
		<form
			className={cn(
				"rounded-md border bg-popover/95 p-2 text-popover-foreground backdrop-blur",
				isEdit ? "border-border/70 shadow-sm" : "border-primary/40 shadow-xl",
			)}
			onSubmit={(event) => {
				event.preventDefault();
				if (canSave) {
					onSave();
				}
			}}
		>
			<div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
				{composer.kind === "reply" || composer.kind === "edit-reply" ? (
					<ReplyIcon className="size-3" strokeWidth={1.8} />
				) : (
					<MessageSquarePlusIcon className="size-3" strokeWidth={1.8} />
				)}
				<span>
					{isEdit
						? "Edit"
						: composer.kind === "reply"
							? "Reply"
							: formatLineLabel(composer)}
				</span>
			</div>
			<Textarea
				ref={textareaRef}
				aria-label={isEdit ? "Edit diff comment" : "Diff comment"}
				value={composer.body}
				placeholder={
					composer.kind === "reply" ? "Reply..." : "Add a comment..."
				}
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
