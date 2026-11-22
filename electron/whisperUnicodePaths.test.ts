import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it.skipIf(process.platform !== "win32")("bundled Whisper handles a Chinese model path without a native crash", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-whisper-unicode-"));
	try {
		const modelPath = path.join(root, "模型目录", "不存在.bin");
		const audioPath = path.join(root, "audio.wav");
		await fs.writeFile(audioPath, Buffer.alloc(44));
		const result = spawnSync(path.resolve("electron/native/bin/win32-x64/whisper-cli.exe"), ["-m", modelPath, "-f", audioPath], { encoding: "utf8", windowsHide: true, timeout: 10000 });
		// Loading a missing model should report a normal error, not fail-fast
		// (0xC0000409) while converting the ANSI model argument into UTF-8.
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(3);
		expect(result.stderr).toContain(modelPath);
		expect(result.stderr).toContain("failed to open");
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});
