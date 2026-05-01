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

if (process.env.GITHUB_ACTIONS === "true" && !process.env.HELMOR_RELEASE_PAT) {
	await dispatchPublishWorkflow(tag);
}

console.log(`New tag: ${tag}`);

async function dispatchPublishWorkflow(tag) {
	const token = process.env.GITHUB_TOKEN;
	const repository = process.env.GITHUB_REPOSITORY;
	const apiUrl = process.env.GITHUB_API_URL ?? "https://api.github.com";

	if (!token) {
		console.error("GITHUB_TOKEN is required to dispatch publish.yml.");
		process.exit(1);
	}
	if (!repository) {
		console.error("GITHUB_REPOSITORY is required to dispatch publish.yml.");
		process.exit(1);
	}

	const response = await fetch(
		`${apiUrl}/repos/${repository}/actions/workflows/publish.yml/dispatches`,
		{
			method: "POST",
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
			body: JSON.stringify({
				ref: tag,
				inputs: { draft: "false" },
			}),
		},
	);

	if (!response.ok) {
		const body = await response.text();
		console.error(`Failed to dispatch publish.yml: ${response.status} ${body}`);
		process.exit(1);
	}

	console.log(`Dispatched publish.yml for ${tag}`);
}
