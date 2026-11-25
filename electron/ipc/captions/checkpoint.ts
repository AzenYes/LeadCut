import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { CaptionCue } from "../../../src/components/video-editor/types";

const CHECKPOINT_NAME = /^[0-9a-f]{64}\.json$/;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_OTHER_CHECKPOINTS = 7;

type CaptionCheckpoint = {
	nextWindow: number;
	usesFullJson: boolean;
	cues: CaptionCue[];
};

export async function createCaptionCheckpoint(directory: string, options: {
	audioPath: string;
	modelPath: string;
	executablePath: string;
	language: string;
	durationMs: number;
	windowMs: number;
	windowCount: number;
}) {
	try {
		const sources = await Promise.all(
			[options.audioPath, options.modelPath, options.executablePath].map(async file => {
				const stat = await fs.stat(file);
				return [file, stat.size, stat.mtimeMs];
			}),
		);
		const hash = createHash("sha256").update(JSON.stringify([1, options, sources])).digest("hex");
		const file = path.join(directory, `${hash}.json`);
		await fs.mkdir(directory, { recursive: true });
		const files = await fs.readdir(directory, { withFileTypes: true });
		const other = await Promise.all(files.filter(entry =>
			entry.isFile() && CHECKPOINT_NAME.test(entry.name) && entry.name !== path.basename(file),
		).map(async entry => {
			const file = path.join(directory, entry.name);
			return { file, modifiedAt: (await fs.stat(file).catch(() => null))?.mtimeMs ?? 0 };
		}));
		const cutoff = Date.now() - MAX_AGE_MS;
		other.sort((a, b) => b.modifiedAt - a.modifiedAt);
		await Promise.allSettled(other.filter((entry, index) => entry.modifiedAt < cutoff || index >= MAX_OTHER_CHECKPOINTS)
			.map(entry => fs.rm(entry.file, { force: true })));

		return {
			async read(): Promise<CaptionCheckpoint | null> {
				try {
					const stat = await fs.stat(file);
					if (Date.now() - stat.mtimeMs > MAX_AGE_MS || stat.size > 16 * 1024 * 1024) return null;
					const saved = JSON.parse(await fs.readFile(file, "utf8")) as CaptionCheckpoint;
					if (!Number.isSafeInteger(saved.nextWindow) || saved.nextWindow < 1 ||
						saved.nextWindow > options.windowCount || typeof saved.usesFullJson !== "boolean" ||
						!Array.isArray(saved.cues) || !saved.cues.every(cue => cue && typeof cue.text === "string" &&
							Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs))) return null;
					return saved;
				} catch {
					return null;
				}
			},
			async save(checkpoint: CaptionCheckpoint) {
				const temporary = path.join(directory, `.${hash}-${randomUUID()}.tmp`);
				try {
					await fs.writeFile(temporary, JSON.stringify(checkpoint), { encoding: "utf-8", mode: 0o600, flag: "wx" });
					await fs.rename(temporary, file);
				} catch {
					// Transcription can continue if checkpoint storage is unavailable.
				} finally {
					await fs.rm(temporary, { force: true }).catch(() => undefined);
				}
			},
			async clear() {
				await fs.rm(file, { force: true }).catch(() => undefined);
			},
		};
	} catch {
		return null;
	}
}
