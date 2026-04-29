import type { AgentModelSection, AgentProvider } from "@/lib/api";
import {
	createSession,
	hideSession,
	loadAgentModelSections,
	renameSession,
	startAgentMessageStream,
} from "@/lib/api";
import { describeEditorPath } from "@/lib/editor-session";
import type { DiffLineTarget } from "@/lib/monaco-runtime";
import type { AppSettings } from "@/lib/settings";
import {
	clampEffortToModel,
	findModelOption,
	inferDefaultModelId,
} from "@/lib/workspace-helpers";
import {
	buildDiffCommentAiPrompt,
	extractAssistantMarkdownFromStreamEvent,
} from "./diff-comment-ai";
import {
	createDiffCommentId,
	type DiffComment,
	type DiffCommentScope,
} from "./diff-comment-storage";
import {
	addDiffCommentReply,
	updateDiffCommentReply,
} from "./diff-comment-updates";

export type ApplyDiffCommentUpdate = (
	scope: DiffCommentScope,
	updater: (comments: DiffComment[]) => DiffComment[],
) => DiffComment[];

type StartDiffCommentAiReplyOptions = {
	scope: DiffCommentScope;
	thread: DiffComment;
	target: DiffLineTarget;
	sourceBody: string;
	path: string;
	workspaceId?: string | null;
	workspaceRootPath?: string | null;
	originalRef?: string | null;
	modifiedRef?: string | null;
	originalText?: string;
	modifiedText?: string;
	settings: AppSettings;
	applyUpdate: ApplyDiffCommentUpdate;
};

export async function startDiffCommentAiReply({
	scope,
	thread,
	target,
	sourceBody,
	path,
	workspaceId,
	workspaceRootPath,
	originalRef,
	modifiedRef,
	originalText,
	modifiedText,
	settings,
	applyUpdate,
}: StartDiffCommentAiReplyOptions) {
	const replyId = createDiffCommentId();
	const startedAt = new Date().toISOString();

	applyUpdate(scope, (comments) =>
		addDiffCommentReply(comments, thread.id, {
			id: replyId,
			author: "helmor",
			body: "",
			createdAt: startedAt,
			status: "pending",
		}),
	);

	try {
		if (!workspaceId || !workspaceRootPath) {
			throw new Error("Open a workspace before asking Helmor about a diff.");
		}

		const model = await resolveDiffCommentAgentModel(settings);
		const { sessionId } = await createSession(workspaceId, {
			permissionMode: "bypassPermissions",
		});
		const title = `Diff: ${describeEditorPath(path, workspaceRootPath)}`;
		void renameSession(sessionId, title).catch((error) => {
			console.warn("[diff-comments] failed to name hidden AI session:", error);
		});

		const prompt = buildDiffCommentAiPrompt({
			questionBody: sourceBody,
			thread,
			target,
			path,
			workspaceRootPath,
			originalRef,
			modifiedRef,
			originalText,
			modifiedText,
		});

		let latestBody = "";
		await startAgentMessageStream(
			{
				provider: model.provider,
				modelId: model.modelId,
				prompt,
				helmorSessionId: sessionId,
				workingDirectory: workspaceRootPath,
				effortLevel: model.effortLevel,
				permissionMode: "bypassPermissions",
				fastMode: model.fastMode,
				userMessageId: createDiffCommentId(),
			},
			(event) => {
				const markdown = extractAssistantMarkdownFromStreamEvent(event);
				if (markdown !== null) {
					latestBody = markdown;
					applyUpdate(scope, (comments) =>
						updateDiffCommentReply(comments, thread.id, replyId, {
							body: markdown,
							status: "streaming",
							updatedAt: new Date().toISOString(),
							helmorSessionId: sessionId,
						}),
					);
				}

				if (event.kind === "done") {
					applyUpdate(scope, (comments) =>
						updateDiffCommentReply(comments, thread.id, replyId, {
							body: latestBody || "No answer returned.",
							status: "done",
							updatedAt: new Date().toISOString(),
							helmorSessionId: sessionId,
						}),
					);
					void hideSession(sessionId).catch((error) => {
						console.warn("[diff-comments] failed to hide AI session:", error);
					});
				}

				if (event.kind === "aborted" || event.kind === "error") {
					const message =
						event.kind === "aborted" ? event.reason : event.message;
					applyUpdate(scope, (comments) =>
						updateDiffCommentReply(comments, thread.id, replyId, {
							body: latestBody || "Helmor could not answer this comment.",
							errorMessage: message,
							status: "error",
							updatedAt: new Date().toISOString(),
							helmorSessionId: sessionId,
						}),
					);
					void hideSession(sessionId).catch((error) => {
						console.warn("[diff-comments] failed to hide AI session:", error);
					});
				}
			},
		);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Helmor could not answer.";
		applyUpdate(scope, (comments) =>
			updateDiffCommentReply(comments, thread.id, replyId, {
				body: "Helmor could not answer this comment.",
				errorMessage: message,
				status: "error",
				updatedAt: new Date().toISOString(),
			}),
		);
	}
}

async function resolveDiffCommentAgentModel(settings: AppSettings): Promise<{
	provider: AgentProvider;
	modelId: string;
	effortLevel: string;
	fastMode: boolean;
}> {
	const sections = await loadAgentModelSections();
	const modelId = inferDefaultModelId(null, sections, settings.defaultModelId);
	const model = findModelOption(sections, modelId);
	if (!model) {
		throw new Error("No agent model is available.");
	}

	return {
		provider: model.provider,
		modelId: model.id,
		effortLevel: clampEffortToModel(
			settings.defaultEffort ?? "high",
			model.id,
			sections as AgentModelSection[],
		),
		fastMode:
			settings.defaultFastMode === true && model.supportsFastMode === true,
	};
}
