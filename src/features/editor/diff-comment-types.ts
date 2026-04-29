import type { DiffLineTarget } from "@/lib/monaco-runtime";

export type DiffCommentComposer =
	| (DiffLineTarget & {
			kind: "new";
			body: string;
	  })
	| (DiffLineTarget & {
			kind: "reply";
			commentId: string;
			body: string;
	  })
	| (DiffLineTarget & {
			kind: "edit-comment";
			commentId: string;
			body: string;
	  })
	| (DiffLineTarget & {
			kind: "edit-reply";
			commentId: string;
			replyId: string;
			body: string;
	  });

export function getDiffLineKey(target: DiffLineTarget): string {
	return `${target.side}:${target.lineNumber}`;
}

export function formatLineLabel(target: DiffLineTarget) {
	const sideLabel = target.side === "original" ? "Original" : "Modified";
	if (target.endLineNumber && target.endLineNumber > target.lineNumber) {
		return `${sideLabel} lines ${target.lineNumber}-${target.endLineNumber}`;
	}
	return `${sideLabel} line ${target.lineNumber}`;
}
