import path from "node:path";
import fs from "node:fs/promises";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {pathToFileURL, fileURLToPath} from "node:url";
import {promisify} from "node:util";
import {execFile as execFileCb} from "node:child_process";
import {getLogger} from "@ui5/logger";

const execFile = promisify(execFileCb);
const log = getLogger("linter:ui5Types:resolveTypes");

// Resolve the linter's own package root for cache storage
const linterRequire = createRequire(import.meta.url);
const linterPkgRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".."
);

interface ResolvedTypes {
	typesDir: string;
	typesIdentity: string;
}

export async function resolveSapui5Types(
	projectRootDir: string,
	ui5Version: string | undefined
): Promise<ResolvedTypes> {
	// No version specified — use bundled types
	if (!ui5Version) {
		return resolveBundledTypes();
	}

	// Try project's node_modules first
	const projectTypes = tryResolveFromProject(projectRootDir, ui5Version);
	if (projectTypes) {
		log.verbose(`Using @sapui5/types@${ui5Version} from project's node_modules`);
		return projectTypes;
	}

	// Try linter cache
	const cachedTypes = await tryResolveFromCache(ui5Version);
	if (cachedTypes) {
		log.verbose(`Using @sapui5/types@${ui5Version} from cache`);
		return cachedTypes;
	}

	// Install into cache
	log.verbose(`Installing @sapui5/types@${ui5Version} into cache...`);
	const installed = await installIntoCache(ui5Version);
	if (installed) {
		return installed;
	}

	// Final fallback: bundled types
	log.verbose(`Failed to resolve @sapui5/types@${ui5Version}, falling back to bundled types`);
	return resolveBundledTypes();
}

function resolveBundledTypes(): ResolvedTypes {
	const typesDir = path.dirname(linterRequire.resolve("@sapui5/types/package.json"));
	return {typesDir, typesIdentity: typesDir};
}

function tryResolveFromProject(
	projectRootDir: string, ui5Version: string
): ResolvedTypes | undefined {
	try {
		const projectRequire = createRequire(
			pathToFileURL(path.join(projectRootDir, "package.json")).href
		);
		const pkgJsonPath = projectRequire.resolve("@sapui5/types/package.json");
		const typesDir = path.dirname(pkgJsonPath);

		// Verify version matches
		const pkgJson = JSON.parse(
			readFileSync(pkgJsonPath, "utf8")
		) as {version: string};

		if (pkgJson.version === ui5Version) {
			return {typesDir, typesIdentity: typesDir};
		}
		log.verbose(
			`Project has @sapui5/types@${pkgJson.version} but requested ${ui5Version}, skipping`
		);
	} catch {
		// Not found in project
	}
	return undefined;
}

function getCacheDir(version: string): string {
	return path.join(linterPkgRoot, "node_modules", ".cache", "sapui5-types", version);
}

async function tryResolveFromCache(ui5Version: string): Promise<ResolvedTypes | undefined> {
	const cacheDir = getCacheDir(ui5Version);
	const typesDir = path.join(cacheDir, "node_modules", "@sapui5", "types");
	try {
		const stats = await fs.stat(path.join(typesDir, "package.json"));
		if (stats.isFile()) {
			return {typesDir, typesIdentity: typesDir};
		}
	} catch {
		// Not cached
	}
	return undefined;
}

async function installIntoCache(ui5Version: string): Promise<ResolvedTypes | undefined> {
	const cacheDir = getCacheDir(ui5Version);
	try {
		await fs.mkdir(cacheDir, {recursive: true});

		// Create a minimal package.json so npm resolves transitive dependencies properly
		await fs.writeFile(
			path.join(cacheDir, "package.json"),
			JSON.stringify({name: "sapui5-types-cache", version: "0.0.0", private: true})
		);

		await execFile("npm", [
			"install",
			`@sapui5/types@${ui5Version}`,
			"--prefix", cacheDir,
			"--ignore-scripts",
		]);
		const typesDir = path.join(cacheDir, "node_modules", "@sapui5", "types");
		const stats = await fs.stat(path.join(typesDir, "package.json"));
		if (stats.isFile()) {
			return {typesDir, typesIdentity: typesDir};
		}
	} catch (err) {
		log.verbose(`Failed to install @sapui5/types@${ui5Version}: ${String(err)}`);
	}
	return undefined;
}
