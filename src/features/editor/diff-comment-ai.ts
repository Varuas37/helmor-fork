import type {
	AgentStreamEvent,
	ExtendedMessagePart,
	ThreadMessageLike,
} from "@/lib/api";
import { describeEditorPath } from "@/lib/editor-session";
import type { DiffLineTarget } from "@/lib/monaco-runtime";
import type { DiffComment, DiffCommentReply } from "./diff-comment-storage";

export type DiffCommentAiPromptContext = {
	questionBody: string;
	thread: DiffComment;
	target: DiffLineTarget;
	path: string;
	workspaceRootPath?: string | null;
	originalRef?: string | null;
	modifiedRef?: string | null;
	originalText?: string;
	modifiedText?: string;
};

const HELMOR_MENTION_PATTERN = /(^|[\s([{@])@helmor\b/i;

export function containsHelmorMention(body: string): boolean {
	return HELMOR_MENTION_PATTERN.test(body);
}

export function stripHelmorMention(body: string): string {
	return body.replace(/@helmor\b/gi, "").trim();
}

export function buildDiffCommentAiPrompt(
	context: DiffCommentAiPromptContext,
): string {
	const pathLabel = describeEditorPath(context.path, context.workspaceRootPath);
	const sideLabel =
		context.target.side === "original" ? "Original" : "Modified";
	const question =
		stripHelmorMention(context.questionBody) || context.questionBody;
	const originalSnippet = formatSnippet(
		context.originalText,
		context.target.lineNumber,
	);
	const modifiedSnippet = formatSnippet(
		context.modifiedText,
		context.target.lineNumber,
	);

	return [
		"You are Helmor responding inside a diff review comment thread.",
		"Use the workspace on disk to inspect code when needed, but do not edit files unless the user explicitly asks for a patch.",
		"Answer directly in Markdown. Mermaid diagrams are allowed when they make the answer clearer.",
		"",
		"Diff target:",
		`- File: ${pathLabel}`,
		`- Anchor: ${sideLabel} line ${context.target.lineNumber}`,
		`- Original ref: ${context.originalRef ?? "HEAD"}`,
		`- Modified ref: ${context.modifiedRef ?? "working tree"}`,
		"",
		"User question:",
		question,
		"",
		"Diff comment thread so far:",
		formatThread(context.thread),
		"",
		"Original-side context:",
		wrapCode(originalSnippet || "(no original content)", ""),
		"",
		"Modified-side context:",
		wrapCode(modifiedSnippet || "(no modified content)", ""),
	].join("\n");
}

export function extractAssistantMarkdownFromStreamEvent(
	event: AgentStreamEvent,
): string | null {
	if (event.kind === "streamingPartial" && event.message.role === "assistant") {
		return extractAssistantMarkdown(event.message);
	}

	if (event.kind !== "update") {
		return null;
	}

	for (let index = event.messages.length - 1; index >= 0; index -= 1) {
		const message = event.messages[index];
		if (message.role !== "assistant") {
			continue;
		}

		const markdown = extractAssistantMarkdown(message);
		if (markdown) {
			return markdown;
		}
	}

	return null;
}

function extractAssistantMarkdown(message: ThreadMessageLike): string {
	return message.content.flatMap(extractTextParts).join("\n\n").trim();
}

function extractTextParts(part: ExtendedMessagePart): string[] {
	if (part.type === "text") {
		return [part.text];
	}

	if (part.type === "collapsed-group") {
		return [];
	}

	if (part.type === "tool-call") {
		return (part.children ?? []).flatMap(extractTextParts);
	}

	return [];
}

function formatThread(thread: DiffComment): string {
	const lines = [`User: ${thread.body}`];
	for (const reply of thread.replies) {
		lines.push(`${formatReplyAuthor(reply)}: ${reply.body}`);
	}
	return lines.join("\n\n");
}

function formatReplyAuthor(reply: DiffCommentReply): string {
	return reply.author === "helmor" ? "Helmor" : "User";
}

function formatSnippet(text: string | undefined, lineNumber: number): string {
	if (!text) {
		return "";
	}

	const lines = text.split(/\r?\n/);
	const startLine = Math.max(1, lineNumber - 12);
	const endLine = Math.min(lines.length, lineNumber + 12);
	return lines
		.slice(startLine - 1, endLine)
		.map((line, index) => {
			const number = String(startLine + index).padStart(4, " ");
			return `${number} | ${line}`;
		})
		.join("\n");
}

function wrapCode(value: string, language: string): string {
	return [`\`\`\`${language}`, value, "```"].join("\n");
}
