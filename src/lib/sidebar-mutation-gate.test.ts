import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	beginSidebarMutation,
	endSidebarMutation,
	flushSidebarLists,
	flushSidebarListsIfIdle,
	isSidebarMutationInFlight,
	resetSidebarMutationGate,
} from "./sidebar-mutation-gate";

describe("sidebar-mutation-gate", () => {
	let queryClient: QueryClient;
	let invalidateSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		resetSidebarMutationGate();
		queryClient = new QueryClient();
		invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
	});

	afterEach(() => {
		resetSidebarMutationGate();
	});

	it("starts with no mutation in flight", () => {
		expect(isSidebarMutationInFlight()).toBe(false);
	});

	it("tracks begin/end pairs", () => {
		beginSidebarMutation();
		expect(isSidebarMutationInFlight()).toBe(true);
		beginSidebarMutation();
		expect(isSidebarMutationInFlight()).toBe(true);
		endSidebarMutation();
		expect(isSidebarMutationInFlight()).toBe(true);
		endSidebarMutation();
		expect(isSidebarMutationInFlight()).toBe(false);
	});

	it("clamps counter at zero", () => {
		endSidebarMutation();
		endSidebarMutation();
		expect(isSidebarMutationInFlight()).toBe(false);
		beginSidebarMutation();
		expect(isSidebarMutationInFlight()).toBe(true);
	});

	it("flushSidebarLists always invalidates both queries", () => {
		flushSidebarLists(queryClient);
		expect(invalidateSpy).toHaveBeenCalledTimes(2);
	});

	it("flushSidebarListsIfIdle invalidates when counter is 0", () => {
		flushSidebarListsIfIdle(queryClient);
		expect(invalidateSpy).toHaveBeenCalledTimes(2);
	});

	it("flushSidebarListsIfIdle skips invalidate when a mutation is in flight", () => {
		beginSidebarMutation();
		flushSidebarListsIfIdle(queryClient);
		expect(invalidateSpy).not.toHaveBeenCalled();
		endSidebarMutation();
		flushSidebarListsIfIdle(queryClient);
		expect(invalidateSpy).toHaveBeenCalledTimes(2);
	});
});
