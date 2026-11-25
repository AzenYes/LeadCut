import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { guardedSaveProject } from "./guardedSave";
import { computeProjectRevision } from "./projectRevision";

let directory: string;
let projectPath: string;
const original = '{"version":2,"editor":{"clips":[1]}}';
const edited = '{"version":2,"editor":{"clips":[2]}}';
const expectedRevision = computeProjectRevision(original);

beforeEach(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-guarded-save-"));
	projectPath = path.join(directory, "example.recordly");
});

afterEach(async () => {
	await fs.rm(directory, { recursive: true, force: true });
});

it("saves the matching generation and returns the outgoing revision", async () => {
	await fs.writeFile(projectPath, original);
	await expect(guardedSaveProject({ projectPath, content: edited, expectedRevision })).resolves.toEqual({
		success: true, revision: computeProjectRevision(edited),
	});
	await expect(fs.readFile(projectPath, "utf8")).resolves.toBe(edited);
	await expect(fs.readFile(`${projectPath}.bak`, "utf8")).resolves.toBe(original);
});

it("leaves the external edit and existing backup byte-identical on conflict", async () => {
	const external = '{\r\n"editor":{"clips":[3]}}';
	await fs.writeFile(projectPath, external);
	await fs.writeFile(`${projectPath}.bak`, original);
	await expect(guardedSaveProject({ projectPath, content: edited, expectedRevision })).resolves.toEqual({
		success: false, conflict: true, diskRevision: computeProjectRevision(external),
	});
	await expect(fs.readFile(projectPath)).resolves.toEqual(Buffer.from(external));
	await expect(fs.readFile(`${projectPath}.bak`)).resolves.toEqual(Buffer.from(original));
	expect((await fs.readdir(directory)).sort()).toEqual(["example.recordly", "example.recordly.bak"]);
});

it("does not recreate a project that was deleted externally", async () => {
	await expect(guardedSaveProject({ projectPath, content: edited, expectedRevision })).resolves.toEqual({
		success: false, conflict: true, diskRevision: null,
	});
	await expect(fs.readdir(directory)).resolves.toEqual([]);
});

it("does not overwrite a newer format even when its revision matches", async () => {
	const future = '{"version":3,"minReaderVersion":3,"editor":{"futureFeature":true}}';
	await fs.writeFile(projectPath, future);
	await expect(guardedSaveProject({
		projectPath, content: edited, expectedRevision: computeProjectRevision(future),
	})).rejects.toThrow("requires a newer version");
	await expect(fs.readFile(projectPath, "utf8")).resolves.toBe(future);
	expect(await fs.readdir(directory)).toEqual(["example.recordly"]);
});

it("writes a new project without an expected revision", async () => {
	await expect(guardedSaveProject({ projectPath, content: edited, expectedRevision: null })).resolves.toEqual({
		success: true, revision: computeProjectRevision(edited),
	});
	await expect(fs.readFile(projectPath, "utf8")).resolves.toBe(edited);
});

it("only commits one of two concurrent saves of the same generation", async () => {
	await fs.writeFile(projectPath, original);
	const [first, second] = await Promise.all([
		guardedSaveProject({ projectPath, content: edited, expectedRevision }),
		guardedSaveProject({ projectPath, content: "stale second save", expectedRevision }),
	]);
	const revision = computeProjectRevision(edited);
	expect(first).toEqual({ success: true, revision });
	expect(second).toEqual({ success: false, conflict: true, diskRevision: revision });
	await expect(fs.readFile(projectPath, "utf8")).resolves.toBe(edited);
});
