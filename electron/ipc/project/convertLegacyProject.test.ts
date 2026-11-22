import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convertLegacyProjectFile } from "./convertLegacyProject";

const contents = '\uFEFF{"version":2,"projectId":"original","videoPath":"录屏.mp4","editor":{}}\r\n';

describe("convertLegacyProjectFile", () => {
	let directory: string;
	let source: string;
	let target: string;

	beforeEach(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-legacy-project-"));
		source = path.join(directory, "课程.RECORDLY");
		target = path.join(directory, "课程.leadcut");
		await fs.writeFile(source, contents);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await fs.rm(directory, { recursive: true, force: true });
	});

	it("copies the exact bytes and archives the original and backup", async () => {
		await fs.writeFile(`${source}.bak`, "previous version");
		const converted = await convertLegacyProjectFile(source);
		expect(converted).toEqual({ path: target, convertedFrom: source });
		expect(await fs.readFile(target)).toEqual(Buffer.from(contents));
		const archived = path.join(directory, "旧工程备份", path.basename(source));
		expect(await fs.readFile(archived, "utf8")).toBe(contents);
		expect(await fs.readFile(`${archived}.bak`, "utf8")).toBe("previous version");
		await expect(fs.stat(source)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(fs.stat(`${source}.bak`)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("reuses the matching project without replacing its latest edits", async () => {
		const edited = contents.replace('"editor":{}', '"editor":{"newer":true}');
		await fs.writeFile(target, edited);
		const result = await convertLegacyProjectFile(source);
		expect(result.path).toBe(target);
		expect(await fs.readFile(target, "utf8")).toBe(edited);
		await expect(fs.stat(source)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("picks a different filename for a distinct project id", async () => {
		const different = contents.replace("original", "distinct");
		await fs.writeFile(target, different);
		const result = await convertLegacyProjectFile(source);
		expect(path.basename(result.path)).toBe("课程_1.leadcut");
		expect(await fs.readFile(target, "utf8")).toBe(different);
		expect(await fs.readFile(result.path, "utf8")).toBe(contents);
	});

	it("keeps the original when the initial copy fails", async () => {
		vi.spyOn(fs, "copyFile").mockRejectedValueOnce(Object.assign(new Error("Disk full"), { code: "ENOSPC" }));
		await expect(convertLegacyProjectFile(source)).rejects.toThrow("Disk full");
		expect(await fs.readFile(source, "utf8")).toBe(contents);
		await expect(fs.stat(target)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("restores the source and backup when conversion metadata cannot be written", async () => {
		await fs.writeFile(`${source}.bak`, "previous version");
		await expect(convertLegacyProjectFile(source, {
			finalize: async () => { throw new Error("Metadata unavailable"); },
		})).rejects.toThrow("Metadata unavailable");
		expect(await fs.readFile(source, "utf8")).toBe(contents);
		expect(await fs.readFile(`${source}.bak`, "utf8")).toBe("previous version");
		await expect(fs.stat(target)).rejects.toMatchObject({ code: "ENOENT" });
	});
});
