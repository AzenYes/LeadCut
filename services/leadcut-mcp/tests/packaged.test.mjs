import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const executable = process.env.LEADCUT_PACKAGED_SMOKE_EXE;

test("packaged LeadCut serves MCP and exports an edited recording without external tools on PATH", {
	skip: !executable,
	timeout: 180_000,
}, async () => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-packaged-mcp-"));
	const resources = path.join(path.dirname(executable), "resources");
	const binaries = path.join(resources, "app.asar.unpacked", "node_modules");
	const mediaTools = path.join(resources, "media-tools");
	const sharedRuntime = existsSync(mediaTools);
	const client = new Client({ name: "packaged-smoke", version: "1" });
	try {
		const bundle = path.join(resources, "leadcut-mcp", "dist", "index.cjs");
		await client.connect(new StdioClientTransport({
			command: executable,
			args: [bundle],
			env: {
				...process.env,
				PATH: path.join(process.env.SystemRoot ?? "C:\\Windows", "System32"),
				ELECTRON_RUN_AS_NODE: "1",
				LEADCUT_EXE: executable,
				LEADCUT_USER_DATA_DIR: profile,
				FFMPEG_PATH: sharedRuntime ? path.join(mediaTools, "ffmpeg.exe") : path.join(binaries, "ffmpeg-static", "ffmpeg.exe"),
				FFPROBE_PATH: sharedRuntime ? path.join(mediaTools, "ffprobe.exe") : path.join(binaries, "ffprobe-static", "bin", "win32", "x64", "ffprobe.exe"),
			},
		}));
		async function call(name, args) {
			const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 150_000 });
			assert.notEqual(result.isError, true, result.content.map(item => item.text).join("\n"));
			return JSON.parse(result.content[0].text);
		}
		const version = JSON.parse(await fs.readFile("../../package.json", "utf8")).version;
		assert.equal(client.getServerVersion()?.version, version);
		const { projectsDir } = await call("get_paths", {});
		await fs.mkdir(projectsDir, { recursive: true });
		const project = path.join(projectsDir, "Packaged smoke.leadcut");
		await fs.writeFile(project, JSON.stringify({
			version: 2,
			videoPath: path.resolve("../../tests/ui/fixtures/waveform.mp4"),
			editor: { clipRegions: [{ id: "take", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 }] },
		}));
		assert.equal((await call("list_projects", {}))[0].path, project);
		const { revision } = await call("get_revision", { project });
		const cut = await call("cut_ranges", {
			project, expectedRevision: revision, timelineModel: "leadcut-sequence-v1",
			timeBasis: "timeline", ranges: [{ startMs: 2000, endMs: 3000 }], dryRun: false,
		});
		assert.equal(cut.outputDurationMs, 5000);
		const outputPath = path.join(profile, "rendered.mp4");
		const result = await call("export_project", { project, outputPath, fps: 30, timeoutSec: 120 });
		assert.equal(result.frameCount, 150);
		assert.ok((await fs.stat(outputPath)).size > 1000);
	} finally {
		await client.close();
		await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	}
});
