import fs from "node:fs/promises";

const PCM_HEADER_BYTES = 44;

export function repairWavHeader(header: Buffer, fileSize: number): Buffer {
	if (
		header.length < PCM_HEADER_BYTES ||
		header.toString("ascii", 0, 4) !== "RIFF" ||
		header.toString("ascii", 8, 16) !== "WAVEfmt " ||
		header.readUInt32LE(16) !== 16 ||
		header.readUInt16LE(20) !== 1 ||
		header.toString("ascii", 36, 40) !== "data" ||
		!Number.isSafeInteger(fileSize) ||
		fileSize < PCM_HEADER_BYTES ||
		fileSize - 8 > 0xffff_ffff
	) {
		throw new Error("Unsupported PCM WAV header");
	}

	const repaired = Buffer.from(header);
	repaired.writeUInt32LE(fileSize - 8, 4);
	repaired.writeUInt32LE(fileSize - PCM_HEADER_BYTES, 40);
	return repaired;
}

export async function repairCapturedWavFile(filePath: string) {
	const file = await fs.open(filePath, "r+");
	try {
		const header = Buffer.alloc(PCM_HEADER_BYTES);
		const { bytesRead } = await file.read(header, 0, header.length, 0);
		const { size } = await file.stat();
		const repaired = repairWavHeader(header.subarray(0, bytesRead), size);
		if (!header.equals(repaired)) {
			await file.write(repaired, 0, repaired.length, 0);
			await file.sync();
		}
	} finally {
		await file.close();
	}
}
