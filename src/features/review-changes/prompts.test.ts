import { describe, expect, it } from "vitest";
import {
	buildEffectiveFileSummaryPrompt,
	DEFAULT_FILE_SUMMARY_PROMPT,
} from "./prompts";

describe("review summary prompts", () => {
	it("uses the default prompt when no user prompt is configured", () => {
		expect(
			buildEffectiveFileSummaryPrompt({
				userPrompt: "",
				overwrite: false,
			}),
		).toBe(DEFAULT_FILE_SUMMARY_PROMPT);
	});

	it("appends user preferences after the default prompt by default", () => {
		const prompt = buildEffectiveFileSummaryPrompt({
			userPrompt: "Render the report as compact HTML.",
			overwrite: false,
		});

		expect(prompt).toContain(DEFAULT_FILE_SUMMARY_PROMPT);
		expect(prompt).toContain("User preferences");
		expect(prompt).toContain("Render the report as compact HTML.");
	});

	it("replaces the default prompt when overwrite is enabled", () => {
		expect(
			buildEffectiveFileSummaryPrompt({
				userPrompt: "Only generate a magazine-cover HTML artifact.",
				overwrite: true,
			}),
		).toBe("Only generate a magazine-cover HTML artifact.");
	});
});
