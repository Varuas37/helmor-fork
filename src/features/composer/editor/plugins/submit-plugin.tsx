/**
 * Lexical plugin: Enter to submit, Shift+Enter for newline.
 *
 * Important: when a typeahead popup (slash command or @-mention file picker)
 * has at least one selectable item we MUST let Enter fall through to the
 * typeahead's own selection handler instead of submitting the message.
 * Lexical registers the typeahead Enter handler at `COMMAND_PRIORITY_LOW`;
 * this plugin runs at HIGH, so we have to actively bail out by returning
 * `false` when a selection is in flight.
 *
 * We detect "menu has selectable items" by looking for a cmdk *item*
 * (`[cmdk-item]`) inside any live typeahead popup wrapper, marked with
 * `data-typeahead-popup`. We cannot key off Lexical's anchor div class
 * anymore — the popup now portals into the composer root (so `bottom-full`
 * aligns to the input's top edge instead of the caret), and Lexical's
 * anchor div sits empty on `document.body`. The slash popup also renders
 * a state row (loading/error/empty) inside the same popup using a plain
 * div — that should NOT block Enter from submitting, because there's
 * nothing for the user to select.
 *
 * IME guard: when a CJK IME (Chinese pinyin / Japanese kana / Korean
 * Hangul) is active and the user presses Enter to confirm a candidate
 * from the IME suggestion popup, the browser fires a `keydown` for
 * that Enter with `event.isComposing === true`, and Safari/legacy
 * paths additionally use `event.keyCode === 229`. Lexical's own
 * keydown handler bails on `editor.isComposing()`, but Chrome fires
 * `compositionend` BEFORE the final keydown — so by the time we get
 * here Lexical's flag is already cleared and we'd accidentally submit
 * a half-typed message. Guarding on `isComposing` / `keyCode === 229`
 * is the canonical fix.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COMMAND_PRIORITY_HIGH, KEY_ENTER_COMMAND } from "lexical";
import { useEffect } from "react";

const TYPEAHEAD_SELECTABLE_SELECTOR = "[data-typeahead-popup] [cmdk-item]";

function isTypeaheadSelectable(): boolean {
	if (typeof document === "undefined") return false;
	return document.querySelector(TYPEAHEAD_SELECTABLE_SELECTOR) !== null;
}

export function SubmitPlugin({
	onSubmit,
	disabled,
}: {
	onSubmit: () => void;
	disabled: boolean;
}) {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		return editor.registerCommand(
			KEY_ENTER_COMMAND,
			(event) => {
				if (event?.isComposing || event?.keyCode === 229) return false; // IME confirm — let the browser process it
				if (event?.shiftKey) return false; // let Lexical handle newline
				if (isTypeaheadSelectable()) return false; // let typeahead select
				event?.preventDefault();
				if (!disabled) onSubmit();
				return true;
			},
			COMMAND_PRIORITY_HIGH,
		);
	}, [editor, onSubmit, disabled]);

	return null;
}
