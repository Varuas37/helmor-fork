import { expect, test } from "@playwright/test";

test.describe("streaming footer overlap regression", () => {
	test("keeps the footer below the live assistant row while the collapsed tool group grows", async ({
		page,
	}) => {
		await page.goto("/?e2eScenario=streaming-footer-overlap");
		await expect(
			page.getByRole("heading", { name: "Streaming Footer Overlap Scenario" }),
		).toBeVisible();

		let maxOverlap = Number.NEGATIVE_INFINITY;
		let worstSample: null | {
			tick: number;
			overlap: number;
			footerTop: number;
			lastBottom: number;
			footerText: string;
			summaryText: string;
		} = null;

		for (let tick = 0; tick < 40; tick += 1) {
			await page.waitForTimeout(120);
			const sample = await page.evaluate(() => {
				const footer = document.querySelector(
					"[data-testid='streaming-footer']",
				);
				const assistantRows = Array.from(
					document.querySelectorAll("[data-message-role='assistant']"),
				);
				const lastAssistantRow = assistantRows[assistantRows.length - 1] as
					| HTMLElement
					| undefined;
				const summary = Array.from(document.querySelectorAll("summary")).find(
					(node) => node.textContent?.includes("read-only commands"),
				);
				if (
					!(footer instanceof HTMLElement) ||
					!(lastAssistantRow instanceof HTMLElement) ||
					!(summary instanceof HTMLElement)
				) {
					return null;
				}

				const footerRect = footer.getBoundingClientRect();
				const lastRect = lastAssistantRow.getBoundingClientRect();
				return {
					overlap:
						Math.min(footerRect.bottom, lastRect.bottom) -
						Math.max(footerRect.top, lastRect.top),
					footerTop: footerRect.top,
					lastBottom: lastRect.bottom,
					footerText: footer.textContent ?? "",
					summaryText: summary.textContent ?? "",
				};
			});

			if (sample && sample.overlap > maxOverlap) {
				maxOverlap = sample.overlap;
				worstSample = { tick, ...sample };
			}
		}

		await expect(page.getByTestId("visible-tool-count")).toHaveText("18");
		expect(maxOverlap, JSON.stringify(worstSample)).toBeLessThanOrEqual(0);
	});
});
