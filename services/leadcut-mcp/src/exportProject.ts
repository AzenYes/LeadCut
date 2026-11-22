import { spawn } from "node:child_process";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readProjectSnapshot, reply } from "./mutation.js";
import { getProjectMediaReferences, relinkProjectMedia } from "./projectRelinkModel.js";
import { resolveProjectMediaPath } from "./projectStore.js";

const exportArguments = {
	project: z.string().min(1),
	outputPath: z.string().min(1),
	quality: z.enum(["source", "1080p", "1440p", "2160p"]).optional(),
	fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).optional(),
	timeoutSec: z.number().int().min(1).max(43_200).default(1800),
};
const reportSchema = z.object({
	success: z.literal(true),
	outputPath: z.string().min(1),
	durationMs: z.number().positive(),
	frameCount: z.number().int().positive(),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	frameRate: z.number().positive(),
	bitrate: z.number().positive(),
	encoderName: z.string().min(1),
	route: z.enum(["ffmpeg", "webcodecs"]),
});
type ExportArguments = z.output<z.ZodObject<typeof exportArguments>>;

async function readReport(reportPath: string) {
	try {
		return JSON.parse(await fs.readFile(reportPath, "utf8")) as unknown;
	} catch (error) {
		if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

export async function exportProject(args: ExportArguments) {
	const executable = process.env.LEADCUT_EXE;
	if (!executable) throw new Error("Set LEADCUT_EXE to the installed LeadCut executable before exporting.");
	if (!path.isAbsolute(executable) || !(await fs.stat(executable).catch(() => null))?.isFile()) {
		throw new Error("LEADCUT_EXE must be an absolute path to the installed LeadCut executable.");
	}
	const { file, project } = await readProjectSnapshot(args.project);
	const output = path.resolve(args.outputPath);
	if (path.extname(output).toLowerCase() !== ".mp4") throw new Error("outputPath must end in .mp4.");
	const exists = await fs.lstat(output).then(() => true, error => {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		return false;
	});
	if (exists) throw new Error(`The output path already exists: ${output}`);
	const workspace = await fs.mkdtemp(path.join(path.dirname(output), ".leadcut-export-"));
	const temporaryOutput = path.join(workspace, "output.mp4");
	let child: ReturnType<typeof spawn> | undefined;
	let exited: Promise<void> | undefined;
	let didExit = false;
	let launchError: Error | undefined;
	let diagnostics = "";
	try {
		const projectCopy = path.join(workspace, path.basename(file));
		const replacements = Object.fromEntries(getProjectMediaReferences(project).map(({ path }) =>
			[path, resolveProjectMediaPath(file, path)]));
		await fs.writeFile(projectCopy, JSON.stringify(relinkProjectMedia(project, replacements)), "utf8");
		const appDirectory = process.env.LEADCUT_EXPORT_DEV_APP;
		child = spawn(executable, appDirectory ? [path.resolve(appDirectory)] : [], {
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				LEADCUT_EXPORT: "1",
				LEADCUT_EXPORT_PROJECT: projectCopy,
				LEADCUT_EXPORT_OUTPUT: temporaryOutput,
				LEADCUT_EXPORT_QUALITY: args.quality ?? "source",
				LEADCUT_EXPORT_FPS: String(args.fps ?? 30),
				LEADCUT_USER_DATA_DIR: path.join(workspace, "profile"),
			},
		});
		exited = new Promise<void>((resolve) => child?.once("close", () => { didExit = true; resolve(); }));
		child.once("error", error => { launchError = error; });
		child.stdout?.resume();
		child.stderr?.on("data", (chunk) => { diagnostics = (diagnostics + String(chunk)).slice(-1500); });
		const deadline = Date.now() + args.timeoutSec * 1000;
		const reportPath = `${temporaryOutput}.report.json`;
		while (true) {
			if (launchError) throw launchError;
			const raw = await readReport(reportPath);
			if (raw !== undefined) {
				const failure = z.object({ success: z.literal(false), error: z.string().optional() }).safeParse(raw);
				if (failure.success) throw new Error(`LeadCut export failed: ${failure.data.error ?? "Unknown error"}`);
				const { success: _, ...report } = reportSchema.parse(raw);
				if (path.relative(temporaryOutput, report.outputPath) !== "") {
					throw new Error("LeadCut reported an unexpected output path.");
				}
				const expected = Math.ceil(report.durationMs * report.frameRate / 1000);
				if (Math.abs(report.frameCount - expected) > 2) {
					throw new Error(`LeadCut rendered ${report.frameCount} frames, expected about ${expected}.`);
				}
				const stat = await fs.stat(temporaryOutput).catch(() => null);
				if (!stat?.isFile() || stat.size <= 0) throw new Error("LeadCut produced no video file.");
				try {
					await fs.link(temporaryOutput, output);
				} catch (error) {
					const code = (error as NodeJS.ErrnoException).code;
					if (!code || !["EPERM", "ENOSYS", "ENOTSUP", "EXDEV", "EACCES"].includes(code)) throw error;
					await fs.copyFile(temporaryOutput, output, constants.COPYFILE_EXCL);
				}
				return { ...report, outputPath: output };
			}
			if (didExit) throw new Error(`LeadCut exited without an export report. ${diagnostics}`.trim());
			if (Date.now() >= deadline) throw new Error(`LeadCut export timed out after ${args.timeoutSec} seconds. ${diagnostics}`.trim());
			await delay(150);
		}
	} finally {
		if (child && !didExit) {
			// Give Chromium a chance to finish writing the report and close its profile.
			await Promise.race([exited, delay(600)]);
			if (!didExit) child.kill();
			await Promise.race([exited, delay(1000)]);
		}
		await fs.rm(workspace, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 }).catch(() => undefined);
	}
}

export function registerExportProjectTool(server: McpServer) {
	server.tool("export_project", "Export an isolated project copy using LeadCut’s MP4 export pipeline.", exportArguments,
		async (args) => reply(await exportProject(args)));
}
