import { describe, expect, it } from "vitest";
import {
	parseFileReviewSummary,
	parseReviewAgentActionBlock,
	stripReviewAgentActionBlocks,
} from "./parser";

describe("review changes parser", () => {
	it("parses structured file summaries", () => {
		const summary = parseFileReviewSummary(
			[
				"```helmor_file_summary",
				JSON.stringify({
					plainLanguageSummary: "Adds a review flow.",
					beforeAfter: [
						{
							before: "Reviewers read the raw diff.",
							after: "Reviewers can open a generated summary.",
							impact: "The review starts from intent instead of syntax.",
						},
					],
					userFeatureImpact: ["Users can summarize diffs."],
					technicalChanges: ["Adds a settings prompt."],
					riskNotes: ["Prompt output can vary."],
					layers: [{ name: "UI", summary: "Diff header controls." }],
					sequence: [{ from: "Reviewer", to: "Diff", label: "Summarize" }],
				}),
				"```",
			].join("\n"),
		);

		expect(summary.plainLanguageSummary).toBe("Adds a review flow.");
		expect(summary.beforeAfter[0]).toEqual({
			before: "Reviewers read the raw diff.",
			after: "Reviewers can open a generated summary.",
			impact: "The review starts from intent instead of syntax.",
		});
		expect(summary.userFeatureImpact).toEqual(["Users can summarize diffs."]);
		expect(summary.layers[0]?.name).toBe("UI");
		expect(summary.sequence[0]?.label).toBe("Summarize");
	});

	it("auto-detects HTML and Mermaid artifacts", () => {
		const htmlSummary = parseFileReviewSummary(
			["```html", "<section><h1>Change report</h1></section>", "```"].join(
				"\n",
			),
		);
		const mermaidSummary = parseFileReviewSummary(
			["```mermaid", "sequenceDiagram", "  User->>UI: Review", "```"].join(
				"\n",
			),
		);

		expect(htmlSummary.html).toContain("Change report");
		expect(htmlSummary.plainLanguageSummary).toBe(
			"Generated HTML review artifact.",
		);
		expect(mermaidSummary.mermaid).toContain("sequenceDiagram");
	});

	it("parses review agent comments", () => {
		const block = parseReviewAgentActionBlock(
			[
				"```helmor_review_comments",
				JSON.stringify({
					comments: [
						{
							filePath: "src/App.tsx",
							side: "modified",
							lineNumber: 42,
							severity: "suggestion",
							body: "Consider extracting this state.",
						},
					],
				}),
				"```",
			].join("\n"),
		);

		expect(block.comments).toEqual([
			{
				filePath: "src/App.tsx",
				side: "modified",
				lineNumber: 42,
				severity: "suggestion",
				body: "Consider extracting this state.",
			},
		]);
	});

	it("normalizes high review severity into blocking comments", () => {
		const block = parseReviewAgentActionBlock(
			[
				"```HELMOR_REVIEW_COMMENTS",
				JSON.stringify({
					comments: [
						{
							filePath: "src/App.tsx",
							side: "modified",
							lineNumber: 42,
							severity: "high",
							body: "This should block the fix flow.",
						},
					],
				}),
				"```",
			].join("\n"),
		);

		expect(block.comments[0]?.severity).toBe("blocking");
	});

	it("strips review action blocks from assistant display markdown", () => {
		const markdown = [
			"Review complete.",
			"",
			"```HELMOR_REVIEW_COMMENTS",
			JSON.stringify({
				comments: [
					{
						filePath: "src/App.tsx",
						side: "modified",
						lineNumber: 42,
						severity: "high",
						body: "Hidden machine-readable action.",
					},
				],
			}),
			"```",
		].join("\n");

		expect(stripReviewAgentActionBlocks(markdown)).toBe("Review complete.");
	});
});
