import type {
	FileReviewSummary,
	ReviewAgentActionBlock,
	ReviewAgentComment,
	ReviewBeforeAfterRow,
	ReviewLayerSummary,
	ReviewSequenceStep,
} from "./types";

export function parseFileReviewSummary(markdown: string): FileReviewSummary {
	const parsed = parseTaggedJson(markdown, "helmor_file_summary");
	const source =
		parsed && typeof parsed === "object"
			? (parsed as Record<string, unknown>)
			: {};
	const markdownArtifact =
		readString(source.markdown) || readTaggedBlock(markdown, "markdown");
	const mermaidArtifact =
		readString(source.mermaid) || readTaggedBlock(markdown, "mermaid");
	const htmlArtifact =
		readString(source.html) || readTaggedBlock(markdown, "html");

	return {
		plainLanguageSummary:
			readString(source.plainLanguageSummary) ||
			markdownArtifact ||
			(htmlArtifact ? "Generated HTML review artifact." : "") ||
			(mermaidArtifact ? "Generated Mermaid review artifact." : "") ||
			markdown.trim() ||
			"No summary returned.",
		beforeAfter: readBeforeAfter(source.beforeAfter),
		userFeatureImpact: readStringArray(source.userFeatureImpact),
		technicalChanges: readStringArray(source.technicalChanges),
		riskNotes: readStringArray(source.riskNotes),
		layers: readLayers(source.layers),
		sequence: readSequence(source.sequence),
		markdown: markdownArtifact || null,
		mermaid: mermaidArtifact || null,
		html: htmlArtifact || null,
	};
}

export function parseReviewAgentActionBlock(
	markdown: string,
): ReviewAgentActionBlock {
	const parsed = parseTaggedJson(markdown, "helmor_review_comments");
	if (!parsed || typeof parsed !== "object") {
		return { comments: [] };
	}

	const comments = (parsed as { comments?: unknown }).comments;
	if (!Array.isArray(comments)) {
		return { comments: [] };
	}

	return {
		comments: comments.flatMap(readReviewAgentComment),
	};
}

export function stripReviewAgentActionBlocks(markdown: string): string {
	return removeTrailingUnclosedReviewFence(
		markdown.replace(reviewCommentFencePattern(), ""),
	)
		.replace(reviewCommentMarkerPattern(), "")
		.trim();
}

function readBeforeAfter(value: unknown): ReviewBeforeAfterRow[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.flatMap((item) => {
		if (!item || typeof item !== "object") {
			return [];
		}
		const candidate = item as Record<string, unknown>;
		const before = readString(candidate.before);
		const after = readString(candidate.after);
		if (!before || !after) {
			return [];
		}
		const impact = readString(candidate.impact);
		return [{ before, after, impact: impact || undefined }];
	});
}

function parseTaggedJson(markdown: string, tag: string): unknown {
	const escapedTag = escapeRegExp(tag);
	const fence = "```";
	const taggedPattern = new RegExp(
		`${fence}${escapedTag}\\s*([\\s\\S]*?)${fence}`,
		"i",
	);
	const taggedMatch = markdown.match(taggedPattern);
	if (taggedMatch?.[1]) {
		return parseJsonLoose(taggedMatch[1]);
	}

	const unfencedTaggedBlock = readUnfencedTaggedBlock(markdown, tag);
	if (unfencedTaggedBlock) {
		return parseJsonLoose(unfencedTaggedBlock);
	}

	const jsonPattern = /```json\s*([\s\S]*?)```/i;
	const jsonMatch = markdown.match(jsonPattern);
	if (jsonMatch?.[1]) {
		return parseJsonLoose(jsonMatch[1]);
	}

	return parseJsonLoose(markdown);
}

function readTaggedBlock(markdown: string, tag: string): string {
	const escapedTag = escapeRegExp(tag);
	const fence = "```";
	const pattern = new RegExp(
		`${fence}${escapedTag}\\s*([\\s\\S]*?)${fence}`,
		"i",
	);
	const match = markdown.match(pattern);
	return match?.[1]?.trim() ?? "";
}

function parseJsonLoose(value: string): unknown {
	try {
		return JSON.parse(value.trim());
	} catch {
		return null;
	}
}

function readReviewAgentComment(value: unknown): ReviewAgentComment[] {
	if (!value || typeof value !== "object") {
		return [];
	}

	const candidate = value as Record<string, unknown>;
	const filePath = readString(candidate.filePath);
	const lineNumber = candidate.lineNumber;
	const side = candidate.side;
	const body = readString(candidate.body);
	if (
		!filePath ||
		(side !== "original" && side !== "modified") ||
		typeof lineNumber !== "number" ||
		!Number.isInteger(lineNumber) ||
		lineNumber < 1 ||
		!body
	) {
		return [];
	}

	const severity = candidate.severity;
	const normalizedSeverity = normalizeReviewSeverity(severity);
	return [
		{
			filePath,
			side,
			lineNumber,
			body,
			severity: normalizedSeverity,
		},
	];
}

function normalizeReviewSeverity(
	severity: unknown,
): ReviewAgentComment["severity"] {
	if (typeof severity !== "string") {
		return undefined;
	}

	switch (severity.trim().toLowerCase()) {
		case "high":
		case "critical":
		case "error":
		case "blocker":
		case "blocking":
			return "blocking";
		case "warn":
		case "warning":
		case "medium":
			return "warning";
		case "suggestion":
		case "suggest":
		case "low":
			return "suggestion";
		case "info":
		case "note":
			return "info";
		default:
			return undefined;
	}
}

function readLayers(value: unknown): ReviewLayerSummary[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.flatMap((item) => {
		if (!item || typeof item !== "object") {
			return [];
		}
		const candidate = item as Record<string, unknown>;
		const name = readString(candidate.name);
		const summary = readString(candidate.summary);
		if (!name || !summary) {
			return [];
		}
		return [
			{
				name,
				summary,
				files: readStringArray(candidate.files),
			},
		];
	});
}

function readSequence(value: unknown): ReviewSequenceStep[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.flatMap((item) => {
		if (!item || typeof item !== "object") {
			return [];
		}
		const candidate = item as Record<string, unknown>;
		const from = readString(candidate.from);
		const to = readString(candidate.to);
		const label = readString(candidate.label);
		if (!from || !to || !label) {
			return [];
		}
		return [{ from, to, label }];
	});
}

function readStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.flatMap((item) => {
		const text = readString(item);
		return text ? [text] : [];
	});
}

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readUnfencedTaggedBlock(markdown: string, tag: string): string {
	const escapedTag = escapeRegExp(tag);
	const pattern = new RegExp(`^\\s*${escapedTag}\\s*\\r?\\n([\\s\\S]*)$`, "im");
	return markdown.match(pattern)?.[1]?.trim() ?? "";
}

function reviewCommentFencePattern(): RegExp {
	return /```[ \t]*helmor_review_comments[^\r\n]*(?:\r?\n[\s\S]*?)(?:\r?\n)?```/gi;
}

function removeTrailingUnclosedReviewFence(markdown: string): string {
	return markdown.replace(
		/```[ \t]*helmor_review_comments[^\r\n]*(?:\r?\n[\s\S]*)?$/i,
		"",
	);
}

function reviewCommentMarkerPattern(): RegExp {
	return /^\s*helmor_review_comments\s*\r?\n[\s\S]*$/im;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
