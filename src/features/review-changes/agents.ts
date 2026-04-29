import { resolveDiffCommentAgentModel } from "@/features/editor/diff-comment-agent";
import { extractAssistantMarkdownFromStreamEvent } from "@/features/editor/diff-comment-ai";
import {
	createDiffCommentId,
	type DiffCommentScope,
} from "@/features/editor/diff-comment-storage";
import {
	createSession,
	hideSession,
	renameSession,
	startAgentMessageStream,
} from "@/lib/api";
import type { AppSettings } from "@/lib/settings";
import { parseFileReviewSummary } from "./parser";
import { buildFileReviewSummaryPrompt } from "./prompts";
import type { FileReviewSummary } from "./types";

export async function generateFileReviewSummary({
	scope,
	path,
	workspaceId,
	workspaceRootPath,
	originalRef,
	modifiedRef,
	originalText,
	modifiedText,
	settings,
	customPrompt,
}: {
	scope: DiffCommentScope;
	path: string;
	workspaceId?: string | null;
	workspaceRootPath?: string | null;
	originalRef?: string | null;
	modifiedRef?: string | null;
	originalText?: string;
	modifiedText?: string;
	settings: AppSettings;
	customPrompt: string;
}): Promise<FileReviewSummary> {
	if (!workspaceId || !workspaceRootPath) {
		throw new Error("Open a workspace before summarizing a diff.");
	}

	const model = await resolveDiffCommentAgentModel(settings);
	const { sessionId } = await createSession(workspaceId, {
		permissionMode: "bypassPermissions",
	});
	void renameSession(
		sessionId,
		`Summary: ${scope.path.split("/").pop() ?? path}`,
	);

	const prompt = buildFileReviewSummaryPrompt({
		customPrompt,
		path,
		workspaceRootPath,
		originalRef,
		modifiedRef,
		originalText,
		modifiedText,
	});
	let latestMarkdown = "";

	try {
		return await new Promise<FileReviewSummary>((resolve, reject) => {
			void startAgentMessageStream(
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
						latestMarkdown = markdown;
					}

					if (event.kind === "done") {
						resolve(parseFileReviewSummary(latestMarkdown));
					}

					if (event.kind === "aborted" || event.kind === "error") {
						reject(
							new Error(
								event.kind === "aborted"
									? event.reason
									: event.message || "Summary generation failed.",
							),
						);
					}
				},
			).catch(reject);
		});
	} finally {
		void hideSession(sessionId).catch((error) => {
			console.warn("[review-changes] failed to hide summary session:", error);
		});
	}
}
