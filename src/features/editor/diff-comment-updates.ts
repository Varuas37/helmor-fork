import type { DiffLineTarget } from "@/lib/monaco-runtime";
import type { DiffComment, DiffCommentReply } from "./diff-comment-storage";

export function addDiffCommentReply(
	comments: DiffComment[],
	commentId: string,
	reply: DiffCommentReply,
): DiffComment[] {
	return comments.map((comment) =>
		comment.id === commentId
			? { ...comment, replies: [...comment.replies, reply] }
			: comment,
	);
}

export function deleteDiffCommentReply(
	comments: DiffComment[],
	commentId: string,
	replyId: string,
): DiffComment[] {
	return comments.map((comment) =>
		comment.id === commentId
			? {
					...comment,
					replies: comment.replies.filter((reply) => reply.id !== replyId),
				}
			: comment,
	);
}

export function updateDiffCommentBody(
	comments: DiffComment[],
	commentId: string,
	body: string,
	updatedAt: string,
): DiffComment[] {
	return comments.map((comment) =>
		comment.id === commentId ? { ...comment, body, updatedAt } : comment,
	);
}

export function updateDiffCommentReply(
	comments: DiffComment[],
	commentId: string,
	replyId: string,
	patch: Partial<DiffCommentReply>,
): DiffComment[] {
	return comments.map((comment) =>
		comment.id === commentId
			? {
					...comment,
					replies: comment.replies.map((reply) =>
						reply.id === replyId ? { ...reply, ...patch } : reply,
					),
				}
			: comment,
	);
}

export function findDiffComment(
	comments: DiffComment[],
	commentId: string,
): DiffComment | null {
	return comments.find((comment) => comment.id === commentId) ?? null;
}

export function findDiffCommentReply(
	comment: DiffComment,
	replyId: string,
): DiffCommentReply | null {
	return comment.replies.find((reply) => reply.id === replyId) ?? null;
}

export function hasDiffCommentOnLine(
	comments: DiffComment[],
	target: DiffLineTarget,
): boolean {
	return comments.some(
		(comment) =>
			comment.side === target.side && comment.lineNumber === target.lineNumber,
	);
}
