import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mutate, readProjectSnapshot, reply } from "./mutation.js";
import { TIMELINE_MODEL } from "./sequence.js";
import { normalizeTranscript, parseExternalTranscript } from "./transcriptModel.js";

const run = promisify(execFile);
const engineArg = z.enum(["faster-whisper", "qwen3-asr"]);
const time = z.number().int().finite().nonnegative();
const projectArg = z.string().min(1);

async function audioStartDelay(audioPath: string, supplied?: number): Promise<number> {
	if (supplied !== undefined) return supplied;
	try {
		const contents = await fs.readFile(`${audioPath}.json`, "utf8");
		const delay: unknown = JSON.parse(contents.replace(/^\uFEFF/, "")).startDelayMs ?? 0;
		if (typeof delay !== "number" || !Number.isFinite(delay)) throw new Error("Invalid audio startDelayMs.");
		return delay;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		return 0;
	}
}

function qwenLanguage(language: string) {
	return /^[a-z]{2,3}(?:-[a-z\d]+)*$/iu.test(language)
		? new Intl.DisplayNames(["en"], { type: "language" }).of(new Intl.Locale(language).language) ?? language
		: language;
}

export function registerTranscriptionTools(server: McpServer) {
	server.tool("transcribe_audio",
		"Run local word-timestamp ASR using preinstalled weights. Uses LEADCUT_ASR_ENGINE or faster-whisper by default. Output is source video seconds with microphone delay applied once.",
		{
			audioPath: z.string().min(1),
			modelPath: z.string().min(1).optional().describe("Required local model directory for faster-whisper. Qwen can use its configured model."),
			outputPath: z.string().min(1),
			language: z.string().trim().min(1).optional(),
			device: z.enum(["cpu", "cuda", "auto"]).default("auto"),
			startDelayMs: z.number().finite().optional(),
			engine: engineArg.optional(),
		}, async ({ audioPath, modelPath, outputPath, language, device, startDelayMs, engine }) => {
			const selected = engineArg.parse(engine ?? process.env.LEADCUT_ASR_ENGINE ?? "faster-whisper");
			const qwen = selected === "qwen3-asr";
			const script = qwen ? process.env.LEADCUT_ASR_SCRIPT : fileURLToPath(new URL("../scripts/transcribe.py", import.meta.url));
			const python = qwen ? process.env.LEADCUT_ASR_PYTHON : process.env.PYTHON_PATH ?? "python";
			if (!script || !python) throw new Error("Configure LEADCUT_ASR_SCRIPT and LEADCUT_ASR_PYTHON for qwen3-asr.");
			if (!qwen && !modelPath) throw new Error("Supply modelPath for faster-whisper.");
			const delay = await audioStartDelay(audioPath, startDelayMs);
			const locale = qwen ? qwenLanguage(language ?? "Chinese") : language ?? "zh";
			const { stdout } = await run(python, [
				"-X", "utf8", path.resolve(script), "--audio", path.resolve(audioPath),
				"--output", path.resolve(outputPath), "--delay-ms", String(delay),
				"--language", locale, "--device", device,
				...(modelPath ? ["--model-path", path.resolve(modelPath)] : []),
			], { windowsHide: true, maxBuffer: 1024 * 1024, timeout: 3600000 });
			return reply({ result: stdout.trim(), engine: selected, startDelayMs: delay, timeBasis: "source video seconds; delay already included" });
		},
	);
	server.tool("set_transcript",
		"Import faster-whisper or Qwen3-ASR JSON as a source-millisecond project transcript. Updates the reference transcript while preserving existing subtitle edits.",
		{
			project: projectArg, timelineModel: z.literal(TIMELINE_MODEL),
			transcriptPath: z.string().min(1), dryRun: z.boolean().default(true), expectedRevision: z.string().optional(),
		}, async ({ project, transcriptPath, dryRun, expectedRevision }) =>
			mutate(project, dryRun, expectedRevision, async data => {
				const transcript = parseExternalTranscript(await fs.readFile(path.resolve(transcriptPath), "utf8"));
				if (!transcript) throw new Error("Invalid or incomplete transcript. Choose completed faster-whisper or Qwen3-ASR JSON.");
				const words = transcript.segments.reduce((total, segment) => total + segment.words.length, 0);
				return {
					project: { ...data, editor: { ...data.editor, transcript } },
					engine: transcript.engine,
					segmentCount: transcript.segments.length,
					wordCount: words,
					timeBasis: "source",
				};
			}),
	);
	server.tool("get_transcript",
		"Read the project reference transcript in source milliseconds. An optional half-open range returns intersecting segments.",
		{ project: projectArg, startMs: time.optional(), endMs: time.optional() },
		async ({ project, startMs, endMs }) => {
			if (startMs !== undefined && endMs !== undefined && endMs <= startMs) {
				throw new Error("endMs must be greater than startMs.");
			}
			const { file, project: data, revision } = await readProjectSnapshot(project);
			const transcript = normalizeTranscript(data.editor.transcript);
			const filtered = transcript && (startMs !== undefined || endMs !== undefined)
				? { ...transcript, segments: transcript.segments.filter(segment =>
					segment.startMs < (endMs ?? Infinity) && segment.endMs > (startMs ?? -Infinity),
				) }
				: transcript;
			return reply({ project: file, revision, transcript: filtered });
		},
	);
}
