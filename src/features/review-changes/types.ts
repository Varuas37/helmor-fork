import type { DiffLineSide } from "@/lib/monaco-runtime";

export type ReviewLayerSummary = {
	name: string;
	summary: string;
	files?: string[];
};

export type ReviewSequenceStep = {
	from: string;
	to: string;
	label: string;
};

export type ReviewBeforeAfterRow = {
	before: string;
	after: string;
	impact?: string;
};

export type FileReviewSummary = {
	plainLanguageSummary: string;
	beforeAfter: ReviewBeforeAfterRow[];
	userFeatureImpact: string[];
	technicalChanges: string[];
	riskNotes: string[];
	layers: ReviewLayerSummary[];
	sequence: ReviewSequenceStep[];
	markdown?: string | null;
	mermaid?: string | null;
	html?: string | null;
};

export type ReviewAgentComment = {
	filePath: string;
	side: DiffLineSide;
	lineNumber: number;
	body: string;
	severity?: "info" | "suggestion" | "warning" | "blocking";
};

export type ReviewAgentActionBlock = {
	comments: ReviewAgentComment[];
};
