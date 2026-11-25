import assert from "node:assert/strict";

type Mp4Box = { type: string; start: number; size: number; body: number; end: number };

export function atoms(bytes: Buffer, start = 0, end = bytes.length) {
	const result: Mp4Box[] = [];
	while (start < end) {
		assert(start + 8 <= end);
		const type = bytes.toString("ascii", start + 4, start + 8);
		let size = bytes.readUInt32BE(start);
		const header = size === 1 ? 16 : 8;
		if (size === 1) size = Number(bytes.readBigUInt64BE(start + 8));
		assert(Number.isSafeInteger(size) && size >= header && start + size <= end);
		result.push({ type, start, size, body: start + header, end: start + size });
		start += size;
	}
	return result;
}

export function children(bytes: Buffer, box: Mp4Box) {
	return atoms(bytes, box.body, box.end);
}

export function box(type: string, ...body: Buffer[]) {
	const header = Buffer.alloc(8);
	header.writeUInt32BE(header.length + body.reduce((acc, bytes) => acc + bytes.length, 0));
	header.write(type, 4, 4, "ascii");
	return Buffer.concat([header, ...body]);
}

export function pick(boxes: Mp4Box[], type: string) {
	const selected = boxes.filter(box => box.type === type);
	assert.equal(selected.length, 1, type);
	return selected[0];
}

function fragmentSamples(bytes: Buffer, fragment: Mp4Box) {
	const traf = pick(children(bytes, fragment), "traf");
	const inner = children(bytes, traf);
	const tfhd = pick(inner, "tfhd");
	const trun = pick(inner, "trun");
	const flags = bytes.readUIntBE(tfhd.body + 1, 3);
	// The encoder emits self-contained fragments with offsets relative to moof.
	assert(flags & 0x020000);
	assert(!(flags & 0x000001));
	assert.equal(bytes.readUInt32BE(tfhd.body + 4), 1);
	let at = tfhd.body + 8;
	if (flags & 2) {
		assert.equal(bytes.readUInt32BE(at), 1);
		at += 4;
	}
	const defaultDuration = flags & 8 ? bytes.readUInt32BE(at) : 0;
	if (flags & 8) at += 4;
	const defaultSize = flags & 16 ? bytes.readUInt32BE(at) : 0;
	if (flags & 16) at += 4;
	if (flags & 32) at += 4;
	assert.equal(at, tfhd.end);
	const runFlags = bytes.readUIntBE(trun.body + 1, 3);
	const count = bytes.readUInt32BE(trun.body + 4);
	assert(count > 0 && count < 65_536);
	assert(runFlags & 1);
	const offset = bytes.readInt32BE(trun.body + 8);
	at = trun.body + 12;
	if (runFlags & 4) at += 4;
	const samples = [];
	for (let index = 0; index < count; index++) {
		const duration = runFlags & 0x100 ? bytes.readUInt32BE(at) : defaultDuration;
		if (runFlags & 0x100) at += 4;
		const size = runFlags & 0x200 ? bytes.readUInt32BE(at) : defaultSize;
		if (runFlags & 0x200) at += 4;
		if (runFlags & 0x400) at += 4;
		if (runFlags & 0x800) {
			assert.equal(bytes.readInt32BE(at), 0);
			at += 4;
		}
		assert(duration > 0 && size > 0);
		samples.push({ duration, size });
	}
	assert.equal(at, trun.end);
	return { offset, samples };
}

function table(type: string, entries: number[][], columns: number) {
	const payload = Buffer.alloc(8 + entries.length * columns * (type === "co64" ? 8 : 4));
	payload.writeUInt32BE(entries.length, 4);
	let position = 8;
	for (const entry of entries) for (const value of entry) {
		if (type === "co64") {
			payload.writeBigUInt64BE(BigInt(value), position);
			position += 8;
		} else {
			payload.writeUInt32BE(value, position);
			position += 4;
		}
	}
	return box(type, payload);
}

function durationData(payload: Buffer, offset: number, duration: number) {
	if (payload[0] === 1) payload.writeBigUInt64BE(BigInt(duration), offset);
	else {
		assert.equal(payload[0], 0);
		payload.writeUInt32BE(duration, offset);
	}
}

export function prepareAudioTrackAssembler(audio: Buffer, durationMs: number, movieTimescale: number) {
	const init = pick(atoms(audio), "moov");
	const track = pick(children(audio, init), "trak");
	const media = pick(children(audio, track), "mdia");
	const handler = pick(children(audio, media), "hdlr");
	assert.equal(audio.toString("ascii", handler.body + 8, handler.body + 12), "soun");
	const mdhd = pick(children(audio, media), "mdhd");
	const timescale = audio.readUInt32BE(mdhd.body + (audio[mdhd.body] === 0 ? 12 : 20));
	assert(timescale > 0);
	const durations: [count: number, duration: number][] = [];
	const chunkCounts: [firstChunk: number, samples: number, description: number][] = [];
	const sizes: number[] = [];
	const offsets: [offset: number][] = [];
	let total = 0;

	const add = (fragment: Buffer, payload: Buffer, at: number) => {
		const moof = pick(atoms(fragment), "moof");
		const mdat = pick(atoms(payload), "mdat");
		const { offset, samples } = fragmentSamples(fragment, moof);
		assert.equal(offset, fragment.length + mdat.body);
		const traf = pick(children(fragment, moof), "traf");
		const tfdt = pick(children(fragment, traf), "tfdt");
		const decodeTime = fragment[tfdt.body] === 1
			? Number(fragment.readBigUInt64BE(tfdt.body + 4)) : fragment.readUInt32BE(tfdt.body + 4);
		assert.equal(decodeTime, total, "Non-contiguous audio fragments cannot share a sample table");
		assert.equal(samples.reduce((sum, sample) => sum + sample.size, 0), payload.length - mdat.body);
		if (chunkCounts[chunkCounts.length - 1]?.[1] !== samples.length) {
			chunkCounts.push([offsets.length + 1, samples.length, 1]);
		}
		offsets.push([at + mdat.body]);
		for (const { duration, size } of samples) {
			const previous = durations[durations.length - 1];
			if (previous?.[1] === duration) previous[0]++;
			else durations.push([1, duration]);
			sizes.push(size);
			total += duration;
		}
	};

	const finish = () => {
		assert(sizes.length > 0);

		const edits = children(audio, track).find(atom => atom.type === "edts");
		const existingList = edits && pick(children(audio, edits), "elst");
		const firstEditIs64Bit = existingList && audio[existingList.body] === 1;
		const editCount = existingList ? audio.readUInt32BE(existingList.body + 4) : 0;
		const skip = (index: number) => {
			assert(existingList);
			const start = existingList.body + 8;
			return firstEditIs64Bit
				? Number(audio.readBigInt64BE(start + index * 20 + 8))
				: audio.readInt32BE(start + index * 12 + 4);
		};
		assert(editCount <= 2);
		let delay = 0;
		if (editCount === 2) {
			assert(existingList);
			assert.equal(skip(0), -1);
			delay = firstEditIs64Bit ? Number(audio.readBigUInt64BE(existingList.body + 8)) : audio.readUInt32BE(existingList.body + 8);
		}
		const trim = editCount ? skip(editCount - 1) : 0;
		assert(trim >= 0);
		const available = Math.ceil((total - trim) * movieTimescale / timescale);
		const play = Math.max(0, Math.min(available, Math.round(durationMs * movieTimescale / 1000) - delay));
		assert(play > 0);
		const elst = Buffer.alloc(delay ? 48 : 28);
		// Preserve the leading gap and the encoder priming skip in the classic MP4.
		elst[0] = 1;
		elst.writeUInt32BE(delay ? 2 : 1, 4);
		if (delay) {
			elst.writeBigUInt64BE(BigInt(delay), 8);
			elst.writeBigInt64BE(-1n, 16);
			elst.writeUInt16BE(1, 24);
		}
		const lastEdit = delay ? 28 : 8;
		elst.writeBigUInt64BE(BigInt(play), lastEdit);
		elst.writeBigInt64BE(BigInt(trim), lastEdit + 8);
		elst.writeUInt16BE(1, lastEdit + 16);

		const replace = (atom: Mp4Box): Buffer => {
			if (atom.type === "stbl") {
				const stsd = pick(children(audio, atom), "stsd");
				const sampleSizes = Buffer.alloc(12 + sizes.length * 4);
				sampleSizes.writeUInt32BE(sizes.length, 8);
				sizes.forEach((size, index) => sampleSizes.writeUInt32BE(size, 12 + index * 4));
				return box("stbl", audio.subarray(stsd.start, stsd.end), table("stts", durations, 2), table("stsc", chunkCounts, 3),
					box("stsz", sampleSizes), table("co64", offsets, 1));
			}
			if (atom.type === "tkhd" || atom.type === "mdhd") {
				const payload = Buffer.from(audio.subarray(atom.body, atom.end));
				if (atom.type === "tkhd") {
					payload.writeUInt32BE(2, payload[0] === 0 ? 12 : 20);
					durationData(payload, payload[0] === 0 ? 20 : 28, play + delay);
				} else {
					durationData(payload, payload[0] === 0 ? 16 : 24, total);
				}
				return box(atom.type, payload);
			}
			if (atom.type === "trak") {
				return box("trak", ...children(audio, atom).filter(child => child.type !== "edts").map(replace), box("edts", box("elst", elst)));
			}
			if (["mdia", "minf"].includes(atom.type)) {
				return box(atom.type, ...children(audio, atom).map(replace));
			}
			return audio.subarray(atom.start, atom.end);
		};
		return { newTrack: replace(track), trackDuration: play + delay };
	};
	return { add, finish };
}
