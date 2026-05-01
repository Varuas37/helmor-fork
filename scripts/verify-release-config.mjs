import fs from "node:fs";
import path from "node:path";

function fail(message) {
	console.error(message);
	process.exit(1);
}

const root = process.cwd();
const packageJson = JSON.parse(
	fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const tauriConfig = JSON.parse(
	fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"),
);
const changesetConfig = JSON.parse(
	fs.readFileSync(path.join(root, ".changeset", "config.json"), "utf8"),
);
const cargoToml = fs.readFileSync(
	path.join(root, "src-tauri", "Cargo.toml"),
	"utf8",
);
const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");

const releaseRepo = "Varuas37/helmor-fork";
const expectedUpdaterEndpoint = `https://github.com/${releaseRepo}/releases/latest/download/latest.json`;

const cargoVersionMatch = cargoToml.match(/^version = "(.*)"$/m);
if (!cargoVersionMatch) {
	fail("Unable to find version in src-tauri/Cargo.toml");
}

const versions = {
	package: packageJson.version,
	cargo: cargoVersionMatch[1],
	tauri: tauriConfig.version,
};

if (new Set(Object.values(versions)).size !== 1) {
	fail(
		`Release versions are out of sync: package=${versions.package}, cargo=${versions.cargo}, tauri=${versions.tauri}`,
	);
}

const updaterEndpoints = tauriConfig.plugins?.updater?.endpoints;
if (!Array.isArray(updaterEndpoints)) {
	fail("src-tauri/tauri.conf.json is missing plugins.updater.endpoints");
}
if (!updaterEndpoints.includes(expectedUpdaterEndpoint)) {
	fail(
		`Updater endpoint must include ${expectedUpdaterEndpoint}; found ${updaterEndpoints.join(", ")}`,
	);
}

const updaterPubkey = tauriConfig.plugins?.updater?.pubkey;
if (typeof updaterPubkey !== "string" || updaterPubkey.length === 0) {
	fail("src-tauri/tauri.conf.json is missing plugins.updater.pubkey");
}

const changelogRepo = changesetConfig.changelog?.[1]?.repo;
if (changelogRepo !== releaseRepo) {
	fail(
		`Changesets changelog repo must be ${releaseRepo}; found ${changelogRepo ?? "<missing>"}`,
	);
}

const expectedEnvLine = `HELMOR_UPDATER_ENDPOINTS=${expectedUpdaterEndpoint}`;
if (!envExample.includes(expectedEnvLine)) {
	fail(`.env.example must include ${expectedEnvLine}`);
}

const expectedPubkeyLine = `HELMOR_UPDATER_PUBKEY=${updaterPubkey}`;
if (!envExample.includes(expectedPubkeyLine)) {
	fail(".env.example HELMOR_UPDATER_PUBKEY must match tauri.conf.json");
}

console.log(`Release configuration verified for version ${versions.package}`);
