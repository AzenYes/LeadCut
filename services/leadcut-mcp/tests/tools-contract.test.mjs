import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { before, after, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const expectedTools = [
	"add_zoom", "confirm_chapters", "copy_project", "cut_ranges", "delete_captions", "delete_zooms",
	"detect_silence", "export_project", "get_capabilities", "get_captions", "get_clips", "get_key_events", "get_media_info", "get_paths", "get_recording_markers", "get_revision", "get_transcript", "list_captions",
	"list_backups", "list_chapters", "list_change_log", "list_projects", "list_zooms", "open_project", "restore_backup", "scan_frames",
	"set_captions", "set_chapters", "set_transcript", "transcribe_audio", "update_caption", "update_caption_settings", "update_captions",
	"update_chapter_style", "update_zoom",
];
let client;
let temp;
before(async () => {
	temp = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-tools-contract-"));
	client = new Client({ name: "tool-contract", version: "1" });
	await client.connect(new StdioClientTransport({
		command: process.execPath,
		args: [path.resolve("dist/index.js")],
		env: { ...process.env, LEADCUT_USER_DATA_DIR: temp },
	}));
});
after(async () => {
	await client?.close();
	if (temp) await fs.rm(temp, { recursive: true, force: true });
});

async function call(name, args) {
	const result = await client.callTool({ name, arguments: args });
	assert.notEqual(result.isError, true, result.content.map(item => item.text).join("\n"));
	return JSON.parse(result.content[0].text);
}

test("advertises exactly the documented tools and the desktop silence defaults", async () => {
	const { tools } = await client.listTools();
	assert.deepEqual(tools.map(tool => tool.name).sort(), [...expectedTools].sort());
	const readme = await fs.readFile("README.md", "utf8");
	for (const name of expectedTools) assert.ok(new RegExp(`\\b${name}\\b`).test(readme), `${name} is documented`);
	const { minDurationSec, noiseDb } = tools.find(tool => tool.name === "detect_silence").inputSchema.properties;
	assert.equal(minDurationSec.default, 0.5);
	assert.equal(noiseDb.default, -30);
});

test("summarizes large projects, edits captions atomically, and restores a retained backup", async () => {
	const file = path.join(temp, "batch.leadcut");
	const cues = Array.from({ length: 50 }, (_, index) => ({
		id: `cue-${index}`, startMs: index * 100, endMs: (index + 1) * 100, text: "Before",
	}));
	const thumbnailPng = `data:image/png;base64,${"A".repeat(300_000)}`;
	const project = {
		version: 2, videoPath: "example.mp4", thumbnailPng,
		editor: { clipRegions: [{ id: "clip", startMs: 0, endMs: 5000, sourceStartMs: 0 }], autoCaptions: cues },
	};
	const original = JSON.stringify(project);
	await fs.writeFile(file, original);
	const summary = await call("open_project", { project: file });
	assert.equal(summary.durationMs, 5000);
	assert.equal(summary.counts.autoCaptions, 50);
	assert.ok(Buffer.byteLength(JSON.stringify(summary)) < 20_000);
	assert.ok(!JSON.stringify(summary).includes("data:image"));
	const page = await call("get_captions", { project: file, offset: 10, limit: 3 });
	assert.deepEqual(page.cues.map(cue => cue.id), ["cue-10", "cue-11", "cue-12"]);
	const args = {
		project: file, timelineModel: "leadcut-sequence-v1", expectedRevision: summary.revision,
		updates: cues.map(cue => ({ captionId: cue.id, text: "After" })),
	};
	const planned = await call("update_captions", args);
	assert.equal(planned.diff.length, 50);
	assert.equal(await fs.readFile(file, "utf8"), original);
	const saved = await call("update_captions", { ...args, dryRun: false });
	assert.equal(saved.diff.length, 50);
	assert.equal(await fs.readFile(`${file}.bak`, "utf8"), original);
	assert.ok(!(await fs.readFile(saved.backupPath, "utf8")).includes("data:image"));
	const conflict = await client.callTool({ name: "update_captions", arguments: { ...args, dryRun: false } });
	assert.equal(conflict.isError, true);
	assert.equal(JSON.parse(conflict.content[0].text).currentRevision, saved.revision);
	const { backups } = await call("list_backups", { project: file });
	assert.equal(backups.length, 1);
	await call("restore_backup", { project: file, backupId: backups[0].id, expectedRevision: saved.revision, dryRun: false });
	assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), project);
});

test("reads keyboard events from the source sidecar and returns an empty list when absent", async () => {
	const file = path.join(temp, "keys.leadcut");
	await fs.writeFile(file, JSON.stringify({ version: 2, videoPath: "keys.mp4", editor: {} }));
	assert.deepEqual((await call("get_key_events", { project: file })).events, []);
	const event = { timeMs: 1200, type: "down", keycode: 31, key: "S", ctrl: true, alt: false, shift: false, meta: false };
	await fs.writeFile(path.join(temp, "keys.mp4.leadcut-keys.json"), JSON.stringify({ version: 1, events: [event] }));
	const result = await call("get_key_events", { project: file });
	assert.equal(result.timeBasis, "source");
	assert.deepEqual(result.events, [event]);
});

test("reads recording markers and recalculates change positions against the current clips", async () => {
	const file = path.join(temp, "review.leadcut");
	const video = "recording.mp4";
	const cut = {
		id: "cut", kind: "cut", source: "agent", createdAt: "2026-11-20T00:00:00.000Z",
		batchId: "batch", rangeIndex: 0, sourceStartMs: 1000, sourceEndMs: 2500,
		speed: 1, durationMs: 1500, timelineMs: 1000, reason: "Repeated take", review: "accepted",
	};
	const redo = { note: "Keep the end of the sentence.", markedAt: "2026-11-22T00:00:00.000Z" };
	const flagged = { ...cut, id: "flagged", review: "pending", redo };
	await fs.writeFile(file, JSON.stringify({
		version: 2, videoPath: video,
		editor: {
			clipRegions: [
				{ id: "start", startMs: 0, endMs: 700, sourceStartMs: 300, speed: 1 },
				{ id: "next", startMs: 700, endMs: 1700, sourceStartMs: 2500, speed: 1 },
			],
			changeLog: { version: 1, entries: [cut, flagged] },
		},
	}));
	const log = await call("list_change_log", { project: file });
	assert.deepEqual(log.entries, [
		{ ...cut, currentTimelineMs: 700 },
		{ ...flagged, currentTimelineMs: 700, needsRedo: true },
	]);
	assert.deepEqual((await call("get_recording_markers", { project: file })).markers, []);
	const markers = [{ id: "marker", kind: "highlight", timeMs: 2245, note: "check" }];
	await fs.writeFile(path.join(temp, video + ".leadcut-markers.json"), "\uFEFF" + JSON.stringify({
		version: 1, markers: [...markers, { id: "bad", timeMs: -1, kind: "cut" }],
	}));
	const result = await call("get_recording_markers", { project: file });
	assert.equal(result.timeBasis, "source");
	assert.deepEqual(result.markers, markers);
	assert.equal(result.revision, log.revision);
});
