import { readFile, writeFile } from "node:fs/promises";

const version = process.argv[2];
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version ?? "")) {
	throw new Error("Usage: node scripts/bump-version.mjs <x.y.z[-prerelease]>");
}

const files = ["package.json", "package-lock.json", "services/leadcut-mcp/package.json", "services/leadcut-mcp/package-lock.json"];
for (const file of files) {
	const target = new URL(`../${file}`, import.meta.url);
	const raw = await readFile(target, "utf8");
	const data = JSON.parse(raw);
	data.version = version;
	if (data.packages?.[""]) data.packages[""].version = version;
	const indentation = raw.match(/\n([ \t]+)"/)?.[1] ?? "\t";
	await writeFile(target, `${JSON.stringify(data, null, indentation)}\n`);
}
