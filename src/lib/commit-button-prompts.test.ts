import { describe, expect, it } from "vitest";
import type { ForgeDetection } from "./api";
import { buildCommitButtonPrompt } from "./commit-button-prompts";

const GITLAB_FORGE: ForgeDetection = {
	provider: "gitlab",
	host: "gitlab.example.com",
	namespace: "acme",
	repo: "repo",
	remoteUrl: "git@gitlab.example.com:acme/repo.git",
	labels: {
		providerName: "GitLab",
		cliName: "glab",
		changeRequestName: "MR",
		changeRequestFullName: "merge request",
		connectAction: "Connect GitLab",
	},
	cli: null,
	detectionSignals: [],
};

const GITHUB_FORGE: ForgeDetection = {
	provider: "github",
	host: "github.com",
	namespace: "acme",
	repo: "repo",
	remoteUrl: "git@github.com:acme/repo.git",
	labels: {
		providerName: "GitHub",
		cliName: "gh",
		changeRequestName: "PR",
		changeRequestFullName: "pull request",
		connectAction: "Connect GitHub",
	},
	cli: null,
	detectionSignals: [],
};

describe("buildCommitButtonPrompt", () => {
	it("appends create-pr preferences after the built-in prompt", () => {
		expect(
			buildCommitButtonPrompt(
				"create-pr",
				{
					createPr: "Always include rollout notes.",
				},
				"release/next",
			),
		).toContain("### User Preferences\n\nAlways include rollout notes.");
	});

	it("passes the target branch into create-pr prompts (GitHub default)", () => {
		expect(buildCommitButtonPrompt("create-pr", {}, "release/next")).toContain(
			"gh pr create --base release/next",
		);
	});

	it("passes the target branch into create-pr prompts (GitHub forge)", () => {
		const prompt = buildCommitButtonPrompt(
			"create-pr",
			{},
			"release/next",
			GITHUB_FORGE,
		);
		expect(prompt).toContain("Create a pull request");
		expect(prompt).toContain(
			"Open a pull request against `release/next` using `gh pr create --base release/next`.",
		);
	});

	it("passes the target branch into create-pr prompts (GitLab forge)", () => {
		const prompt = buildCommitButtonPrompt(
			"create-pr",
			{},
			"release/next",
			GITLAB_FORGE,
		);
		expect(prompt).toContain("Create a merge request");
		expect(prompt).toContain(
			"Open a merge request against `release/next` using `glab mr create --target-branch release/next`.",
		);
		expect(prompt).not.toContain("`gh pr create`");
		expect(prompt).not.toContain("the repository's default branch");
	});

	it("passes the target branch into resolve-conflicts prompts", () => {
		expect(
			buildCommitButtonPrompt("resolve-conflicts", {}, "release/next"),
		).toContain(
			"This branch has merge conflicts with `release/next`, this workspace's target branch.",
		);
	});

	it("appends fix-errors preferences after the built-in prompt", () => {
		expect(
			buildCommitButtonPrompt("fix", {
				fixErrors: "Run targeted tests before broad suites.",
			}),
		).toContain(
			"### User Preferences\n\nRun targeted tests before broad suites.",
		);
	});

	it("uses GitHub CI inspection commands by default", () => {
		const prompt = buildCommitButtonPrompt("fix", null);
		expect(prompt).toContain("`gh run list` / `gh run view`");
	});

	it("uses GitLab CI inspection commands for GitLab forge", () => {
		const prompt = buildCommitButtonPrompt("fix", null, null, GITLAB_FORGE);
		expect(prompt).toContain("GitLab CI is failing");
		expect(prompt).toContain("`glab ci list` / `glab ci view`");
		expect(prompt).toContain("failing pipeline");
		expect(prompt).not.toContain("`gh run list`");
	});

	it("uses the same root-cause guidance for both forges", () => {
		const githubPrompt = buildCommitButtonPrompt("fix", null);
		const gitlabPrompt = buildCommitButtonPrompt(
			"fix",
			null,
			null,
			GITLAB_FORGE,
		);
		const clause = "— don't just paper over the symptom";
		expect(githubPrompt).toContain(clause);
		expect(gitlabPrompt).toContain(clause);
	});

	it("uses GitHub reopen commands for open-pr by default", () => {
		const prompt = buildCommitButtonPrompt("open-pr", null);
		expect(prompt).toContain("Reopen the closed pull request");
		expect(prompt).toContain("`gh pr reopen` + `gh pr comment`");
	});

	it("uses GitLab reopen commands for open-pr on GitLab forge", () => {
		const prompt = buildCommitButtonPrompt("open-pr", null, null, GITLAB_FORGE);
		expect(prompt).toContain("Reopen the closed merge request");
		expect(prompt).toContain("`glab mr reopen` + `glab mr note`");
	});

	it("appends create-pr preferences after the GitLab prompt", () => {
		const prompt = buildCommitButtonPrompt(
			"create-pr",
			{ createPr: "Mention deployment order." },
			"release/next",
			GITLAB_FORGE,
		);

		expect(prompt).toContain("`glab mr create --target-branch release/next`");
		expect(prompt).toContain(
			"### User Preferences\n\nMention deployment order.",
		);
	});

	it("uses pure-git instructions for commit-and-push regardless of forge", () => {
		const githubPrompt = buildCommitButtonPrompt(
			"commit-and-push",
			null,
			null,
			GITHUB_FORGE,
		);
		const gitlabPrompt = buildCommitButtonPrompt(
			"commit-and-push",
			null,
			null,
			GITLAB_FORGE,
		);
		expect(githubPrompt).toBe(gitlabPrompt);
		expect(githubPrompt).toContain("Commit and push all uncommitted work");
	});

	it("substitutes the workspace remote into the commit-and-push prompt", () => {
		const prompt = buildCommitButtonPrompt(
			"commit-and-push",
			null,
			null,
			null,
			"upstream",
		);
		expect(prompt).toContain("Push the current branch to `upstream`.");
		expect(prompt).toContain("`git push -u upstream HEAD`");
		expect(prompt).not.toContain("<remote>");
	});

	it("falls back to `origin` when the workspace remote is missing", () => {
		const prompt = buildCommitButtonPrompt("commit-and-push", null, null);
		expect(prompt).toContain("`git push -u origin HEAD`");
		expect(prompt).not.toContain("<remote>");
	});

	it("substitutes the workspace remote into the create-pr prompt", () => {
		const prompt = buildCommitButtonPrompt(
			"create-pr",
			{},
			"release/next",
			GITHUB_FORGE,
			"upstream",
		);
		expect(prompt).toContain("Push the current branch to `upstream`.");
		expect(prompt).toContain("`git push -u upstream HEAD`");
		expect(prompt).not.toContain("<remote>");
	});

	it("uses a global create-pr command template when configured", () => {
		const prompt = buildCommitButtonPrompt(
			"create-pr",
			{},
			"release/next",
			GITHUB_FORGE,
			"upstream",
			{
				globalCreatePrCommand:
					"hub pull-request --base $" + "{TARGET_BRANCH} --push $" + "{REMOTE}",
				currentBranch: "feature/a",
			},
		);
		expect(prompt).toContain(
			"`hub pull-request --base release/next --push upstream`",
		);
	});

	it("prefers the repo create-pr command over the global command", () => {
		const prompt = buildCommitButtonPrompt(
			"create-pr",
			{
				createPrCommand: "gh pr create --draft --base $" + "{TARGET_BRANCH}",
			},
			"release/next",
			GITHUB_FORGE,
			"upstream",
			{
				globalCreatePrCommand: "hub pull-request --base $" + "{TARGET_BRANCH}",
			},
		);
		expect(prompt).toContain("`gh pr create --draft --base release/next`");
		expect(prompt).not.toContain("hub pull-request");
	});

	it("builds a merge prompt only when a merge command template is present", () => {
		const prompt = buildCommitButtonPrompt(
			"merge",
			null,
			"main",
			GITLAB_FORGE,
			"origin",
			{
				globalMergePrCommand:
					"glab mr merge $" +
					"{CHANGE_REQUEST_NUMBER} --source-branch $" +
					"{CURRENT_BRANCH}",
				currentBranch: "feature/a",
				changeRequest: {
					url: "https://gitlab.example.com/acme/repo/-/merge_requests/17",
					number: 17,
					state: "OPEN",
					title: "Ship feature",
					isMerged: false,
				},
			},
		);
		expect(prompt).toContain(
			"Merge the current merge request at https://gitlab.example.com/acme/repo/-/merge_requests/17",
		);
		expect(prompt).toContain("`glab mr merge 17 --source-branch feature/a`");
	});

	it("throws for command-driven merge without a merge template", () => {
		expect(() => buildCommitButtonPrompt("merge", null)).toThrow(
			"Missing merge command template.",
		);
	});
});
