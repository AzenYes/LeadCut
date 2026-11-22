import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodeSrtBytes, importSrtFile, parseImportedSrt } from "./srtImport";

const content =
	"1\n00:00:00,500 --> 00:00:01,750\n阿真的字幕\n第二行\n\n2\n00:00:02,000 --> 00:00:03,000\nClaude Code 5.5";
describe("local SRT import", () => {
	it("preserves multiline text and exact timing, marks sequence time and creates unique import ids", () => {
		const first = parseImportedSrt("\uFEFF" + content.replace(/\n/g, "\r\n"));
		expect(first).toMatchObject([
			{ startMs: 500, endMs: 1750, text: "阿真的字幕\n第二行", timeBasis: "timeline" },
			{ startMs: 2000, endMs: 3000, text: "Claude Code 5.5", timeBasis: "timeline" },
		]);
		expect(first[0].id).not.toBe(parseImportedSrt(content)[0].id);
		expect(first[0]).not.toHaveProperty("words");
	});
	it("accepts whitespace separators, dot milliseconds, unnumbered cues and sorts unsorted entries", () => {
		const cues = parseImportedSrt(
			"00:00:02.000 --> 00:00:03.000\n后一句\n \t\n00:00:00.500 --> 00:00:01.000\n前一句",
		);
		expect(cues.map((cue) => [cue.startMs, cue.text])).toEqual([
			[500, "前一句"],
			[2000, "后一句"],
		]);
	});
	it.each([
		["", "empty"],
		["This is not SRT", "invalidFormat"],
		["1\n00:60:00,000 --> 00:61:00,000\nbad", "invalidTiming"],
		["1\n00:00:02,000 --> 00:00:01,000\nbad", "invalidTiming"],
		["1\n00:00:02,000 --> 00:00:03,000\n", "emptyText"],
		[content + "\n\n3\nwrong timestamp\nbad", "invalidFormat"],
		[content.replace("00:00:02,000", "00:00:01,000"), "overlap"],
	])("rejects %j without returning a partial track", (input, code) => {
		try {
			parseImportedSrt(input);
			throw new Error("Unexpected success");
		} catch (error) {
			expect(error).toMatchObject({ code });
		}
	});
	it("decodes UTF-8, UTF-16LE/BE with BOM and legacy GBK Chinese", () => {
		expect(decodeSrtBytes(Buffer.from(content, "utf8"))).toBe(content);
		const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, "utf16le")]);
		expect(decodeSrtBytes(le)).toBe(content);
		expect(decodeSrtBytes(Buffer.from(le).swap16())).toBe(content);
		expect(decodeSrtBytes(Buffer.from([0xd6, 0xd0, 0xce, 0xc4]))).toBe("中文");
	});
	it("reads local files through the same decoder/parser and refuses non-SRT files", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-srt-test-"));
		const file = path.join(directory, "字幕.SRT");
		try {
			await fs.writeFile(file, content);
			expect(await importSrtFile(file)).toHaveLength(2);
			await expect(importSrtFile(path.join(directory, "video.mp4"))).rejects.toMatchObject({
				code: "extension",
			});
		} finally {
			await fs.rm(directory, { recursive: true, force: true });
		}
	});
});
