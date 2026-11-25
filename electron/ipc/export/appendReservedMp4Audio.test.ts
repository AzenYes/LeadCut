import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { appendAudioToReservedMp4 } from "./appendReservedMp4Audio";
import { atoms, box, children, pick } from "./mp4AudioTrackTables";

function stagedVideo() {
	const header = Buffer.alloc(100);
	header.writeUInt32BE(1_000, 12);
	header.writeUInt32BE(1_000, 16);
	header.writeUInt32BE(2, 96);
	return Buffer.concat([
		box("ftyp"), box("moov", box("mvhd", header), box("trak")),
		box("free", Buffer.alloc(1_000)), box("mdat", Buffer.from([1, 2, 3])),
	]);
}

function encodedFragment() {
	const header = Buffer.alloc(24);
	header.writeUInt32BE(48_000, 12);
	const handler = Buffer.alloc(12);
	handler.write("soun", 8);
	const init = box("moov", box("trak", box("mdia",
		box("mdhd", header), box("hdlr", handler), box("minf", box("stbl", box("stsd"))))));
	const track = Buffer.alloc(16);
	track.writeUInt32BE(0x020018);
	track.writeUInt32BE(1, 4);
	track.writeUInt32BE(48_000, 8);
	track.writeUInt32BE(3, 12);
	const run = Buffer.alloc(12);
	run.writeUInt32BE(1);
	run.writeUInt32BE(1, 4);
	const fragment = () => box("moof", box("traf", box("tfhd", track), box("tfdt", Buffer.alloc(8)), box("trun", run)));
	run.writeUInt32BE(fragment().length + 8, 8);
	return [init, fragment(), box("mdat", Buffer.from([4, 5, 6]))];
}

it("reuses the reserved MP4 and restores it byte for byte when input fails after a fragment", async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-audio-append-"));
	const video = path.join(directory, "video.mp4");
	const initial = stagedVideo();
	const fragments = encodedFragment();
	try {
		await fs.writeFile(video, initial);
		const failure = new Error("Audio input was interrupted");
		await expect(appendAudioToReservedMp4(video, 1_000, async function* () {
			yield* fragments;
			throw failure;
		})).rejects.toBe(failure);
		expect(await fs.readFile(video)).toEqual(initial);

		await appendAudioToReservedMp4(video, 1_000, async function* () { yield* fragments; });
		const combined = await fs.readFile(video);
		expect(combined.subarray(initial.length)).toEqual(fragments[2]);
		const movie = pick(atoms(combined), "moov");
		expect(children(combined, movie).filter(child => child.type === "trak")).toHaveLength(2);
		expect(await fs.readdir(directory)).toEqual(["video.mp4"]);
	} finally {
		await fs.rm(video, { force: true });
		await fs.rmdir(directory);
	}
});
