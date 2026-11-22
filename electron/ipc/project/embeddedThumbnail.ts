import fs from "node:fs/promises";

export const THUMBNAIL_FIELD = "thumbnailPng";
const PNG_PREFIX = "data:image/png;base64,";
const MAX_BYTES = 4 * 1024 * 1024;

export function decodeProjectThumbnail(value: unknown): Buffer | null {
	if (typeof value !== "string" || !value.startsWith(PNG_PREFIX) || value.length > MAX_BYTES * 1.34 + 64) return null;
	const encoded = value.slice(PNG_PREFIX.length);
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
	const png = Buffer.from(encoded, "base64");
	if (png.length < 24 || png.length > MAX_BYTES || !png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return null;
	const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
	return width > 0 && height > 0 && width <= 4096 && height <= 4096 ? png : null;
}

export async function readEmbeddedThumbnail(projectPath: string): Promise<Buffer | null> {
	try {
		const project = JSON.parse((await fs.readFile(projectPath, "utf8")).replace(/^\uFEFF/, ""));
		return decodeProjectThumbnail(project?.[THUMBNAIL_FIELD]);
	} catch { return null; }
}

/** Preserve the previous preview when autosave has no new rendered frame. */
export async function serializeProjectWithThumbnail(
	project: unknown,
	previousPath?: string,
	thumbnail?: string | null,
	generateThumbnail?: () => Promise<Buffer | null>,
) {
	if (!project || typeof project !== "object" || Array.isArray(project)) throw new Error("Invalid project");
	let png: Buffer | null = null;
	if (thumbnail !== undefined && thumbnail !== null) {
		png = decodeProjectThumbnail(thumbnail);
		if (!png) throw new Error("Project thumbnail must be a valid PNG data URL (up to 4 MB).");
	} else if (thumbnail === undefined) {
		png = decodeProjectThumbnail((project as Record<string, unknown>)[THUMBNAIL_FIELD]);
		if (!png && previousPath) png = await readEmbeddedThumbnail(previousPath);
		if (!png && previousPath) {
			try {
				const legacy = await fs.readFile(`${previousPath}.preview.png`);
				png = decodeProjectThumbnail(PNG_PREFIX + legacy.toString("base64"));
			} catch { /* The project may never have had a preview. */ }
		}
	}
	if (!png && generateThumbnail) {
		const generated = await generateThumbnail();
		if (generated) png = decodeProjectThumbnail(PNG_PREFIX + generated.toString("base64"));
	}
	const result = { ...project } as Record<string, unknown>;
	delete result[THUMBNAIL_FIELD];
	// Put the preview first so Shell can find it without scanning the timeline.
	return JSON.stringify(png ? { [THUMBNAIL_FIELD]: PNG_PREFIX + png.toString("base64"), ...result } : result, null, 2);
}
