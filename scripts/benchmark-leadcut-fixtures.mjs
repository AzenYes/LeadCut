import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import ffmpeg from "ffmpeg-static";

const exec = promisify(execFile);
const entry = fileURLToPath(import.meta.url);
export const repoRoot = path.resolve(path.dirname(entry), "..");
export const benchmarkRoot = path.join(repoRoot, ".tmp", "bench");
const frameRate = 30;

export function parseFixtureOptions(args = process.argv.slice(2)) {
	const { values } = parseArgs({
		args,
		options: {
			size: { type: "string", default: "smoke" },
			captions: { type: "string", default: "1000" },
			clips: { type: "string", default: "200" },
		},
	});
	const captions = Number(values.captions);
	const clips = Number(values.clips);
	if (!["smoke", "10min", "all"].includes(values.size))
		throw new Error("Use --size smoke, 10min, or all");
	if (!Number.isSafeInteger(captions) || captions < 1)
		throw new Error("Caption count must be a positive integer");
	if (!Number.isSafeInteger(clips) || clips < 1)
		throw new Error("Clip count must be a positive integer");
	return { size: values.size, captions, clips };
}

async function createMediaFile(filePath, inputArgs) {
	if ((await fs.stat(filePath).catch(() => null))?.size) return;
	const ext = path.extname(filePath);
	const temporary = `${filePath.slice(0, -ext.length)}.${randomUUID()}.partial${ext}`;
	try {
		await exec(
			ffmpeg,
			["-nostdin", "-hide_banner", "-loglevel", "error", ...inputArgs, temporary],
			{
				windowsHide: true,
				maxBuffer: 2 * 1024 * 1024,
			},
		);
		await fs.rename(temporary, filePath);
	} finally {
		await fs.rm(temporary, { force: true });
	}
}

async function createFixture({ name, durationSeconds, width, height }, { captions, clips, projectExtension = "leadcut" }) {
	const directory = path.join(benchmarkRoot, name);
	await fs.mkdir(directory, { recursive: true });
	const source = path.join(directory, `${name}.mp4`);
	const mic = path.join(directory, `${name}.mic.wav`);
	const duration = String(durationSeconds);
	await createMediaFile(source, [
		"-f",
		"lavfi",
		"-i",
		`testsrc2=size=${width}x${height}:rate=${frameRate}`,
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=600:sample_rate=48000",
		"-t",
		duration,
		"-c:v",
		"libx264",
		"-preset",
		"ultrafast",
		"-crf",
		"26",
		"-g",
		"60",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-movflags",
		"+faststart",
	]);
	await createMediaFile(mic, [
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=440:sample_rate=16000",
		"-t",
		duration,
		"-c:a",
		"pcm_s16le",
	]);
	await fs.writeFile(`${mic}.json`, JSON.stringify({ startDelayMs: 120 }));
	const project = path.join(directory, `${name}-${captions}captions-${clips}clips.${projectExtension}`);
	if (!(await fs.stat(project).catch(() => null))?.size) {
		const durationMs = durationSeconds * 1000;
		const firstClipEnd = Math.min(6000, Math.floor(durationMs / 3));
		if (captions > durationMs || clips - 1 > durationMs - firstClipEnd) {
			throw new Error("Too many caption or clip boundaries for the fixture duration");
		}
		const clipBoundary = (index) =>
			index === 0
				? 0
				: clips === 1
					? durationMs
					: Math.round(
							firstClipEnd +
								((index - 1) * (durationMs - firstClipEnd)) / (clips - 1),
						);
		const editor = {
			clipRegions: Array.from({ length: clips }, (_, index) => ({
				id: `clip-${index + 1}`,
				startMs: clipBoundary(index),
				endMs: clipBoundary(index + 1),
				sourceStartMs: clipBoundary(index),
				speed: 1,
			})),
			autoCaptions: Array.from({ length: captions }, (_, index) => ({
				id: `caption-${index + 1}`,
				startMs: Math.floor((index * durationMs) / captions),
				endMs: Math.floor(((index + 1) * durationMs) / captions),
				text: `LeadCut benchmark caption ${index + 1}`,
			})),
			autoCaptionSettings: { enabled: true },
			aspectRatio: "16:9",
			showCursor: false,
		};
		await fs.writeFile(
			project,
			JSON.stringify({ version: 2, projectId: randomUUID(), videoPath: source, editor }),
			{ flag: "wx" },
		);
	}
	return { name, source, project, durationSeconds, width, height, frameRate };
}

export async function generateFixtures(options) {
	const sizes =
		options.size === "smoke"
			? [{ name: "30s-1080p", durationSeconds: 30, width: 1920, height: 1080 }]
			: (options.size === "10min" ? [10] : [10, 30, 60]).flatMap((minutes) => [
					{
						name: `${minutes}min-1080p`,
						durationSeconds: minutes * 60,
						width: 1920,
						height: 1080,
					},
					{
						name: `${minutes}min-4k`,
						durationSeconds: minutes * 60,
						width: 3840,
						height: 2160,
					},
				]);
	const fixtures = [];
	for (const size of sizes) {
		console.log(`Preparing ${size.name}`);
		fixtures.push(await createFixture(size, options));
	}
	return fixtures;
}

if (path.resolve(process.argv[1] ?? "") === entry) {
	console.log(JSON.stringify(await generateFixtures(parseFixtureOptions()), null, 2));
}
