import assert from "node:assert/strict";
import { open, type FileHandle } from "node:fs/promises";
import { atoms, box, children, pick, prepareAudioTrackAssembler } from "./mp4AudioTrackTables";

const MAX_BOX_BYTES = 16 * 1024 * 1024;

async function readExactly(file: FileHandle, size: number, position: number) {
	const bytes = Buffer.allocUnsafe(size);
	let offset = 0;
	while (offset < size) {
		const result = await file.read(bytes, offset, size - offset, position + offset);
		assert(result.bytesRead > 0, "Truncated export file");
		offset += result.bytesRead;
	}
	return bytes;
}

async function writeExactly(file: FileHandle, bytes: Buffer, position: number, signal?: AbortSignal) {
	let offset = 0;
	while (offset < bytes.length) {
		signal?.throwIfAborted();
		const result = await file.write(bytes, offset, bytes.length - offset, position + offset);
		assert(result.bytesWritten > 0, "Could not write export file");
		offset += result.bytesWritten;
	}
}

async function readTopLevelBoxes(file: FileHandle, fileSize: number) {
	const boxes = [];
	let start = 0;
	while (start < fileSize) {
		assert(boxes.length < 32);
		const header = await readExactly(file, 8, start);
		const type = header.toString("ascii", 4);
		let size = header.readUInt32BE();
		let headerSize = 8;
		if (size === 1) {
			headerSize = 16;
			size = Number((await readExactly(file, 8, start + 8)).readBigUInt64BE());
		}
		assert(Number.isSafeInteger(size) && size >= headerSize && size <= fileSize - start, "Invalid MP4 box size");
		boxes.push({ start, type, size });
		start += size;
	}
	return boxes;
}

async function* readAudioPipeBoxes(source: AsyncIterable<Buffer>, signal?: AbortSignal) {
	let buffer: Buffer = Buffer.alloc(0);
	for await (const chunk of source) {
		signal?.throwIfAborted();
		buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
		while (buffer.length >= 8) {
			const header = buffer.readUInt32BE();
			if (header === 1 && buffer.length < 16) break;
			const size = header === 1 ? Number(buffer.readBigUInt64BE(8)) : header;
			assert(size >= (header === 1 ? 16 : 8) && size <= MAX_BOX_BYTES, "Unexpected audio fragment size");
			if (buffer.length < size) break;
			yield { type: buffer.toString("ascii", 4, 8), bytes: buffer.subarray(0, size) };
			buffer = buffer.subarray(size);
		}
	}
	assert.equal(buffer.length, 0, "Incomplete audio fragment");
}

export async function appendAudioToReservedMp4(filePath: string, requestedDurationMs: number, encodedAudio: (timescale: number) => AsyncIterable<Buffer>, signal?: AbortSignal) {
	const file = await open(filePath, "r+");
	let initialLength: number | undefined;
	let moviePosition = 0;
	let changedHeaderBytes: Buffer | undefined;

	try {
		signal?.throwIfAborted();
		const { size: originalSize } = await file.stat();
		const outer = await readTopLevelBoxes(file, originalSize);
		assert.deepEqual(outer.map(part => part.type), ["ftyp", "moov", "free", "mdat"], "Video does not have a reserved movie header");
		const [, movieBox, freeBox, mediaBox] = outer;
		assert(movieBox.size <= MAX_BOX_BYTES && freeBox.size <= 0xffff_ffff);
		moviePosition = movieBox.start;
		const originalMovie = await readExactly(file, movieBox.size, moviePosition);
		const inner = children(originalMovie, pick(atoms(originalMovie), "moov"));
		pick(inner, "trak");
		const header = pick(inner, "mvhd");
		const updatedHeader = Buffer.from(originalMovie.subarray(header.start, header.end));
		const movie64 = originalMovie[header.body] === 1;
		assert(movie64 || originalMovie[header.body] === 0);
		const timescale = originalMovie.readUInt32BE(header.body + (movie64 ? 20 : 12));
		assert(timescale > 0);
		let position = originalSize;
		let assembler: ReturnType<typeof prepareAudioTrackAssembler> | undefined;
		let fragment: Buffer | undefined;
		for await (const part of readAudioPipeBoxes(encodedAudio(timescale), signal)) {
			if (part.type === "ftyp") {
				assert(!assembler);
			} else if (part.type === "moov") {
				assert(!assembler);
				assembler = prepareAudioTrackAssembler(part.bytes, requestedDurationMs, timescale);
			} else if (part.type === "moof") {
				assert(assembler && !fragment);
				fragment = part.bytes;
			} else {
				assert.equal(part.type, "mdat");
				assert(assembler && fragment);
				assembler.add(fragment, part.bytes, position);
				initialLength = originalSize;
				await writeExactly(file, part.bytes, position, signal);
				position += part.bytes.length;
				fragment = undefined;
			}
		}
		assert(assembler && !fragment);
		const { newTrack, trackDuration } = assembler.finish();
		const durationOffset = header.body - header.start + (movie64 ? 24 : 16);
		const oldDuration = movie64 ? Number(updatedHeader.readBigUInt64BE(durationOffset)) : updatedHeader.readUInt32BE(durationOffset);
		if (trackDuration > oldDuration) {
			if (movie64) updatedHeader.writeBigUInt64BE(BigInt(trackDuration), durationOffset);
			else updatedHeader.writeUInt32BE(trackDuration, durationOffset);
		}
		updatedHeader.writeUInt32BE(3, updatedHeader.length - 4);
		const updatedMovie = box("moov", ...inner.map(atom => atom === header ? updatedHeader : originalMovie.subarray(atom.start, atom.end)), newTrack);
		const remaining = mediaBox.start - moviePosition - updatedMovie.length;
		assert(remaining >= 8, "The movie header does not fit in the reserved space");
		const updatedFreeHeader = Buffer.alloc(8);
		updatedFreeHeader.writeUInt32BE(remaining);
		updatedFreeHeader.write("free", 4);
		changedHeaderBytes = await readExactly(file, updatedMovie.length + 8, moviePosition);
		await writeExactly(file, updatedMovie, moviePosition, signal);
		await writeExactly(file, updatedFreeHeader, moviePosition + updatedMovie.length, signal);
		return { outputBytes: position };
	} catch (error) {
		try {
			if (initialLength !== undefined) await file.truncate(initialLength);
			if (changedHeaderBytes) await writeExactly(file, changedHeaderBytes, moviePosition);
		} catch (rollbackError) {
			throw Object.assign(new Error(`Could not restore the unmuxed video: ${String(error)} (${String(rollbackError)})`), {
				code: "EXPORT_AUDIO_ROLLBACK_FAILED",
			});
		}
		throw error;
	} finally {
		await file.close();
	}
}
