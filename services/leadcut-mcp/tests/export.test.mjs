import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const fakeApp = `
import fs from "node:fs/promises";
import path from "node:path";
if (process.env.LEADCUT_EXPORT === "1") {
  const outputPath = process.env.LEADCUT_EXPORT_OUTPUT;
  const projectPath = process.env.LEADCUT_EXPORT_PROJECT;
  const profilePath = process.env.LEADCUT_USER_DATA_DIR;
  const project = JSON.parse(await fs.readFile(projectPath, "utf8"));
  await fs.mkdir(profilePath);
  await fs.writeFile(process.env.LEADCUT_FAKE_EVIDENCE, JSON.stringify({ projectPath, profilePath, project,
    outputPath, quality: process.env.LEADCUT_EXPORT_QUALITY, fps: process.env.LEADCUT_EXPORT_FPS }));
  const fakeMode = process.env.LEADCUT_FAKE_TEST_MODE;
  if (fakeMode === "timeout") { setInterval(() => {}, 1000); }
  else {
    await fs.writeFile(outputPath, "test media");
    const report = fakeMode === "fail" ? { success: false, error: "simulated encoder failure" }
      : { success: true, outputPath, durationMs: 1000, frameCount: fakeMode === "wrong-frames" ? 20 : Number(process.env.LEADCUT_EXPORT_FPS),
        width: 1920, height: 1080, frameRate: Number(process.env.LEADCUT_EXPORT_FPS), bitrate: 8000000,
        encoderName: "h264_nvenc", route: "ffmpeg" };
    await fs.writeFile(outputPath + ".report.json", JSON.stringify(report));
  }
}
`;

async function fixture(context, fakeMode, configured = true) {
	const work = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-mcp-export-test-"));
	const source = path.join(work, "project.leadcut");
	const output = path.join(work, "movie.mp4");
	const fake = path.join(work, "fake.mjs");
	const evidence = path.join(work, "evidence.json");
	const client = new Client({ name: "export-test", version: "1" });
	context.after(async () => { await client.close(); await fs.rm(work, { recursive: true, force: true }); });
	const original = JSON.stringify({ version: 2, videoPath: "screen.mp4", editor: { webcam: { sourcePath: "camera.webm" } } });
	await fs.writeFile(source, original);
	await fs.writeFile(fake, fakeApp);
	const env = {
		...process.env, NODE_OPTIONS: `--import=${pathToFileURL(fake).href}`,
		LEADCUT_EXE: configured ? process.execPath : "",
		LEADCUT_FAKE_TEST_MODE: fakeMode,
		LEADCUT_FAKE_EVIDENCE: evidence,
		LEADCUT_EXPORT: "0", LEADCUT_EXPORT_DEV_APP: "",
	};
	await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve("dist/index.js")], env }));
	const call = extra => client.callTool({ name: "export_project", arguments: { project: source, outputPath: output, ...extra } });
	return { work, source, output, evidence, original, call };
}

test("export_project uses an isolated copy and returns the encoder and output properties", async context => {
	const { work, source, output, evidence, original, call } = await fixture(context, "success");
	const reply = await call({ quality: "1080p", fps: 60 });
	assert.equal(reply.isError, undefined, reply.content[0].text);
	assert.deepEqual(JSON.parse(reply.content[0].text), {
		outputPath: output, durationMs: 1000, frameCount: 60, width: 1920, height: 1080,
		frameRate: 60, bitrate: 8000000, encoderName: "h264_nvenc", route: "ffmpeg",
	});
	const seen = JSON.parse(await fs.readFile(evidence, "utf8"));
	assert.equal(seen.quality, "1080p");
	assert.equal(seen.fps, "60");
	assert.equal(seen.project.videoPath, path.join(work, "screen.mp4"));
	assert.equal(seen.project.editor.webcam.sourcePath, path.join(work, "camera.webm"));
	assert.equal(path.dirname(seen.profilePath), path.dirname(seen.projectPath));
	assert.equal(path.dirname(seen.outputPath), path.dirname(seen.projectPath));
	await assert.rejects(fs.stat(seen.profilePath), { code: "ENOENT" });
	assert.equal(await fs.readFile(source, "utf8"), original);
	assert.equal(await fs.readFile(output, "utf8"), "test media");
	const duplicate = await call({});
	assert.equal(duplicate.isError, true);
	assert.match(duplicate.content[0].text, /already exists/);
});

for (const [mode, message] of [
	["fail", /simulated encoder failure/], ["timeout", /timed out after 2 seconds/],
	["wrong-frames", /rendered 20 frames, expected about 30/], ["missing", /Set LEADCUT_EXE/],
]) {
	test(`export_project reports ${mode} and leaves no partial output`, async context => {
		const { work, output, call } = await fixture(context, mode, mode !== "missing");
		const reply = await call({ timeoutSec: 2 });
		assert.equal(reply.isError, true);
		assert.match(reply.content[0].text, message);
		await assert.rejects(fs.stat(output), { code: "ENOENT" });
		assert.equal((await fs.readdir(work)).some(name => name.startsWith(".leadcut-export-")), false);
	});
}
