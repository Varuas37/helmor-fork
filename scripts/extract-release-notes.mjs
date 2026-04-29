import fs from "node:fs";
import path from "node:path";

const requestedVersion = process.argv.slice(2).find((arg) => arg !== "--");
const packageJson = JSON.parse(
	fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
);
const version = requestedVersion ?? packageJson.version;
const changelogPath = path.join(process.cwd(), "CHANGELOG.md");

if (!fs.existsSync(changelogPath)) {
	console.log("See CHANGELOG.md for release details.");
	process.exit(0);
}

const changelog = fs.readFileSync(changelogPath, "utf8");
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Find the heading line for this version. Done in two steps because
// JavaScript regex does not support `\Z` (end-of-string) — the previous
// single-regex approach silently fell through to the fallback whenever
// the section happened to be the last one in the file (which is the
// common case: the newest release is always on top).
const headingPattern = new RegExp(`^##\\s+${escapedVersion}\\b.*$`, "m");
const headingMatch = changelog.match(headingPattern);

if (!headingMatch || headingMatch.index === undefined) {
	console.log("See CHANGELOG.md for release details.");
	process.exit(0);
}

const afterHeading = changelog.slice(
	headingMatch.index + headingMatch[0].length,
);
const nextHeadingMatch = afterHeading.match(/^##\s+/m);
const body = (
	nextHeadingMatch && nextHeadingMatch.index !== undefined
		? afterHeading.slice(0, nextHeadingMatch.index)
		: afterHeading
).trim();
console.log(body || "See CHANGELOG.md for release details.");
