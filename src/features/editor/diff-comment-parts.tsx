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
import {
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
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
	if (hasHelmorMention(body)) {
		return <DiffCommentMentionText body={body} />;
	}

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

function DiffCommentMentionText({ body }: { body: string }) {
	const parts = body.split(/(@helmor\b)/gi);

	return (
		<div className="max-w-none whitespace-pre-wrap break-words text-[12px] leading-5 text-foreground">
			{parts.map((part, index) =>
				/^@helmor$/i.test(part) ? (
					<HelmorMentionPill key={`${part}-${index}`} />
				) : (
					<span key={`${part}-${index}`}>{part}</span>
				),
			)}
		</div>
	);
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
	const [cursorIndex, setCursorIndex] = useState(composer.body.length);
	const canSave = composer.body.trim().length > 0;
	const isEdit =
		composer.kind === "edit-comment" || composer.kind === "edit-reply";
	const mentionMatch = useMemo(
		() => getHelmorMentionCompletion(composer.body, cursorIndex),
		[composer.body, cursorIndex],
	);
	const hasAgentMention = hasHelmorMention(composer.body);

	const updateCursorIndex = useCallback(() => {
		setCursorIndex(textareaRef.current?.selectionStart ?? 0);
	}, []);

	const completeHelmorMention = useCallback(() => {
		if (!mentionMatch) {
			return;
		}

		const nextBody = [
			composer.body.slice(0, mentionMatch.start),
			"@helmor ",
			composer.body.slice(cursorIndex),
		].join("");
		const nextCursor = mentionMatch.start + "@helmor ".length;
		onChange(nextBody);
		window.requestAnimationFrame(() => {
			textareaRef.current?.focus();
			textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
			setCursorIndex(nextCursor);
		});
	}, [composer.body, cursorIndex, mentionMatch, onChange]);

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
			{hasAgentMention ? (
				<div className="mb-1.5 flex items-center gap-1.5">
					<HelmorMentionPill />
				</div>
			) : null}
			<div className="relative">
				<Textarea
					ref={textareaRef}
					aria-label={isEdit ? "Edit diff comment" : "Diff comment"}
					value={composer.body}
					placeholder={
						composer.kind === "reply" ? "Reply..." : "Add a comment..."
					}
					onChange={(event) => {
						onChange(event.target.value);
						setCursorIndex(
							event.target.selectionStart ?? event.target.value.length,
						);
					}}
					onClick={updateCursorIndex}
					onKeyUp={updateCursorIndex}
					onSelect={updateCursorIndex}
					onKeyDown={(event) => {
						if (
							mentionMatch &&
							(event.key === "Tab" || event.key === "Enter")
						) {
							event.preventDefault();
							completeHelmorMention();
							return;
						}
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
				{mentionMatch ? (
					<button
						type="button"
						onMouseDown={(event) => {
							event.preventDefault();
							completeHelmorMention();
						}}
						className="absolute left-1.5 top-full z-10 mt-1 flex cursor-pointer items-center gap-2 rounded-md border border-primary/35 bg-popover px-2 py-1.5 text-left text-[12px] text-popover-foreground shadow-lg"
					>
						<HelmorMentionPill />
						<span className="text-muted-foreground">Agent</span>
						<span className="ml-2 rounded border border-border px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
							Tab
						</span>
					</button>
				) : null}
			</div>
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

function HelmorMentionPill() {
	return (
		<span className="inline-flex h-5 items-center gap-1 rounded-full border border-primary/35 bg-primary/12 px-1.5 text-[11px] font-medium leading-none text-primary">
			<BotIcon className="size-3" strokeWidth={1.8} />
			@helmor
		</span>
	);
}

function hasHelmorMention(body: string): boolean {
	return /(^|[\s([{@])@helmor\b/i.test(body);
}

function getHelmorMentionCompletion(
	body: string,
	cursorIndex: number,
): { start: number } | null {
	const beforeCursor = body.slice(0, cursorIndex);
	const match = beforeCursor.match(/(^|[\s([{@])@([a-z]*)$/i);
	if (!match || match.index === undefined) {
		return null;
	}

	const query = match[2]?.toLowerCase() ?? "";
	if (!query || ("helmor".startsWith(query) && query !== "helmor")) {
		return { start: match.index + (match[1]?.length ?? 0) };
	}

	return null;
}
