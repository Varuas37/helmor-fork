/** Regex matching an absolute image path (may appear anywhere in a string). */
const IMAGE_PATH_RE =
	/(?:^|\s)(\/\S+\.(?:png|jpe?g|gif|webp|svg|bmp|ico))(?:\s|$)/gim;

/** Extract image file paths from text. Detects paths anywhere, not just at line start. */
export function extractImagePaths(text: string): string[] {
	const paths: string[] = [];
	IMAGE_PATH_RE.lastIndex = 0;
	for (
		let match = IMAGE_PATH_RE.exec(text);
		match !== null;
		match = IMAGE_PATH_RE.exec(text)
	) {
		paths.push(match[1]);
	}
	return [...new Set(paths)];
}

/** Test whether a single string looks like an absolute image path. */
export function isImagePath(text: string): boolean {
	return (
		text.startsWith("/") &&
		/\.(?:png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(text.trim())
	);
}
