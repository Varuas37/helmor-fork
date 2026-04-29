import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GithubIdentitySnapshot } from "@/lib/api";
import { useGithubIdentity } from "./use-github-identity";

const apiMocks = vi.hoisted(() => ({
	loadGithubIdentitySession: vi.fn(),
	listenGithubIdentityChanged: vi.fn(),
	disconnectGithubIdentity: vi.fn(),
	startGithubIdentityConnect: vi.fn(),
	cancelGithubIdentityConnect: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		loadGithubIdentitySession: apiMocks.loadGithubIdentitySession,
		listenGithubIdentityChanged: apiMocks.listenGithubIdentityChanged,
		disconnectGithubIdentity: apiMocks.disconnectGithubIdentity,
		startGithubIdentityConnect: apiMocks.startGithubIdentityConnect,
		cancelGithubIdentityConnect: apiMocks.cancelGithubIdentityConnect,
	};
});

const toastMocks = vi.hoisted(() => {
	const toast = vi.fn();
	const error = vi.fn();
	const success = vi.fn();
	const dismiss = vi.fn();
	Object.assign(toast, { error, success, dismiss });
	return { toast, error, success, dismiss };
});

vi.mock("sonner", () => ({
	toast: toastMocks.toast,
}));

describe("useGithubIdentity — pushWorkspaceToast fallback", () => {
	beforeEach(() => {
		toastMocks.toast.mockClear();
		toastMocks.error.mockClear();
		toastMocks.success.mockClear();
		apiMocks.loadGithubIdentitySession.mockResolvedValue({
			status: "disconnected",
		} as GithubIdentitySnapshot);
		apiMocks.listenGithubIdentityChanged.mockResolvedValue(() => {});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("falls back to sonner toast when no pushWorkspaceToast is provided", async () => {
		// Force the clipboard branch: report no clipboard so the hook hits
		// the failure path that emits a toast. With no pushWorkspaceToast
		// passed, the sonner fallback should fire.
		vi.stubGlobal("navigator", {});

		const { result } = renderHook(() => useGithubIdentity());

		await waitFor(() => {
			expect(apiMocks.loadGithubIdentitySession).toHaveBeenCalled();
		});

		await act(async () => {
			const ok = await result.current.handleCopyGithubDeviceCode("ABCD-1234");
			expect(ok).toBe(false);
		});

		// Sonner's `toast()` is the default channel for the fallback.
		expect(toastMocks.toast).toHaveBeenCalled();
		const [first] = toastMocks.toast.mock.calls[0] ?? [];
		expect(typeof first).toBe("string");
	});

	it("routes through the explicit pushWorkspaceToast when provided (no sonner fallback)", async () => {
		vi.stubGlobal("navigator", {});
		const pushWorkspaceToast = vi.fn();

		const { result } = renderHook(() => useGithubIdentity(pushWorkspaceToast));

		await waitFor(() => {
			expect(apiMocks.loadGithubIdentitySession).toHaveBeenCalled();
		});

		await act(async () => {
			await result.current.handleCopyGithubDeviceCode("ABCD-1234");
		});

		expect(pushWorkspaceToast).toHaveBeenCalled();
		expect(toastMocks.toast).not.toHaveBeenCalled();
	});
});
