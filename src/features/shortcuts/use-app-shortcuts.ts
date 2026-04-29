import { useEffect, useMemo, useRef } from "react";
import { getActiveScopes } from "./focus-scope";
import { normalizeShortcutEvent } from "./format";
import { isShortcutRecordingActive } from "./recording-state";
import {
	getShortcut,
	getShortcutConflicts,
	SHORTCUT_DEFINITION_BY_ID,
} from "./registry";
import type { ShortcutId, ShortcutMap, ShortcutScope } from "./types";

export type ShortcutHandler = {
	id: ShortcutId;
	callback: () => void;
	enabled?: boolean;
};

type Registration = {
	callback: () => void;
	enabled: boolean;
	hotkey: string | null;
	id: ShortcutId;
	scopes: readonly ShortcutScope[];
};

type UseAppShortcutsArgs = {
	overrides: ShortcutMap;
	handlers: ShortcutHandler[];
};

export function useAppShortcuts({ overrides, handlers }: UseAppShortcutsArgs) {
	const registrations = useMemo<Registration[]>(() => {
		const { disabledIds } = getShortcutConflicts(overrides);
		return handlers
			.map(({ id, callback, enabled = true }) => {
				const definition = SHORTCUT_DEFINITION_BY_ID.get(id);
				return {
					callback,
					enabled,
					hotkey: getShortcut(overrides, id),
					id,
					scopes: definition?.scopes ?? [],
				};
			})
			.filter(
				(registration) =>
					registration.hotkey && !disabledIds.has(registration.id),
			);
	}, [handlers, overrides]);
	const registrationsRef = useRef(registrations);
	registrationsRef.current = registrations;

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (isShortcutRecordingActive()) return;

			const hotkey = normalizeShortcutEvent(event);
			if (!hotkey) return;
			const activeScopes = getActiveScopes();

			const match = registrationsRef.current.find(
				(registration) =>
					registration.enabled &&
					registration.hotkey === hotkey &&
					(registration.scopes.includes("app") ||
						registration.scopes.some((scope) => activeScopes.includes(scope))),
			);
			if (!match) return;
			event.preventDefault();
			event.stopPropagation();
			match.callback();
		};

		window.addEventListener("keydown", handleKeyDown, true);
		return () => window.removeEventListener("keydown", handleKeyDown, true);
	}, []);
}
