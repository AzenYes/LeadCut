import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { editorLockPath, readEditorLock } from "../../../services/leadcut-mcp/src/editorLock";
import { acquireEditorLock, releaseEditorLock } from "./editorLock";

let directory: string;
let project: string;

beforeEach(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-editor-lock-"));
	project = path.join(directory, "recording.recordly");
	await fs.writeFile(project, "{}");
});

afterEach(async () => {
	await releaseEditorLock(project);
	await fs.rm(directory, { recursive: true, force: true });
});

it("writes project ownership metadata and removes the lock on release", async () => {
	await acquireEditorLock(project);
	const marker = await readEditorLock(project);
	expect(marker).toMatchObject({ app: "LeadCut", version: 1, pid: process.pid, hostname: os.hostname(), projectPath: project });
	expect(Number.isFinite(Date.parse(marker!.heartbeatAt))).toBe(true);
	await releaseEditorLock(project);
	await expect(fs.access(editorLockPath(project))).rejects.toMatchObject({ code: "ENOENT" });
});

it("does not unlink a replacement marker owned by a different editor", async () => {
	await acquireEditorLock(project);
	const original = await readEditorLock(project);
	const replacement = { ...original, pid: process.pid + 1 };
	await fs.writeFile(editorLockPath(project), JSON.stringify(replacement));
	await releaseEditorLock(project);
	await expect(readEditorLock(project)).resolves.toEqual(replacement);
});
