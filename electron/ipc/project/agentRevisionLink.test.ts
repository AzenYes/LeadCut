import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { readAgentRevisionHistory } from "../../../services/leadcut-mcp/src/agentRevisionLink";
import { mutate, readProjectSnapshot } from "../../../services/leadcut-mcp/src/mutation";
import { agentBackupLinkPath, pruneHistoryFiles } from "../../../services/leadcut-mcp/src/projectHistoryRetention";
import { deleteProjectVersion, listProjectVersions } from "./versionHistory";

let directory: string;
let file: string;

beforeEach(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-agent-revisions-"));
	file = path.join(directory, "Agent review.leadcut");
	await fs.writeFile(file, JSON.stringify({
		version: 2, videoPath: "take.mp4", thumbnailPng: "embedded",
		editor: { autoCaptions: [], projectPrivateField: "not review data" },
	}));
});

afterEach(async () => {
	await fs.rm(directory, { recursive: true, force: true });
});

async function writeCaption(text: string) {
	const before = await readProjectSnapshot(file);
	const result = await mutate(file, false, before.revision, project => ({
		project: { ...project, editor: { ...project.editor, autoCaptions: [{ id: "one", text }] } },
	}));
	expect(result).not.toHaveProperty("isError");
	const reply = JSON.parse(result.content[0].text);
	const latest = await readProjectSnapshot(file);
	expect(reply.revision).toBe(latest.revision);
	return { ...latest, backup: reply.backupPath as string };
}

it("reads exact intermediate writes in order while keeping normal retained backups", async () => {
	const opened = await readProjectSnapshot(file);
	const first = await writeCaption("first");
	const second = await writeCaption("second");
	const latest = await writeCaption("latest");
	const history = await readAgentRevisionHistory(file, latest.revision, opened.revision);
	expect(history.map(project => project.editor.autoCaptions)).toEqual([
		[{ id: "one", text: "first" }], [{ id: "one", text: "second" }],
	]);
	expect(history[0]).not.toHaveProperty("thumbnailPng");
	expect(history[0]).not.toHaveProperty("mcpRevisionLink");
	expect(history[0].editor).not.toHaveProperty("projectPrivateField");
	expect(JSON.parse(await fs.readFile(second.backup, "utf8"))).not.toHaveProperty("thumbnailPng");
	expect((await listProjectVersions(file)).map(version => version.path)).toEqual(expect.arrayContaining([
		first.backup, second.backup, latest.backup,
	]));
	await expect(readAgentRevisionHistory(file, latest.revision, first.revision))
		.resolves.toMatchObject([{ editor: { autoCaptions: [{ id: "one", text: "second" }] } }]);
});

it("rejects changed or incomplete history and stale links left by other writers", async () => {
	const opened = await readProjectSnapshot(file);
	await writeCaption("first");
	const latest = await writeCaption("last");
	await expect(readAgentRevisionHistory(file, latest.revision, "0".repeat(64))).resolves.toEqual([]);
	await expect(readAgentRevisionHistory(file, "1".repeat(64), opened.revision)).resolves.toEqual([]);
	const raw = await fs.readFile(latest.backup, "utf8");
	await fs.writeFile(latest.backup, `${raw}\n`);
	await expect(readAgentRevisionHistory(file, latest.revision, opened.revision)).resolves.toEqual([]);
	await fs.unlink(latest.backup);
	await expect(readAgentRevisionHistory(file, latest.revision, opened.revision)).resolves.toEqual([]);
});

it("does not guess which write produced identical bytes when there are different predecessors", async () => {
	const opened = await readProjectSnapshot(file);
	await writeCaption("first");
	const second = await writeCaption("same final text");
	await writeCaption("different predecessor");
	const repeated = await writeCaption("same final text");
	expect(repeated.revision).toBe(second.revision);
	await expect(readAgentRevisionHistory(file, repeated.revision, opened.revision)).resolves.toEqual([]);
});

it("removes revision records alongside pruned and deleted history", async () => {
	const first = await writeCaption("first");
	const latest = await writeCaption("latest");
	const firstLink = agentBackupLinkPath(first.backup)!;
	const latestLink = agentBackupLinkPath(latest.backup)!;
	await fs.access(firstLink);
	await fs.access(latestLink);
	await pruneHistoryFiles([{ path: latest.backup, createdAt: 2 }, { path: first.backup, createdAt: 1 }],
		{ keepLast: 1, maxAgeDays: 30 });
	await expect(fs.access(firstLink)).rejects.toHaveProperty("code", "ENOENT");
	await deleteProjectVersion(file, latest.backup, fs.unlink);
	await expect(fs.access(latestLink)).rejects.toHaveProperty("code", "ENOENT");
});
