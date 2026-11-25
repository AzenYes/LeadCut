import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../.tmp/bench/", import.meta.url));
const apply = process.argv.includes("--apply");
if (process.argv.slice(2).some(arg => arg !== "--apply")) {
	throw new Error("Usage: npm run clean:artifacts -- [--apply]");
}
const entries = await fs.readdir(root, { withFileTypes: true }).catch(error => {
	if (error.code !== "ENOENT") throw error;
	return [];
});
const runs = [];
for (const entry of entries) {
	if (!entry.isDirectory() || !/^run-[\w-]+$/.test(entry.name)) continue;
	const candidate = path.join(root, entry.name);
	const resolved = await fs.realpath(candidate);
	if (path.relative(root, resolved) !== entry.name) continue;
	runs.push({ path: resolved, modified: (await fs.stat(resolved)).mtimeMs });
}
runs.sort((a, b) => b.modified - a.modified);
const cutoff = Date.now() - 14 * 86_400_000;
for (const run of runs.slice(2)) {
	if (run.modified >= cutoff) continue;
	console.log(`${apply ? "Removing" : "Would remove"} ${run.path}`);
	if (apply) await fs.rm(run.path, { recursive: true, force: true });
}
