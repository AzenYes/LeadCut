import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import type { CursorTelemetryPoint } from "../types";

const CHECKPOINT_INTERVAL_MS = 5000;
const PAUSE_MARGIN_MS = 2000;

type CursorJournalOptions = {
	directory: string;
	startTs: number;
	getSamples: () => readonly CursorTelemetryPoint[];
	getElapsedMs: () => number;
};

export function startCursorJournal({ directory, startTs, getSamples, getElapsedMs }: CursorJournalOptions) {
	return startTimedJournal(path.join(directory, `leadcut-cursor-journal-${startTs}.jsonl`), getSamples, getElapsedMs);
}

export function startTimedJournal<T extends { timeMs: number }>(
	journalPath: string, getSamples: () => readonly T[], getElapsedMs: () => number,
) {
	let stopped = false;
	let writtenSamples = 0;
	let writtenBytes = 0;
	let queue = Promise.resolve();

	const flush = () => {
		if (stopped) return queue;
		queue = queue
			.catch(() => undefined)
			.then(async () => {
				const samples = getSamples();
				const stableBeforeMs = getElapsedMs() - PAUSE_MARGIN_MS;
				let next = writtenSamples;
				while (next < samples.length && samples[next].timeMs <= stableBeforeMs) next++;
				if (next <= writtenSamples) return;

				const checkpoint =
					samples
						.slice(writtenSamples, next)
						.map((sample) => JSON.stringify(sample))
						.join("\n") + "\n";
				try {
					await fs.appendFile(journalPath, checkpoint, "utf8");
				} catch (error) {
					// Retrying an incomplete append must not duplicate its already-written prefix.
					try {
						await fs.truncate(journalPath, writtenBytes);
					} catch (truncateError) {
						if ((truncateError as NodeJS.ErrnoException).code !== "ENOENT")
							throw truncateError;
					}
					throw error;
				}
				writtenSamples = next;
				writtenBytes += Buffer.byteLength(checkpoint);
			});
		return queue;
	};

	const timer = setInterval(() => {
		void flush().catch((error) => console.warn("Could not checkpoint recording events", error));
	}, CHECKPOINT_INTERVAL_MS);
	timer.unref();

	return {
		journalPath,
		flush,
		async stop({ keepFile }: { keepFile: boolean }) {
			stopped = true;
			clearInterval(timer);
			await queue.catch(() => undefined);
			if (!keepFile) await fs.rm(journalPath, { force: true });
		},
	};
}

export function rebuildCursorTelemetryFromJournal(journalPath: string): Promise<CursorTelemetryPoint[]> {
	return readTimedJournal(journalPath, (entry): entry is CursorTelemetryPoint => {
		const sample = entry as Partial<CursorTelemetryPoint> | null;
		return !!sample && Number.isFinite(sample.timeMs) && Number.isFinite(sample.cx) && Number.isFinite(sample.cy);
	});
}

export async function readTimedJournal<T>(journalPath: string, valid: (sample: unknown) => sample is T): Promise<T[]> {
	const samples: T[] = [];
	const stream = createReadStream(journalPath, { encoding: "utf8" });
	const lines = createInterface({ input: stream, crlfDelay: Infinity });
	try {
		for await (const line of lines) {
			try {
				const sample: unknown = JSON.parse(line);
				if (valid(sample)) samples.push(sample);
			} catch (error) {
				// A sudden exit can leave the final JSON line incomplete.
				if (!(error instanceof SyntaxError)) throw error;
			}
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	} finally {
		lines.close();
		stream.destroy();
	}
	return samples;
}
