import type {
	ChangeRequestInfo,
	ForgeDetection,
	RepoPreferences,
} from "@/lib/api";
import { forgePromptDialect } from "@/lib/forge-dialect";

const TARGET_BRANCH_PLACEHOLDER = "$" + "{TARGET_BRANCH}";
const CURRENT_BRANCH_PLACEHOLDER = "$" + "{CURRENT_BRANCH}";
const REMOTE_PLACEHOLDER = "$" + "{REMOTE}";
const CHANGE_REQUEST_URL_PLACEHOLDER = "$" + "{CHANGE_REQUEST_URL}";
const CHANGE_REQUEST_NUMBER_PLACEHOLDER = "$" + "{CHANGE_REQUEST_NUMBER}";

export const GIT_ACTION_COMMAND_TEMPLATE_HELP = `Supported placeholders: \`${TARGET_BRANCH_PLACEHOLDER}\`, \`${CURRENT_BRANCH_PLACEHOLDER}\`, \`${REMOTE_PLACEHOLDER}\`, \`${CHANGE_REQUEST_URL_PLACEHOLDER}\`, \`${CHANGE_REQUEST_NUMBER_PLACEHOLDER}\`.`;

export type GitActionCommandContext = {
	targetBranch?: string | null;
	currentBranch?: string | null;
	remote?: string | null;
	changeRequest?: ChangeRequestInfo | null;
};

export type GitActionCommandSettings = {
	globalCreatePrCommand?: string | null;
	globalMergePrCommand?: string | null;
	currentBranch?: string | null;
	changeRequest?: ChangeRequestInfo | null;
};

function normalizeCommandTemplate(value?: string | null): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

function contextValue(value?: string | number | null): string {
	if (value === null || value === undefined) {
		return "";
	}
	return String(value);
}

export function renderGitActionCommandTemplate(
	template: string,
	context: GitActionCommandContext,
): string {
	return template
		.replaceAll(
			TARGET_BRANCH_PLACEHOLDER,
			contextValue(context.targetBranch?.trim()),
		)
		.replaceAll(
			CURRENT_BRANCH_PLACEHOLDER,
			contextValue(context.currentBranch?.trim()),
		)
		.replaceAll(REMOTE_PLACEHOLDER, contextValue(context.remote?.trim()))
		.replaceAll(
			CHANGE_REQUEST_URL_PLACEHOLDER,
			contextValue(context.changeRequest?.url),
		)
		.replaceAll(
			CHANGE_REQUEST_NUMBER_PLACEHOLDER,
			contextValue(context.changeRequest?.number),
		);
}

export function resolveCreatePrCommand({
	repoPreferences,
	globalCommand,
	targetBranch,
	forge,
	remote,
	currentBranch,
	changeRequest,
}: {
	repoPreferences?: RepoPreferences | null;
	globalCommand?: string | null;
	targetBranch: string;
	forge?: ForgeDetection | null;
	remote?: string | null;
	currentBranch?: string | null;
	changeRequest?: ChangeRequestInfo | null;
}): string {
	const template =
		normalizeCommandTemplate(repoPreferences?.createPrCommand) ??
		normalizeCommandTemplate(globalCommand);
	if (!template) {
		return forgePromptDialect(forge).createCommand(targetBranch);
	}
	return renderGitActionCommandTemplate(template, {
		targetBranch,
		currentBranch,
		remote,
		changeRequest,
	});
}

export function resolveMergePrCommand({
	repoPreferences,
	globalCommand,
	targetBranch,
	remote,
	currentBranch,
	changeRequest,
}: {
	repoPreferences?: RepoPreferences | null;
	globalCommand?: string | null;
	targetBranch?: string | null;
	remote?: string | null;
	currentBranch?: string | null;
	changeRequest?: ChangeRequestInfo | null;
}): string | null {
	const template =
		normalizeCommandTemplate(repoPreferences?.mergePrCommand) ??
		normalizeCommandTemplate(globalCommand);
	if (!template) {
		return null;
	}
	return renderGitActionCommandTemplate(template, {
		targetBranch,
		currentBranch,
		remote,
		changeRequest,
	});
}
