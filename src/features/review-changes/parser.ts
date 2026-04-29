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
	return [
		{
			filePath,
			side,
			lineNumber,
			body,
			severity:
				severity === "info" ||
				severity === "suggestion" ||
				severity === "warning" ||
				severity === "blocking"
					? severity
					: undefined,
		},
	];
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

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
