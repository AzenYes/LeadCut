import { afterEach, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createUntitledProject } from "./createUntitledProject";
const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});
it("publishes complete, uniquely named projects under concurrent creation without replacing existing projects", async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-new-"));
	dirs.push(dir);
	await fs.writeFile(path.join(dir, "Untitled Project.leadcut"), "original");
	const createdAt = new Date(2026, 9, 9, 8, 5, 3);
	const base = "项目_2026-10-09_08-05-03";
	await fs.writeFile(path.join(dir, `${base}.leadcut`), "existing timestamp");
	const paths = await Promise.all(
		[1, 2, 3].map((n) => createUntitledProject(dir, JSON.stringify({ id: n }), createdAt)),
	);
	expect(paths.map((p) => path.basename(p)).sort()).toEqual([
		`${base}_1.leadcut`,
		`${base}_2.leadcut`,
		`${base}_3.leadcut`,
	]);
	expect(await fs.readFile(path.join(dir, `${base}.leadcut`), "utf8")).toBe(
		"existing timestamp",
	);
	expect(await fs.readFile(path.join(dir, "Untitled Project.leadcut"), "utf8")).toBe("original");
	for (let i = 0; i < paths.length; i++)
		expect(JSON.parse(await fs.readFile(paths[i], "utf8"))).toEqual({ id: i + 1 });
	expect((await fs.readdir(dir)).filter((p) => p.endsWith(".tmp"))).toEqual([]);
});

it("includes local date and time in the first project's name", async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-new-"));
	dirs.push(dir);
	const result = await createUntitledProject(dir, "complete", new Date(2026, 0, 2, 23, 4, 5));
	expect(path.basename(result)).toBe("项目_2026-01-02_23-04-05.leadcut");
	expect(await fs.readFile(result, "utf8")).toBe("complete");
});
