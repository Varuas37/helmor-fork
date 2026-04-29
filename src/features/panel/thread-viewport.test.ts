import { describe, expect, it } from "vitest";
import { resolveConversationRowHeight } from "./thread-viewport";

describe("resolveConversationRowHeight", () => {
	it("keeps the larger estimate for streaming rows until measurement catches up", () => {
		expect(
			resolveConversationRowHeight({
				estimatedHeight: 168,
				measuredHeight: 132,
				streaming: true,
			}),
		).toBe(168);
	});

	it("trusts the measured height for non-streaming rows", () => {
		expect(
			resolveConversationRowHeight({
				estimatedHeight: 168,
				measuredHeight: 132,
				streaming: false,
			}),
		).toBe(132);
	});
});
