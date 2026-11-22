import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const initial = JSON.stringify({
	version: 2, videoPath: "screen.mp4", editor: {
		clipRegions: [{ id: "screen", startMs: 0, endMs: 5000, speed: 1, sourceStartMs: 0 }],
		zoomRegions: [{ id: "zoom", startMs: 1000, endMs: 3000, depth: 1 }],
	},
});
const revision = createHash("sha256").update(initial).digest("hex");
let directory;
let client;

before(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-lock-mcp-"));
	client = new Client({ name: "leadcut-editor-lock-test", version: "1" });
	await client.connect(new StdioClientTransport({
		command: process.execPath, args: [path.resolve("dist/index.js")],
		env: { ...process.env, LEADCUT_USER_DATA_DIR: directory },
	}));
});

after(async () => {
	await client?.close();
	if (directory) await fs.rm(directory, { recursive: true, force: true });
});

async function fixture(name, fields = {}) {
	const project = path.join(directory, `${name}.leadcut`);
	const now = new Date().toISOString();
	await fs.writeFile(project, initial);
	await fs.writeFile(`${project}.leadcut-lock`, JSON.stringify({
		app: "LeadCut", version: 1, pid: process.pid, hostname: os.hostname(), projectPath: project,
		openedAt: now, heartbeatAt: now, ...fields,
	}));
	return project;
}

function cut(project, dryRun) {
	return client.callTool({ name: "cut_ranges", arguments: {
		project, dryRun, expectedRevision: revision, timeBasis: "timeline", timelineModel: "leadcut-sequence-v1",
		ranges: [{ startMs: 0, endMs: 1000 }],
	} });
}

test("blocks live-editor cuts and zoom writes without changing the project", async () => {
	const project = await fixture("active");
	const cutResult = await cut(project, false);
	assert.equal(cutResult.isError, true);
	assert.match(cutResult.content[0].text, /LeadCut.*主页/);
	const zoomResult = await client.callTool({ name: "update_zoom", arguments: {
		project, zoomId: "zoom", depth: 2, expectedRevision: revision, dryRun: false,
	} });
	assert.equal(zoomResult.isError, true);
	assert.match(zoomResult.content[0].text, /LeadCut.*主页/);
	assert.equal(await fs.readFile(project, "utf8"), initial);
});

for (const [name, fields] of [
	["dead", { pid: 2147483647 }],
	["stale", { heartbeatAt: new Date(Date.now() - 300_000).toISOString() }],
]) {
	test(`allows a write after encountering a ${name} marker`, async () => {
		const project = await fixture(name, fields);
		const result = await cut(project, false);
		assert.ok(!result.isError, JSON.stringify(result));
		assert.equal(JSON.parse(result.content[0].text).removedMs, 1000);
		assert.notEqual(await fs.readFile(project, "utf8"), initial);
	});
}

test("dry run stays available for an open project and reports its occupancy", async () => {
	const project = await fixture("dry-run");
	const result = await cut(project, true);
	assert.ok(!result.isError, JSON.stringify(result));
	assert.equal(JSON.parse(result.content[0].text).openInEditor, true);
	assert.equal(await fs.readFile(project, "utf8"), initial);
});
