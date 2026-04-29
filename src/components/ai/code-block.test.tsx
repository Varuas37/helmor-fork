import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CodeBlock, CodeBlockCopyButton } from "./code-block";

afterEach(() => {
	cleanup();
});

describe("CodeBlock", () => {
	it("uses floating actions when no language is provided", () => {
		const { container } = render(
			<CodeBlock code="mutation 持续未完成 → 32.5s 后超时，共 10 次调用">
				<CodeBlockCopyButton />
			</CodeBlock>,
		);

		expect(
			container.querySelector('[data-code-block-actions="header"]'),
		).toBeNull();
		expect(
			container.querySelector('[data-code-block-actions="floating"]'),
		).not.toBeNull();
		expect(screen.getByRole("button")).toBeInTheDocument();
	});

	it("keeps header actions when a language is provided", () => {
		const { container } = render(
			<CodeBlock code="const value = 1;" language="ts">
				<CodeBlockCopyButton />
			</CodeBlock>,
		);

		expect(
			container.querySelector('[data-code-block-actions="header"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[data-code-block-actions="floating"]'),
		).toBeNull();
	});
});
