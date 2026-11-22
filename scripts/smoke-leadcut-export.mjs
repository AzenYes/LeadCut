import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

function readTimeout(fallback) {
	const timeout = Number(process.env.LEADCUT_SMOKE_EXPORT_TIMEOUT_MS);
	return Number.isSafeInteger(timeout) && timeout > 0 ? timeout : fallback;
}

export async function runSmokeExport({
	executable,
	args = [],
	projectPath,
	outputPath,
	logPath,
	profile,
	timeoutMs = readTimeout(60000),
	quality = "1080p",
	fps = 30,
	legacyEnvironment = false,
}) {
	const reportPath = `${outputPath}.report.json`;
	const smokeSettings = {
		LEADCUT_SMOKE_EXPORT: "1",
		LEADCUT_SMOKE_EXPORT_PROJECT: projectPath,
		LEADCUT_SMOKE_EXPORT_OUTPUT: outputPath,
		LEADCUT_SMOKE_EXPORT_PIPELINE: "modern",
		LEADCUT_SMOKE_EXPORT_BACKEND: "webcodecs",
		LEADCUT_SMOKE_EXPORT_RENDER_BACKEND: "webgl",
		LEADCUT_SMOKE_EXPORT_QUALITY: quality,
		LEADCUT_SMOKE_EXPORT_FPS: String(fps),
	};
	const legacySettings = legacyEnvironment
		? Object.fromEntries(Object.entries(smokeSettings).map(([key, value]) => [key.replace(/^LEADCUT_/, "RECORDLY_"), value]))
		: {};
	const child = spawn(executable, args, {
		windowsHide: true,
		env: {
			...process.env,
			...(profile ? { LEADCUT_USER_DATA_DIR: profile } : {}),
			...smokeSettings,
			...legacySettings,
		},
	});
	let processError;
	child.on("error", (error) => {
		processError = error;
	});
	const log = fs.createWriteStream(logPath);
	child.stdout.pipe(log, { end: false });
	child.stderr.pipe(log, { end: false });
	try {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (processError) throw processError;
			if (fs.existsSync(reportPath)) {
				let report;
				try {
					report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
				} catch (error) {
					if (!(error instanceof SyntaxError)) throw error;
				}
				if (report) {
					if (!report.success)
						throw new Error(
							`Export failed: ${report.phase ?? "unknown"} ${report.error ?? ""}. See ${logPath}`,
						);
					if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000)
						throw new Error("Missing exported video");
					return report;
				}
			}
			if (child.exitCode !== null)
				throw new Error(
					`App exited before export report: ${child.exitCode}. See ${logPath}`,
				);
			await delay(500);
		}
		throw new Error(`Export report was not created within ${timeoutMs} ms. See ${logPath}`);
	} finally {
		if (child.exitCode === null) child.kill();
		log.end();
	}
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	const root = process.cwd();
	const projectPath = path.join(root, ".tmp", "自定义工程目录", "字幕测试.leadcut");
	const outputPath = path.join(root, ".tmp", "waveform-caption-export.mp4");
	fs.mkdirSync(path.dirname(projectPath), { recursive: true });
	fs.rmSync(outputPath, { force: true });
	fs.rmSync(`${outputPath}.report.json`, { force: true });
	fs.writeFileSync(
		projectPath,
		JSON.stringify({
			version: 2,
			projectId: randomUUID(),
			videoPath: path.join(root, "tests", "ui", "fixtures", "waveform.mp4"),
			editor: {
				clipRegions: [{ id: "clip-1", startMs: 0, endMs: 6000, speed: 1 }],
				autoCaptions: [
					{ id: "caption-1", startMs: 0, endMs: 6000, text: "阿真 字幕描边投影测试" },
				],
				autoCaptionSettings: {
					enabled: true,
					fontFamily: "Microsoft YaHei",
					fontSize: 50,
					fontWeight: "bold",
					textColor: "#FFFFFF",
					backgroundOpacity: 0,
					animationStyle: "none",
					strokeWidth: 3,
					strokeColor: "#000000",
					shadowEnabled: true,
					shadowColor: "#000000",
					shadowOpacity: 0.7,
					shadowBlur: 8,
					shadowOffsetX: 2,
					shadowOffsetY: 4,
				},
				aspectRatio: "16:9",
				shadowIntensity: 0,
				showCursor: false,
			},
		}),
		"utf8",
	);
	const executable =
		process.env.LEADCUT_RELEASE_SMOKE_EXE ||
		path.join(root, "release", "win-unpacked", "LeadCut.exe");
	const report = await runSmokeExport({
		executable,
		args: path.basename(executable).toLowerCase() === "electron.exe" ? [root] : [],
		projectPath,
		outputPath,
		logPath: path.join(root, ".tmp", "leadcut-export-smoke.log"),
	});
	console.log(
		JSON.stringify({
			success: report.success,
			phase: report.phase,
			outputPath: report.outputPath,
			frames: report.metrics?.frameCount,
		}),
	);
	console.log("Packaged launch and caption export passed");
}
