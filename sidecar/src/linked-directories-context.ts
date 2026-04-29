/**
 * If the user has linked extra directories via `/add-dir`, prepend a
 * short note to the user's prompt so the agent knows those paths are part of
 * the working context. Idempotent for empty lists — returns `prompt`
 * unchanged.
 *
 * Kept terse (<60 tokens typically) since it fires every turn.
 */
export function prependLinkedDirectoriesContext(
	prompt: string,
	additionalDirectories: readonly string[] | undefined,
): string {
	if (!additionalDirectories || additionalDirectories.length === 0) {
		return prompt;
	}
	const bullets = additionalDirectories.map((d) => `- ${d}`).join("\n");
	return `[Linked directories — you have read/write access alongside the current workspace:\n${bullets}]\n\n${prompt}`;
}
