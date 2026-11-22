import fs from "node:fs";
import type { ChildProcess } from "node:child_process";
import asyncFs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { inspect } from "node:util";
import { USER_DATA_PATH } from "./appPaths";

export type AppLogLevel = "info" | "warn" | "error";
export const APP_LOG_DIRECTORY = path.join(USER_DATA_PATH, "logs");
export const LAST_EXPORT_FAILURE_FILE = "last-export-failure.json";
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_PENDING_LINES = 1024;
const MAX_DETAIL_CHARS = 8192;

type Line = { data: Buffer; exportFailure: boolean };
type Append = { offset: number; line: Line };

function homePathPattern(home: string) {
	if (!home) return null;
	const parts = home.split(/[\\/]/).map(segment => segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	const pattern = parts.join("[\\\\/]+");
	return new RegExp(pattern, process.platform === "win32" ? "gi" : "g");
}

export function redactHomePaths(text: string, home = homedir()) {
	const pattern = homePathPattern(home);
	return pattern ? text.replace(pattern, "~") : text;
}

export function createAppLogger(directory: string, { maxBytes = MAX_LOG_BYTES, home = homedir() } = {}) {
	const file = path.join(directory, "leadcut.log");
	const exportFailureFile = path.join(directory, LAST_EXPORT_FAILURE_FILE);
	const pattern = homePathPattern(home);
	const redact = (text: string) => pattern ? text.replace(pattern, "~") : text;
	const pending: Line[] = [];
	let size: number | null = null;
	let generation = 0;
	let active: Append | null = null;
	let draining: Promise<void> | null = null;

	function prepare(line: Line): Append {
		if (size === null) {
			fs.mkdirSync(directory, { recursive: true });
			fs.closeSync(fs.openSync(file, "a"));
			size = fs.statSync(file).size;
		}
		if (size > 0 && size + line.data.length > maxBytes) {
			fs.rmSync(`${file}.2`, { force: true });
			if (fs.existsSync(`${file}.1`)) fs.renameSync(`${file}.1`, `${file}.2`);
			fs.renameSync(file, `${file}.1`);
			fs.closeSync(fs.openSync(file, "a"));
			size = 0;
		}
		return { offset: size, line };
	}

	function finish({ offset, line }: Append) {
		size = offset + line.data.length;
		if (line.exportFailure) {
			try { fs.writeFileSync(exportFailureFile, line.data); }
			catch { /* Keep the original export failure in the rolling log. */ }
		}
	}

	function failedWrite(plan: Append | null) {
		size = null;
		// If a disk filled partway through an append, retain the earlier complete lines.
		if (plan) {
			try { fs.truncateSync(file, plan.offset); }
			catch { /* Unavailable storage cannot be repaired by the logger. */ }
		}
	}

	async function drain() {
		const run = generation;
		while (pending.length && run === generation) {
			const line = pending.shift()!;
			try {
				const plan = prepare(line);
				active = plan;
				const handle = await asyncFs.open(file, "r+");
				try {
					let written = 0;
					while (written < line.data.length && run === generation) {
						const result = await handle.write(line.data, written, line.data.length - written, plan.offset + written);
						if (result.bytesWritten === 0) throw new Error("Log write made no progress.");
						written += result.bytesWritten;
					}
				} finally {
					await handle.close();
				}
				if (run === generation) finish(plan);
			} catch {
				if (run === generation) failedWrite(active);
			} finally {
				if (run === generation) active = null;
			}
		}
	}

	function schedule() {
		if (draining || !pending.length) return;
		draining = Promise.resolve().then(drain).finally(() => {
			draining = null;
			schedule();
		});
	}

	function writeSync(plan: Append) {
		const { offset, line } = plan;
		const fd = fs.openSync(file, "r+");
		try {
			let written = 0;
			while (written < line.data.length) {
				const count = fs.writeSync(fd, line.data, written, line.data.length - written, offset + written);
				if (count === 0) throw new Error("Log write made no progress.");
				written += count;
			}
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
		finish(plan);
	}

	return {
		log(level: AppLogLevel, scope: string, message: string, detail?: unknown) {
			try {
				if (pending.length >= MAX_PENDING_LINES) return;
				const description = detail === undefined ? undefined : typeof detail === "string" ? detail :
					inspect(detail, { depth: 4, maxArrayLength: 30, maxStringLength: MAX_DETAIL_CHARS, customInspect: false });
				const data = Buffer.from(JSON.stringify({
					timestamp: new Date().toISOString(),
					level,
					scope: redact(scope).slice(0, 100),
					message: redact(message).slice(0, MAX_DETAIL_CHARS),
					...(description === undefined ? {} : { detail: redact(description).slice(0, MAX_DETAIL_CHARS) }),
				}) + "\n");
				pending.push({ data, exportFailure: level === "error" && scope === "export" });
				schedule();
			} catch { /* Logging cannot interrupt the operation being reported. */ }
		},
		async flush() {
			while (draining) await draining;
		},
		flushSync() {
			generation++;
			// Write at the reserved offset so a concurrent kernel write of the same
			// line cannot duplicate it. The asynchronous drain stops at its next await.
			let plan = active;
			active = null;
			try {
				if (plan) writeSync(plan);
				while (pending.length) {
					plan = null;
					plan = prepare(pending.shift()!);
					writeSync(plan);
				}
			} catch {
				failedWrite(plan);
				pending.length = 0;
			}
		},
	};
}

const logger = createAppLogger(APP_LOG_DIRECTORY);
export const appLog = logger.log;
export const flushAppLog = logger.flush;
export const flushAppLogSync = logger.flushSync;

export function logSubprocessStderr(child: ChildProcess, scope: string) {
	if (!child.stderr) return;
	const decoder = new StringDecoder("utf8");
	let stderr = "";
	child.stderr.on("data", (chunk: Buffer) => {
		stderr = (stderr + decoder.write(chunk)).slice(-65536);
	});
	child.once("close", (code, signal) => {
		const tail = (stderr + decoder.end()).split(/[\r\n]+/)
			.map(line => line.trim())
			.filter(line => line && !/^(?:frame|fps|stream_\S+|bitrate|total_size|out_time\w*|dup_frames|drop_frames|speed|progress)\s*=/.test(line))
			.slice(-50).join("\n").slice(-MAX_DETAIL_CHARS);
		if (!tail && code === 0) return;
		appLog(code && !signal ? "warn" : "info", scope,
			`Process exited (${signal ?? code ?? "unknown"}).`, tail || undefined);
	});
}

function consoleLogDetail(argument: unknown) {
	if (!(argument instanceof SyntaxError)) return argument;
	// A malformed JSON payload can include user-authored text in a parse error.
	const frames = argument.stack?.match(/^\s+at .*$/gm) ?? [];
	return ["SyntaxError", ...frames].join("\n");
}

let consoleWrapped = false;
export function installMainConsoleLogging() {
	if (consoleWrapped) return;
	consoleWrapped = true;
	for (const [method, level] of [["log", "info"], ["warn", "warn"], ["error", "error"]] as const) {
		const original = console[method].bind(console);
		console[method] = (first: unknown, ...rest: unknown[]) => {
			const argumentIsMessage = typeof first === "string";
			appLog(level, "main", argumentIsMessage ? first : method,
				argumentIsMessage ? (rest.length ? rest.map(consoleLogDetail) : undefined) :
					[first, ...rest].map(consoleLogDetail));
			original(first, ...rest);
		};
	}
}
