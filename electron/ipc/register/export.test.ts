import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		setName: vi.fn(),
		setPath: vi.fn(),
		getAppPath: () => process.cwd(),
		getPath: () => process.env.TEMP ?? process.cwd(),
		isPackaged: false,
	},
	BrowserWindow: {
		fromWebContents: () => null,
	},
	dialog: {
		showSaveDialog: vi.fn(),
	},
	ipcMain: {
		handle: vi.fn(),
	},
	powerSaveBlocker: {
		isStarted: () => true,
		start: () => 1,
		stop: vi.fn(),
	},
}));

vi.mock("../ffmpeg/binary", () => ({
	getFfmpegBinaryPath: () => "ffmpeg",
}));

import { moveExportedTempFile } from "./export";
import { registerOwnedExportPath, releaseOwnedExportPath } from "../export/exportStream";

const tempDirs: string[] = [];

async function makeTempDir() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-export-move-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.allSettled(
		tempDirs.splice(0).map((dir) => fs.rm(dir, { force: true, recursive: true })),
	);
});

describe("moveExportedTempFile", () => {
	it("moves an app-managed export temp file to the selected destination", async () => {
		const dir = await makeTempDir();
		const tempPath = path.join(dir, "export-temp.mp4");
		const destinationPath = path.join(dir, "export-final.mp4");
		await fs.writeFile(tempPath, "recordly-export");

		await moveExportedTempFile(tempPath, destinationPath);

		await expect(fs.readFile(destinationPath, "utf8")).resolves.toBe("recordly-export");
		await expect(fs.access(tempPath)).rejects.toThrow();
	});

	it("falls back when Windows reports the destination already exists during initial rename", async () => {
		const dir = await makeTempDir();
		const tempPath = path.join(dir, "export-temp.mp4");
		const destinationPath = path.join(dir, "export-final.mp4");
		await fs.writeFile(tempPath, "new-export");
		await fs.writeFile(destinationPath, "previous-export");

		vi.spyOn(fs, "rename").mockRejectedValueOnce(Object.assign(new Error("destination exists"), { code: "EEXIST" }));
		const copy = vi.spyOn(fs, "copyFile");

		await moveExportedTempFile(tempPath, destinationPath);

		await expect(fs.readFile(destinationPath, "utf8")).resolves.toBe("new-export");
		await expect(fs.access(tempPath)).rejects.toThrow();
		expect(copy).not.toHaveBeenCalled();
	});

	it("replaces the existing export from a private folder on the destination volume without copying", async () => {
		const target = await makeTempDir();
		const stagingDirectory = await fs.mkdtemp(path.join(target, ".leadcut-export-"));
		const tempPath = path.join(stagingDirectory, "leadcut-export-stream-test-final.mp4");
		const destinationPath = path.join(target, "export-final.mp4");
		await fs.writeFile(tempPath, "new-export");
		await fs.writeFile(destinationPath, "previous-export");
		registerOwnedExportPath(tempPath, true);
		vi.spyOn(fs, "rename").mockRejectedValueOnce(Object.assign(new Error("destination exists"), { code: "EPERM" }));
		const copy = vi.spyOn(fs, "copyFile");

		try {
			await moveExportedTempFile(tempPath, destinationPath);
		} finally {
			releaseOwnedExportPath(tempPath);
		}

		await expect(fs.readFile(destinationPath, "utf8")).resolves.toBe("new-export");
		await expect(fs.readdir(target)).resolves.toEqual(["export-final.mp4"]);
		expect(copy).not.toHaveBeenCalled();
	});

	it("copies into the destination volume only when the source and destination cannot be renamed across volumes", async () => {
		const source = await makeTempDir();
		const destination = await makeTempDir();
		const tempPath = path.join(source, "export-temp.mp4");
		const destinationPath = path.join(destination, "export-final.mp4");
		await fs.writeFile(tempPath, "new-export");
		vi.spyOn(fs, "rename").mockRejectedValueOnce(Object.assign(new Error("different volume"), { code: "EXDEV" }));
		const copy = vi.spyOn(fs, "copyFile");

		await moveExportedTempFile(tempPath, destinationPath);

		expect(copy).toHaveBeenCalledTimes(1);
		await expect(fs.readFile(destinationPath, "utf8")).resolves.toBe("new-export");
		await expect(fs.access(tempPath)).rejects.toThrow();
	});
});
