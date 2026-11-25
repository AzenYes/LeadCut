import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import { USER_DATA_PATH } from "../../appPaths";
import { WHISPER_SMALL_MODEL_PATH } from "../constants";
import { getFfmpegBinaryPath, getFfprobeBinaryPath } from "../ffmpeg/binary";
import { getBundledWhisperExecutableCandidates } from "../paths/binaries";

const run = promisify(execFile);
const serverName = "leadcut-desktop";

function resolveAgentCli(agent: "codex" | "claude") {
	for (const directory of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
		const direct = path.join(directory, process.platform === "win32" ? `${agent}.exe` : agent);
		if (existsSync(direct)) return { command: direct, args: [], env: process.env };
		if (agent !== "codex") continue;
		const npmEntry = path.join(directory, "node_modules", "@openai", "codex", "bin", "codex.js");
		if (existsSync(npmEntry)) {
			return { command: process.execPath, args: [npmEntry], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } };
		}
	}
	return null;
}

export async function configureLeadCutAgent(agent: unknown) {
	if (agent !== "codex" && agent !== "claude") return { success: false, error: "invalid-agent" };
	const bundle = path.join(process.resourcesPath, "leadcut-mcp", "dist", "index.cjs");
	if (!app.isPackaged || !existsSync(bundle)) return { success: false, error: "bundle-unavailable" };
	const cli = resolveAgentCli(agent);
	if (!cli) return { success: false, error: "agent-unavailable" };
	try {
		const command = process.execPath;
		const args = [bundle];
		const env = {
			ELECTRON_RUN_AS_NODE: "1",
			LEADCUT_EXE: command,
			LEADCUT_USER_DATA_DIR: USER_DATA_PATH,
			FFMPEG_PATH: getFfmpegBinaryPath(),
			FFPROBE_PATH: getFfprobeBinaryPath(),
			WHISPER_CPP_PATH: getBundledWhisperExecutableCandidates().find(existsSync) ?? "",
			LEADCUT_WHISPER_MODEL_PATH: WHISPER_SMALL_MODEL_PATH,
		};
		const cliArgs = agent === "codex"
			? ["mcp", "add", serverName, ...Object.entries(env).flatMap(([key, value]) => ["--env", `${key}=${value}`]), "--", command, ...args]
			: ["mcp", "add-json", "--scope", "user", serverName, JSON.stringify({ type: "stdio", command, args, env })];
		await run(cli.command, [...cli.args, ...cliArgs], { env: cli.env, timeout: 15_000, windowsHide: true });
		return { success: true };
	} catch {
		return { success: false, error: "configuration-failed" };
	}
}
