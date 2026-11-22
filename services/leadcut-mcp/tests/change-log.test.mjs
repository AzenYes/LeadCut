import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolveEntryTimelineMs } from "../dist/changeLogModel.js";

test("records explained cuts, preserves prior batches, and previews without writing", async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-change-log-"));
	const project = path.join(directory, "rough.leadcut");
	const initial = JSON.stringify({
		version: 2,
		projectId: "change-log-fixture",
		videoPath: "sample.mp4",
		editor: {
			clipRegions: [{ id: "first", startMs: 0, endMs: 10000, sourceStartMs: 300, speed: 1 }],
			zoomRegions: [{ id: "zoom", startMs: 6000, endMs: 8000, depth: 1 }],
		},
	});
	await fs.writeFile(project, initial);
	const client = new Client({ name: "leadcut-change-log", version: "1" });
	try {
		await client.connect(new StdioClientTransport({
			command: process.execPath,
			args: [path.resolve("dist/index.js")],
			env: { ...process.env, LEADCUT_USER_DATA_DIR: directory },
		}));
		const call = async (name, args = {}) => {
			const result = await client.callTool({ name, arguments: { project, ...args } });
			assert.equal(Boolean(result.isError), false, result.content[0].text);
			return JSON.parse(result.content[0].text);
		};
		const timelineModel = "leadcut-sequence-v1";
		const ranges = Array.from({ length: 10 }, (_, index) => ({
			startMs: 500 + index * 300,
			endMs: 550 + index * 300,
			reason: `记录 ${index}`,
			confidence: index % 2 ? "low" : "high",
		}));
		const preview = await call("cut_ranges", { timeBasis: "source", timelineModel, ranges });
		assert.equal(preview.dryRun, true);
		assert.equal(preview.changeLogAdded.length, 10);
		assert.equal(await fs.readFile(project, "utf8"), initial);
		const first = await call("cut_ranges", {
			timeBasis: "source", timelineModel, ranges, dryRun: false, expectedRevision: preview.revision,
		});
		const persisted = JSON.parse(await fs.readFile(project, "utf8"));
		assert.deepEqual(persisted.editor.changeLog.entries, first.changeLogAdded);
		assert.equal(new Set(first.changeLogAdded.map(entry => entry.batchId)).size, 1);
		for (const [index, entry] of first.changeLogAdded.entries()) {
			const range = ranges[index];
			assert.equal(entry.rangeIndex, index);
			assert.equal(entry.reason, range.reason);
			assert.equal(entry.confidence, range.confidence);
			assert.equal(entry.sourceStartMs, range.startMs);
			assert.equal(entry.sourceEndMs, range.endMs);
			assert.equal(entry.source, "agent");
			assert.equal(entry.durationMs, 50);
		}
		const second = await call("cut_ranges", {
			timeBasis: "source", timelineModel, ranges: [{ startMs: 7300, endMs: 7400 }],
			dryRun: false, expectedRevision: first.revision,
		});
		const latest = JSON.parse(await fs.readFile(project, "utf8")).editor;
		assert.deepEqual(latest.changeLog.entries.slice(0, 10), first.changeLogAdded);
		for (const entry of latest.changeLog.entries) {
			const next = latest.clipRegions.find(clip => clip.sourceStartMs >= entry.sourceEndMs);
			const expected = Math.round(next?.startMs ?? latest.clipRegions.at(-1).endMs);
			assert.equal(resolveEntryTimelineMs(entry, latest.clipRegions), expected);
		}
		await call("update_zoom", {
			zoomId: "zoom", depth: 2, dryRun: false, expectedRevision: second.revision,
		});
		assert.deepEqual(JSON.parse(await fs.readFile(project, "utf8")).editor.changeLog, latest.changeLog);
	} finally {
		await client.close();
		await fs.rm(directory, { recursive: true, force: true });
	}
});
