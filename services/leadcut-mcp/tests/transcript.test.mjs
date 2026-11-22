import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { before, after, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let client;
let workspace;
let nextProject = 1;
const engineDefault = "faster-whisper";
const oldCaption = { id: "keep", startMs: 500, endMs: 1000, text: "Keep the edit" };
const timelineModel = "leadcut-sequence-v1";
const originalProject = { version: 2, videoPath: "source.mp4", editor: { autoCaptions: [oldCaption], future: { retain: true } } };
before(async () => {
	workspace = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-transcript-test-"));
	client = new Client({ name: "leadcut-transcript-test", version: "1" });
	await client.connect(new StdioClientTransport({
		command: process.execPath,
		args: [path.resolve("dist/index.js")],
		env: { ...process.env, LEADCUT_USER_DATA_DIR: workspace, LEADCUT_ASR_ENGINE: engineDefault, LEADCUT_ASR_SCRIPT: "", LEADCUT_ASR_PYTHON: "" },
	}));
});
after(async () => {
	await client?.close();
	if (workspace) await fs.rm(workspace, { recursive: true, force: true });
});
async function call(name, args, expectError = false) {
	const result = await client.callTool({ name, arguments: args });
	const raw = result.content.map(item => item.text).join("\n");
	assert.equal(Boolean(result.isError), expectError, raw);
	return expectError ? raw : JSON.parse(raw);
}
async function fixture(name, source) {
	const project = path.join(workspace, `sample-${nextProject++}.leadcut`);
	const transcriptPath = path.join(workspace, `${name}.json`);
	const before = JSON.stringify(originalProject);
	await fs.writeFile(project, before);
	await fs.writeFile(transcriptPath, "\uFEFF" + JSON.stringify(source));
	const { revision } = await call("open_project", { project });
	return { before, project, arguments: { project, timelineModel, transcriptPath, expectedRevision: revision } };
}

test("imports faster-whisper seconds and keeps reviewed captions and unknown fields", async () => {
	const source = {
		modelPath: "/models/whisper", language: "en", audioPath: "/media/capture.mic.wav",
		startDelayMs: 1140, timeBasis: "source video seconds after supplied delay",
		segments: [
			{ start: 1.145, end: 1.875, text: " One two", words: [
				{ start: 1.145, end: 1.44, word: "One", probability: 0.92 },
				{ start: 1.44, end: 1.875, word: " two", probability: 0.83 },
			] },
			{ start: 4.75, end: 5.1, text: "Another", words: [] },
		],
	};
	const sample = await fixture("whisper", source);
	const preview = await call("set_transcript", sample.arguments);
	assert.equal(preview.engine, "faster-whisper");
	assert.equal(preview.segmentCount, 2);
	assert.equal(await fs.readFile(sample.project, "utf8"), sample.before);
	assert.equal((await call("get_transcript", { project: sample.project })).transcript, null);
	const saved = await call("set_transcript", { ...sample.arguments, dryRun: false });
	const { transcript, revision } = await call("get_transcript", { project: sample.project });
	assert.equal(revision, saved.revision);
	assert.equal(transcript.engine, "faster-whisper");
	assert.equal(transcript.timeBasis, "source");
	assert.equal(transcript.model, source.modelPath);
	assert.deepEqual(transcript.segments[0], {
		id: "segment-1", startMs: 1145, endMs: 1875, text: "One two",
		words: [
			{ text: "One", startMs: 1145, endMs: 1440, confidence: 0.92 },
			{ text: "two", startMs: 1440, endMs: 1875, leadingSpace: true, confidence: 0.83 },
		],
	});
	const filtered = await call("get_transcript", { project: sample.project, startMs: 2500, endMs: 4900 });
	assert.deepEqual(filtered.transcript.segments, transcript.segments.slice(1));
	assert.match(await call("get_transcript", { project: sample.project, startMs: 2500, endMs: 2400 }, true), /greater/);
	const { editor } = JSON.parse(await fs.readFile(sample.project, "utf8"));
	assert.deepEqual(editor.autoCaptions, [oldCaption]);
	assert.deepEqual(editor.future, { retain: true });
	assert.equal(await fs.readFile(saved.backupPath, "utf8"), sample.before);
});

test("preserves Qwen timing warnings, out-of-range words and zero-length words", async () => {
	const sample = await fixture("qwen", {
		backend: "qwen3-asr", modelPath: "qwen-model", complete: true, parameters: { language: "Chinese" },
		segments: [{ start: 2, end: 3.5, text: "甲 zero 尾", words: [
			{ start: 2, end: 2.5, word: "甲" },
			{ start: 2.7, end: 2.7, word: "zero", timingWarnings: ["non_positive_duration"] },
			{ start: 3.4, end: 3.6, word: "尾" },
		] }],
	});
	await call("set_transcript", { ...sample.arguments, dryRun: false });
	const { transcript } = await call("get_transcript", { project: sample.project });
	assert.equal(transcript.engine, "qwen3-asr");
	assert.equal(transcript.language, "Chinese");
	const words = transcript.segments[0].words;
	assert.equal(words[1].startMs, 2700);
	assert.equal(words[1].endMs, 2700);
	assert.equal(words[1].leadingSpace, true);
	assert.ok(words[1].flags.includes("timing-unreliable"));
	assert.ok(words[1].flags.includes("non_positive_duration"));
	assert.deepEqual(words[2].flags, ["timing-unreliable"]);
	assert.equal(words[2].endMs, 3600);
});

test("rejects unfinished transcripts and reports missing ASR configuration by engine", async () => {
	const sample = await fixture("unfinished", { backend: "qwen3-asr", complete: false, segments: [] });
	assert.match(await call("set_transcript", sample.arguments, true), /incomplete transcript/);
	assert.equal(await fs.readFile(sample.project, "utf8"), sample.before);
	const input = { audioPath: "sample.wav", outputPath: "sample.json" };
	assert.match(await call("transcribe_audio", input, true), /modelPath for faster-whisper/);
	assert.match(await call("transcribe_audio", { ...input, engine: "qwen3-asr" }, true), /LEADCUT_ASR_SCRIPT and LEADCUT_ASR_PYTHON/);
});
