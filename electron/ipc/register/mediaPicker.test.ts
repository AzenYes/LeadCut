import { beforeEach, describe, expect, it, vi } from "vitest";
type IpcHandler = (...args: unknown[]) => unknown;
const mocks = vi.hoisted(() => ({ handlers: new Map<string, IpcHandler>(), picker: vi.fn(), approve: vi.fn(), changeProject: vi.fn(), loadProject: vi.fn() }));
vi.mock("electron", () => ({ dialog: { showOpenDialog: mocks.picker }, ipcMain: { handle: (name: string, handler: IpcHandler) => mocks.handlers.set(name, handler) } }));
vi.mock("../../uiI18n", () => ({ uiText: (key: string) => key, localizeNativeUiMessage: (value: string) => value }));
vi.mock("../constants", () => ({ PROJECT_FILE_EXTENSION: "recordly", LEGACY_PROJECT_FILE_EXTENSIONS: [] }));
vi.mock("../state", () => ({ setCurrentProjectPath: mocks.changeProject }));
vi.mock("../utils", () => ({ approveUserPath: mocks.approve, getRecordingsDir: async () => "/recordings" }));
vi.mock("../project/manager", () => ({ hasProjectFileExtension: (file: string) => file.endsWith(".leadcut"), loadProjectFromPath: mocks.loadProject }));
vi.mock("../captions/generate", () => ({ generateAutoCaptionsFromVideo: vi.fn() }));
vi.mock("../captions/srtImport", () => ({ importSrtFile: vi.fn(), SrtImportError: class extends Error {} }));
vi.mock("../captions/whisper", () => ({ cancelWhisperModelDownload: vi.fn(), deleteWhisperSmallModel: vi.fn(), downloadWhisperSmallModel: vi.fn(), getWhisperSmallModelStatus: vi.fn(), sendWhisperModelDownloadProgress: vi.fn() }));
import { registerCaptionHandlers } from "./captions";
import { configureTrustedIpcDocuments } from "../../trustedIpc";
const url = "http://127.0.0.1:45920/";
const senderFrame = { url };
const trustedPicker = { senderFrame, sender: { mainFrame: senderFrame, getURL: () => url, isDestroyed: () => false } };
beforeEach(() => { vi.clearAllMocks(); mocks.handlers.clear(); configureTrustedIpcDocuments(() => [url]); registerCaptionHandlers(); });
describe("media import retains the active project", () => {
 it.each(["open-video-file-picker", "open-audio-file-picker"])("%s approves the imported media without invalidating the saved project", async (channel) => {
  mocks.picker.mockResolvedValue({ canceled: false, filePaths: ["/broll.mp4"] });
  await expect(mocks.handlers.get(channel)!(trustedPicker)).resolves.toMatchObject({ success: true, path: "/broll.mp4" });
  expect(mocks.approve).toHaveBeenCalledWith("/broll.mp4");
  expect(mocks.changeProject).not.toHaveBeenCalled();
 });
 it("canceling the picker does not change project or file access", async () => {
  mocks.picker.mockResolvedValue({ canceled: true, filePaths: [] });
  await expect(mocks.handlers.get("open-video-file-picker")!(trustedPicker)).resolves.toMatchObject({ canceled: true });
  expect(mocks.approve).not.toHaveBeenCalled(); expect(mocks.changeProject).not.toHaveBeenCalled();
 });
});
