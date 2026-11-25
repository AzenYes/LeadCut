import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { computeProjectRevision } from "./projectRevision";
import {
	deleteProjectVersion,
	listProjectVersions,
	pruneProjectVersions,
	readProjectVersion,
	restoreProjectVersion,
	snapshotAppVersionIfDue,
	withProjectVersionRename,
} from "./versionHistory";

const DAY = 86_400_000;
let directory: string;
let projectPath: string;
const project = (endMs: number) => JSON.stringify({
	version: 2,
	videoPath: "/take.mp4",
	editor: { clipRegions: [{ id: "screen", startMs: 0, endMs }] },
});

beforeEach(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-version-history-"));
	projectPath = path.join(directory, "Example.leadcut");
	await fs.writeFile(projectPath, project(6_000));
});

afterEach(() => fs.rm(directory, { recursive: true, force: true }));

async function fixture(history: string, name: string, endMs: number) {
	const dir = path.join(directory, history);
	await fs.mkdir(dir, { recursive: true });
	const file = path.join(dir, name);
	await fs.writeFile(file, project(endMs));
	return file;
}

it("lists legacy and current agent and application versions with their timeline durations", async () => {
	const before = await fixture(".mcp-backups", "Example.recordly.1700000000000-agent.recordly", 7_000);
	const snapshot = await fixture(".leadcut-history", "Example.leadcut.1700000000200-app.leadcut", 9_000);
	await fixture(".leadcut-history", "Example extra.leadcut.1700000000300-app.leadcut", 12_000);
	const versions = await listProjectVersions(projectPath);
	expect(versions).toEqual([
		{ id: path.basename(snapshot), path: snapshot, source: "app", createdAt: 1700000000200, durationMs: 9_000, sizeBytes: Buffer.byteLength(project(9_000)) },
		{ id: path.basename(before), path: before, source: "agent", createdAt: 1700000000000, durationMs: 7_000, sizeBytes: Buffer.byteLength(project(7_000)) },
	]);
	await expect(readProjectVersion(projectPath, before)).resolves.toEqual(JSON.parse(project(7_000)));
});

it("restores exact bytes and keeps a reversible copy of every pre-restore state", async () => {
	const before = await fixture(".mcp-backups", "Example.leadcut.1700000000000-agent.leadcut", 9_000);
	await expect(restoreProjectVersion(projectPath, before, computeProjectRevision(project(6_000))))
		.resolves.toEqual({ success: true, revision: computeProjectRevision(project(9_000)) });
	await expect(fs.readFile(projectPath, "utf8")).resolves.toBe(project(9_000));
	const [previous] = await listProjectVersions(projectPath);
	expect(previous).toMatchObject({ source: "before-restore", durationMs: 6_000 });
	await expect(restoreProjectVersion(projectPath, previous.path, computeProjectRevision(project(9_000))))
		.resolves.toMatchObject({ success: true });
	await expect(fs.readFile(projectPath, "utf8")).resolves.toBe(project(6_000));
	expect((await listProjectVersions(projectPath)).filter(version => version.source === "before-restore")).toHaveLength(2);
});

it("rejects foreign paths and stale revisions without changing the project", async () => {
	const outside = await fixture("other", "Example.leadcut.1700000000000-agent.leadcut", 9_000);
	const different = await fixture(".mcp-backups", "Other.leadcut.1700000000000-agent.leadcut", 9_000);
	const adjacent = await fixture(".mcp-backups", "Example.leadcut.1700000000000-agent.leadcut", 9_000);
	const subdir = path.join(directory, ".leadcut-history");
	await fs.mkdir(subdir);
	const redirected = path.join(subdir, "Example.leadcut.1700000000000-app.leadcut");
	await fs.symlink(outside, redirected, "file").catch(error => {
		if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
	});
	for (const file of [outside, different, redirected]) {
		await expect(restoreProjectVersion(projectPath, file, "stale")).rejects.toThrow("Invalid project version path");
	}
	await expect(restoreProjectVersion(projectPath, adjacent, "stale")).resolves.toMatchObject({
		success: false, conflict: true, diskRevision: computeProjectRevision(project(6_000)),
	});
	await expect(fs.readFile(projectPath, "utf8")).resolves.toBe(project(6_000));
	expect(await listProjectVersions(projectPath)).toHaveLength(1);
});

it("caps retained copies even when they are recent", async () => {
	const now = Date.now();
	for (const age of [0, 1, 5, 31, 40, 50]) {
		await fixture(".leadcut-history", `Example.leadcut.${now - age * DAY}-before-restore.leadcut`, 1_000 + age);
	}
	await expect(pruneProjectVersions(projectPath, { keepLast: 4, maxAgeDays: 30 })).resolves.toBe(2);
	expect((await listProjectVersions(projectPath)).map(version => version.durationMs)).toEqual([1000, 1001, 1005, 1031]);
	await expect(pruneProjectVersions(projectPath, { keepLast: 1, maxAgeDays: 30 })).resolves.toBe(3);
	expect(await listProjectVersions(projectPath)).toHaveLength(1);
});

it("takes the first application snapshot and waits ten minutes for the next", async () => {
	await fixture(".mcp-backups", `Example.leadcut.${Date.now()}-agent.leadcut`, 7_000);
	await snapshotAppVersionIfDue(projectPath);
	await snapshotAppVersionIfDue(projectPath);
	const versions = (await listProjectVersions(projectPath)).filter(version => version.source === "app");
	expect(versions).toHaveLength(1);
	const [snapshot] = versions;
	const expired = snapshot.path.replace(String(snapshot.createdAt), String(snapshot.createdAt - 600_000));
	await fs.rename(snapshot.path, expired);
	await fs.writeFile(projectPath, project(8_000));
	await snapshotAppVersionIfDue(projectPath);
	const latest = (await listProjectVersions(projectPath)).find(version => version.source === "app");
	expect(latest?.durationMs).toBe(8_000);
});

it("moves only associated copies on rename and deletes the chosen version by its validated path", async () => {
	await fixture(".mcp-backups", "Example.recordly.1700000000000-agent.recordly", 7_000);
	await fixture(".leadcut-history", "Example.leadcut.1700000000200-app.leadcut", 9_000);
	const unrelated = await fixture(".mcp-backups", "Unrelated.leadcut.1700000000000-agent.leadcut", 12_000);
	const renamed = path.join(directory, "Renamed.leadcut");
	await expect(withProjectVersionRename(projectPath, renamed, async () => { throw new Error("rename failed"); }))
		.rejects.toThrow("rename failed");
	expect(await listProjectVersions(projectPath)).toHaveLength(2);
	expect(await listProjectVersions(renamed)).toHaveLength(0);
	await withProjectVersionRename(projectPath, renamed, () => fs.rename(projectPath, renamed));
	expect(await listProjectVersions(projectPath)).toHaveLength(0);
	const versions = await listProjectVersions(renamed);
	expect(versions.map(version => version.id)).toEqual([
		"Renamed.leadcut.1700000000200-app.leadcut", "Renamed.recordly.1700000000000-agent.recordly",
	]);
	await deleteProjectVersion(renamed, versions[0].path, fs.unlink);
	expect(await listProjectVersions(renamed)).toEqual([versions[1]]);
	await expect(fs.readFile(unrelated, "utf8")).resolves.toBe(project(12_000));
});
