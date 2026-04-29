// Emit a single `v<version>` git tag from the root package.json version and
// push it to origin. Used as the `publish` step of changesets/action in
// release-plan.yml instead of `changeset tag` — which, since the marketing
// monorepo conversion, produces `<name>@<version>` tags that don't match
// publish.yml's `tags: v*` trigger.
//
// The trailing `New tag:` line is intentionally in the single-package shape
// (no `@`) so changesets/action's stdout parser does NOT recognise it as a
// published package — we want publish.yml + tauri-action to own the GitHub
// Release, same as the v0.1.x releases.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const { version } = JSON.parse(
	fs.readFileSync(path.join(root, "package.json"), "utf8"),
);

if (!version) {
	console.error("package.json is missing a version");
	process.exit(1);
}

const tag = `v${version}`;

try {
	execSync(`git rev-parse --verify refs/tags/${tag}`, { stdio: "ignore" });
	console.log(`Tag ${tag} already exists locally; skipping create`);
} catch {
	execSync(`git tag ${tag}`, { stdio: "inherit" });
}

execSync(`git push origin ${tag}`, { stdio: "inherit" });
console.log(`New tag: ${tag}`);
