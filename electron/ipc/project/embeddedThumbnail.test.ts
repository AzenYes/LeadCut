import { afterEach, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { decodeProjectThumbnail, readEmbeddedThumbnail, serializeProjectWithThumbnail } from "./embeddedThumbnail";
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });
const png = Buffer.alloc(24);
Buffer.from([137,80,78,71,13,10,26,10]).copy(png); png.writeUInt32BE(640,16); png.writeUInt32BE(480,20);
const url = `data:image/png;base64,${png.toString("base64")}`;
async function fixture() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "embedded-project-")); dirs.push(dir);
	return path.join(dir, "中文 空格.leadcut");
}
it("stores the PNG inside the project while preserving timeline data", async () => {
	const project = { version: 2, videoPath: "movie.mp4", editor: { clipRegions: [{ id: "a", endMs: 2345 }] } };
	const contents = await serializeProjectWithThumbnail(project, undefined, url);
	expect(JSON.parse(contents)).toEqual({ thumbnailPng: url, ...project });
	expect(contents.indexOf('"thumbnailPng"')).toBeLessThan(contents.indexOf('"editor"'));
});
it("keeps the previous preview when a later autosave has no image", async () => {
	const file = await fixture();
	await fs.writeFile(file, await serializeProjectWithThumbnail({ version: 2, editor: {} }, undefined, url));
	const saved = JSON.parse(await serializeProjectWithThumbnail({ version: 2, editor: { padding: 12 } }, file));
	expect(saved.thumbnailPng).toBe(url); expect(saved.editor.padding).toBe(12);
	await expect(readEmbeddedThumbnail(file)).resolves.toEqual(png);
});
it("migrates a legacy adjacent preview and handles UTF-8 BOM projects", async () => {
	const file = await fixture();
	await fs.writeFile(file, '\uFEFF{"version":2,"editor":{}}');
	await fs.writeFile(`${file}.preview.png`, png);
	expect(JSON.parse(await serializeProjectWithThumbnail({ version:2, editor:{} }, file)).thumbnailPng).toBe(url);
});
it("allows an explicit clear and rejects invalid or excessive image dimensions", async () => {
	expect(JSON.parse(await serializeProjectWithThumbnail({ version:2, thumbnailPng:url }, undefined, null)).thumbnailPng).toBeUndefined();
	await expect(serializeProjectWithThumbnail({}, undefined, "data:image/png;base64,bad")).rejects.toThrow();
	const huge=Buffer.from(png); huge.writeUInt32BE(100000,16);
	expect(decodeProjectThumbnail(`data:image/png;base64,${huge.toString("base64")}`)).toBeNull();
	expect(decodeProjectThumbnail("https://example.com/preview.png")).toBeNull();
});
