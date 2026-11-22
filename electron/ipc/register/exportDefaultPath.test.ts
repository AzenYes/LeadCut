import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { dialog, ipcMain } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readAppSetting, writeAppSetting } from "../../appSettingsStore";
import { LAST_EXPORT_DIRECTORY_SETTING_KEY } from "../../../src/lib/storageKeys";
import { registerExportHandlers, resolveDefaultExportDirectory, resolveUniqueExportFileName } from "./export";

vi.mock("electron", () => ({
	app: {
		setName: vi.fn(),
		setPath: vi.fn(),
		getAppPath: () => process.cwd(),
		getPath: () => os.tmpdir(),
		isPackaged: false,
	},
	BrowserWindow: { fromWebContents: () => null },
	dialog: { showSaveDialog: vi.fn() },
	ipcMain: { handle: vi.fn(), on: vi.fn() },
}));
vi.mock("../../appSettingsStore", () => ({ readAppSetting: vi.fn(), writeAppSetting: vi.fn() }));
vi.mock("../ffmpeg/binary", () => ({ getFfmpegBinaryPath: () => "ffmpeg" }));

let directory: string;
beforeEach(async () => {
	vi.resetAllMocks();
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-export-default-"));
});
afterEach(() => fs.rm(directory, { recursive: true, force: true }));

it("falls back to Downloads for absent and unavailable paths", async () => {
	await expect(resolveDefaultExportDirectory()).resolves.toBe(os.tmpdir());
	vi.mocked(readAppSetting).mockReturnValue(path.join(directory, "unmounted"));
	await expect(resolveDefaultExportDirectory()).resolves.toBe(os.tmpdir());
});

it("restores the last existing directory and skips files", async () => {
	vi.mocked(readAppSetting).mockReturnValue(directory);
	await expect(resolveDefaultExportDirectory()).resolves.toBe(directory);
	const pathToFile = path.join(directory, "not-a-directory.mp4");
	await fs.writeFile(pathToFile, "existing file");
	vi.mocked(readAppSetting).mockReturnValue(pathToFile);
	await expect(resolveDefaultExportDirectory()).resolves.toBe(os.tmpdir());
});

it("uses the first available numbered file without destroying a dotted name", () => {
	const original = "v1.2 demo.mp4";
	const existing = new Set([path.join(directory, original)]);
	expect(resolveUniqueExportFileName(directory, original, file => existing.has(file))).toBe("v1.2 demo (2).mp4");
	existing.add(path.join(directory, "v1.2 demo (2).mp4"));
	expect(resolveUniqueExportFileName(directory, original, file => existing.has(file))).toBe("v1.2 demo (3).mp4");
});

it("offers the remembered directory and persists only a confirmed choice", async () => {
	vi.mocked(readAppSetting).mockReturnValue(directory);
	await fs.writeFile(path.join(directory, "Project.mp4"), "existing file");
	registerExportHandlers();
	const choose = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "choose-export-path")?.[1];
	expect(choose).toBeDefined();
	vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: true, filePath: "" });
	const event = { sender: {} } as Electron.IpcMainInvokeEvent;
	await expect(choose!(event, "Project.mp4")).resolves.toEqual({ success: false, canceled: true });
	expect(dialog.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
		defaultPath: path.join(directory, "Project (2).mp4"),
	}));
	expect(writeAppSetting).not.toHaveBeenCalled();
	const selected = path.join(directory, "different", "Chosen.mp4");
	vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: selected });
	await expect(choose!(event, "Project.mp4")).resolves.toEqual({ success: true, path: selected });
	expect(writeAppSetting).toHaveBeenCalledWith(LAST_EXPORT_DIRECTORY_SETTING_KEY, path.dirname(selected));
});
