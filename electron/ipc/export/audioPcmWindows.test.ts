import type { ChildProcess, SpawnOptions } from "node:child_process";
import { beforeEach, expect, it, vi } from "vitest";
import { AudioPcmWindowPool } from "./audioPcmWindows";

const observed = vi.hoisted(() => ({ started: [] as ChildProcess[], closed: new Set<ChildProcess>() }));

vi.mock("node:child_process", async importOriginal => {
	const original = await importOriginal<typeof import("node:child_process")>();
	return {
		...original,
		spawn: (_file: string, args: string[], options: SpawnOptions) => {
			const source = args[args.indexOf("-i") + 1];
			const code = source === "stall"
				? "setInterval(() => {}, 1000)"
				: "process.stdout.write(Buffer.from(Array.from({ length: 32 }, (_, index) => index)))";
			const child = original.spawn(process.execPath, ["-e", code], options);
			observed.started.push(child);
			child.once("close", () => observed.closed.add(child));
			return child;
		},
	};
});

beforeEach(() => {
	observed.started.length = 0;
	observed.closed.clear();
});

it("reuses absolute PCM ranges, handles EOF and restarts when an earlier window is no longer cached", async () => {
	const pool = new AudioPcmWindowPool("ffmpeg");
	const signal = new AbortController().signal;
	const read = (firstFrame: number, endFrame: number) => pool.read("file", {
		firstFrame, endFrame, channels: 1, sampleRate: 48000,
	}, signal);
	try {
		expect([...await read(2, 6)]).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
		expect([...await read(3, 4)]).toEqual([6, 7]);
		expect([...await read(5, 8)]).toEqual([10, 11, 12, 13, 14, 15]);
		expect([...await read(14, 20)]).toEqual([28, 29, 30, 31]);
		expect(observed.started).toHaveLength(1);
		expect([...await read(0, 2)]).toEqual([0, 1, 2, 3]);
		expect(observed.started).toHaveLength(2);
	} finally {
		await pool.close();
	}
	expect(observed.closed.size).toBe(2);
});

it("closes both an active read and an idle decoder and rejects reads after cleanup", async () => {
	const pool = new AudioPcmWindowPool("ffmpeg");
	const range = { firstFrame: 0, endFrame: 1, channels: 1, sampleRate: 48000 };
	const signal = new AbortController().signal;
	try {
		await pool.read("one", range, signal);
		const read = pool.read("stall", range, signal);
		const aborted = expect(read).rejects.toHaveProperty("name", "AbortError");
		await pool.close();
		await aborted;
		expect(observed.started).toHaveLength(2);
		expect(observed.closed.size).toBe(2);
		await expect(pool.read("one", range, signal)).rejects.toHaveProperty("name", "AbortError");
	} finally {
		await pool.close();
	}
});
