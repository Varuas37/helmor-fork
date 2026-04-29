import type { DiffComment } from "@/features/editor/diff-comment-storage";
import {
	describeEditorPath,
	type InspectorFileItem,
} from "@/lib/editor-session";

export const DEFAULT_FILE_SUMMARY_PROMPT =
	"Summarize this file diff in natural language for a code review. Focus on user-visible behavior, feature intent, important technical changes, and risks. Avoid restating every line.";

export function buildEffectiveFileSummaryPrompt({
	userPrompt,
	overwrite,
}: {
	userPrompt?: string | null;
	overwrite: boolean;
}): string {
	const trimmedPrompt = userPrompt?.trim() ?? "";
	if (!trimmedPrompt) {
		return DEFAULT_FILE_SUMMARY_PROMPT;
	}
	if (overwrite) {
		return trimmedPrompt;
	}
	return [
		DEFAULT_FILE_SUMMARY_PROMPT,
		"",
		"User preferences. These take priority over the default summary instructions above when they conflict:",
		trimmedPrompt,
	].join("\n");
}

export function buildFileReviewSummaryPrompt({
	customPrompt,
	path,
	workspaceRootPath,
	originalRef,
	modifiedRef,
	originalText,
	modifiedText,
}: {
	customPrompt: string;
	path: string;
	workspaceRootPath?: string | null;
	originalRef?: string | null;
	modifiedRef?: string | null;
	originalText?: string;
	modifiedText?: string;
}): string {
	const pathLabel = describeEditorPath(path, workspaceRootPath);
	return [
		"You are generating a code-review summary for one changed file.",
		"Explain what changed in natural language first, in terms of product behavior and user-facing intent when possible.",
		"Do not edit files.",
		"By default, return one JSON object inside a fenced code block tagged `helmor_file_summary`.",
		"If the user's prompt asks for Mermaid, HTML, or Markdown instead, include that artifact in a fenced `mermaid`, `html`, or `markdown` block. HTML must be self-contained, compact, and use only inline CSS/JS.",
		"The Helmor UI will auto-detect and render structured JSON, Mermaid text, HTML, or Markdown from your response.",
		"",
		"Default JSON shape:",
		"```helmor_file_summary",
		JSON.stringify(
			{
				plainLanguageSummary: "One concise paragraph.",
				beforeAfter: [
					{
						before: "What the behavior, UI, or code path did before.",
						after: "What it does after this change.",
						impact: "Why the reviewer or user should care.",
					},
				],
				userFeatureImpact: ["Concrete user or workflow impact."],
				technicalChanges: ["Concrete implementation change."],
				riskNotes: ["Risk, regression, or test note."],
				layers: [
					{
						name: "UI",
						summary: "What changed in this layer.",
						files: ["path/to/file.tsx"],
					},
				],
				sequence: [
					{
						from: "User",
						to: "UI",
						label: "Action or data flow created by this change.",
					},
				],
				markdown: "Optional Markdown report.",
				mermaid: "sequenceDiagram\\n  User->>UI: Example",
				html: "<section><h1>Optional HTML report</h1></section>",
			},
			null,
			2,
		),
		"```",
		"",
		"Summary prompt:",
		customPrompt.trim() || DEFAULT_FILE_SUMMARY_PROMPT,
		"",
		"Diff target:",
		`- File: ${pathLabel}`,
		`- Original ref: ${originalRef ?? "HEAD"}`,
		`- Modified ref: ${modifiedRef ?? "working tree"}`,
		"",
		"Original content:",
		wrapCode(originalText ?? "", ""),
		"",
		"Modified content:",
		wrapCode(modifiedText ?? "", ""),
	].join("\n");
}

export function buildReviewAgentPrompt({
	changes,
	workspaceRootPath,
	targetBranch,
}: {
	changes: InspectorFileItem[];
	workspaceRootPath: string;
	targetBranch?: string | null;
}): string {
	return [
		"You are an independent code review agent inside Helmor.",
		"Review the changed files in the workspace on disk. You may inspect files and git diff, but do not edit files.",
		"Write a human review in Markdown, then include one structured action block that Helmor can use to add comments to the diff.",
		"",
		"Commenting rules:",
		"- Only comment on concrete changed lines.",
		"- Prefer modified-side comments unless a deleted/original line is the only useful anchor.",
		"- Keep comments actionable and specific.",
		"- Skip invalid or uncertain anchors instead of guessing.",
		"",
		"At the end, include exactly one fenced JSON block tagged `helmor_review_comments` with this shape:",
		"```helmor_review_comments",
		JSON.stringify(
			{
				comments: [
					{
						filePath: "src/example.ts",
						side: "modified",
						lineNumber: 42,
						severity: "suggestion",
						body: "Explain the issue or suggestion.",
					},
				],
			},
			null,
			2,
		),
		"```",
		"",
		"Workspace:",
		`- Root: ${workspaceRootPath}`,
		`- Target branch/ref: ${targetBranch ?? "default comparison"}`,
		"",
		"Changed files:",
		...changes.map(
			(change) =>
				`- ${change.path} (${change.status}, +${change.insertions}/-${change.deletions})`,
		),
	].join("\n");
}

export function buildFixReviewCommentsPrompt({
	entries,
	workspaceRootPath,
}: {
	workspaceRootPath: string;
	entries: Array<{ path: string; comments: DiffComment[] }>;
}): string {
	return [
		"Please address the following blocking code review comments in this workspace.",
		"Inspect the files and make the necessary changes. Preserve behavior that is unrelated to these comments.",
		"",
		`Workspace root: ${workspaceRootPath}`,
		"",
		"Review comments:",
		...entries.flatMap((entry) => [
			"",
			`## ${entry.path}`,
			...entry.comments.map((comment) =>
				[
					`- ${formatCommentAnchor(comment)}`,
					`  ${formatCommentAuthor(comment)}: ${comment.body}`,
					...comment.replies.map(
						(reply) => `  Reply from ${reply.author}: ${reply.body}`,
					),
				].join("\n"),
			),
		]),
	].join("\n");
}

function formatCommentAuthor(comment: DiffComment): string {
	if (comment.author === "review-agent") {
		return comment.authorName ?? "Review agent";
	}
	return "User";
}

function formatCommentAnchor(comment: DiffComment): string {
	if (comment.endLineNumber && comment.endLineNumber > comment.lineNumber) {
		return `${comment.side} lines ${comment.lineNumber}-${comment.endLineNumber}`;
	}
	return `${comment.side} line ${comment.lineNumber}`;
}

function wrapCode(value: string, language: string): string {
	return [`\`\`\`${language}`, value, "```"].join("\n");
}
