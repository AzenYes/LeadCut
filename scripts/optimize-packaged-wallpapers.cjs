const { execFile } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");

const run = promisify(execFile);
const MIN_SAVINGS_RATIO = 0.1;
const MIN_RGB_PSNR_DB = 40;
const ICC_IDENTIFIER = Buffer.from("ICC_PROFILE\0");

function readJpegHeader(image) {
	if (image.length < 4 || image.readUInt16BE(0) !== 0xffd8) throw new Error("Invalid JPEG header");
	const segments = [];
	let start = 2;
	while (start + 3 < image.length && image[start] === 0xff) {
		let offset = start + 1;
		while (image[offset] === 0xff) offset++;
		const marker = image[offset++];
		if (marker === 0xda) return { segments, scanOffset: start };
		if (offset + 2 > image.length) break;
		const length = image.readUInt16BE(offset);
		if (length < 2 || offset + length > image.length) break;
		segments.push({ marker, data: image.subarray(start, offset + length), payload: image.subarray(offset + 2, offset + length) });
		start = offset + length;
	}
	throw new Error("Incomplete JPEG header");
}

function isPreservedMetadata({ marker, payload }) {
	return marker === 0xe1 || marker === 0xed ||
		(marker === 0xe2 && payload.subarray(0, ICC_IDENTIFIER.length).equals(ICC_IDENTIFIER));
}

function restoreMetadata(original, encoded) {
	const source = readJpegHeader(original);
	// Keep signed or compound images byte-for-byte. Other images keep their Exif,
	// XMP, profile and IPTC segments without replacing the encoder's color markers.
	if (source.segments.some(segment => segment.marker === 0xeb ||
		(segment.marker === 0xe2 && !isPreservedMetadata(segment)))) return original;
	const metadata = source.segments.filter(isPreservedMetadata).map(segment => segment.data);
	const target = readJpegHeader(encoded);
	const segments = target.segments.filter(segment => !isPreservedMetadata(segment));
	const jfifEnd = segments.findIndex(segment => segment.marker !== 0xe0);
	const insertionIndex = jfifEnd < 0 ? segments.length : jfifEnd;
	const chunks = segments.map(segment => segment.data);
	chunks.splice(insertionIndex, 0, ...metadata);
	return Buffer.concat([encoded.subarray(0, 2), ...chunks, encoded.subarray(target.scanOffset)]);
}

module.exports = async function optimizePackagedWallpapers({ appOutDir, electronPlatformName }) {
	if (electronPlatformName !== "win32") return;
	const ffmpeg = require("ffmpeg-static");
	const directory = path.join(appOutDir, "resources", "assets", "wallpapers");
	const files = await fs.readdir(directory, { recursive: true, withFileTypes: true });
	let savedBytes = 0;
	let optimized = 0;
	for (const entry of files) {
		if (!entry.isFile() || !/\.jpe?g$/i.test(entry.name)) continue;
		const file = path.join(entry.parentPath, entry.name);
		const temporary = path.join(entry.parentPath, `.${randomUUID()}.jpg`);
		try {
			const original = await fs.readFile(file);
			for (const quality of ["5", "4"]) {
				await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-threads", "1", "-noautorotate", "-i", file,
					"-frames:v", "1", "-c:v", "mjpeg", "-q:v", quality, "-huffman", "optimal", temporary],
					{ windowsHide: true, timeout: 30_000 });
				const encoded = restoreMetadata(original, await fs.readFile(temporary));
				if (encoded === original) break;
				if (encoded.length >= original.length * (1 - MIN_SAVINGS_RATIO)) continue;
				await fs.writeFile(temporary, encoded);
				const { stderr } = await run(ffmpeg, ["-hide_banner", "-threads", "1", "-noautorotate", "-i", file,
					"-threads", "1", "-noautorotate", "-i", temporary, "-filter_complex_threads", "1",
					"-filter_complex", "[0:v]format=gbrp[original];[1:v]format=gbrp[encoded];[original][encoded]psnr",
					"-frames:v", "1", "-f", "null", "-"], { windowsHide: true, timeout: 30_000 });
				const score = stderr.match(/average:([\d.]+|inf)/)?.[1];
				const rgbPsnrDb = score === "inf" ? Infinity : Number(score);
				if (!(rgbPsnrDb >= MIN_RGB_PSNR_DB)) continue;
				await fs.rename(temporary, file);
				savedBytes += original.length - encoded.length;
				optimized++;
				break;
			}
		} finally {
			await fs.rm(temporary, { force: true });
		}
	}
	console.log(`Optimized ${optimized} packaged wallpapers, saving ${savedBytes} bytes.`);
};
