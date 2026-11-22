import { expect, it } from "vitest";
import { repairWavHeader } from "./wavHeaderRepair";

function makeUnfinishedWavHeader() {
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.write("WAVEfmt ", 8);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.write("data", 36);
	return header;
}

it("repairs both PCM WAV lengths using the actual file size", () => {
	const header = makeUnfinishedWavHeader();
	const fileSize = 44 + 48_000 * 2 * 2;
	const repaired = repairWavHeader(header, fileSize);
	expect(repaired.readUInt32LE(4)).toBe(fileSize - 8);
	expect(repaired.readUInt32LE(40)).toBe(fileSize - 44);
	expect(repaired.subarray(8, 40)).toEqual(header.subarray(8, 40));
	expect(header.readUInt32LE(4)).toBe(0);
	expect(header.readUInt32LE(40)).toBe(0);
});

it("refuses an incomplete header or a size that cannot be represented by RIFF", () => {
	const header = makeUnfinishedWavHeader();
	expect(() => repairWavHeader(header.subarray(0, 40), 144)).toThrow(
		"Unsupported PCM WAV header",
	);
	expect(() => repairWavHeader(header, 8 + 0x1_0000_0000)).toThrow("Unsupported PCM WAV header");
});
