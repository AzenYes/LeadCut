import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { configureTrustedIpcDocuments, handleTrustedIpc, onTrustedIpc } from "./trustedIpc";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn(), on: vi.fn(), removeListener: vi.fn() } }));

const application = "http://127.0.0.1:45920/";
const editor = `${application}?windowType=editor`;
function rendererEvent(frameUrl: string, currentUrl = frameUrl, topLevel = true) {
	const senderFrame = { url: frameUrl };
	return {
		senderFrame,
		sender: {
			isDestroyed: () => false,
			getURL: () => currentUrl,
			mainFrame: topLevel ? senderFrame : { url: currentUrl },
		},
	} as IpcMainInvokeEvent & IpcMainEvent;
}

describe("trusted application IPC", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		configureTrustedIpcDocuments(() => [application, "file:///C:/LeadCut/resources/app.asar/dist/index.html"]);
	});

	it("routes requests from application main frames and rejects other frames or documents", () => {
		const listener = vi.fn(() => "ok");
		handleTrustedIpc("test-request", listener);
		const dispatch = vi.mocked(ipcMain.handle).mock.calls[0][1];
		const trusted = rendererEvent(editor);
		expect(dispatch(trusted, 10)).toBe("ok");
		expect(dispatch(rendererEvent("file:///C:/LeadCut/resources/app.asar/dist/index.html?windowType=countdown"))).toBe("ok");
		for (const event of [
			rendererEvent(editor, editor, false),
			rendererEvent("http://127.0.0.1:45921/?windowType=editor"),
			rendererEvent(`${application}assets/index.html`),
			rendererEvent(editor, "https://example.test"),
			rendererEvent(""),
		]) expect(() => dispatch(event)).toThrow("Untrusted application IPC sender");
		expect(listener).toHaveBeenCalledTimes(2);
		expect(listener).toHaveBeenCalledWith(trusted, 10);
	});

	it("returns a synchronous response on denial and removes the registered event wrapper", () => {
		const listener = vi.fn();
		const cleanup = onTrustedIpc("test-event", listener);
		const dispatch = vi.mocked(ipcMain.on).mock.calls[0][1];
		const rejected = rendererEvent(editor, editor, false);
		dispatch(rejected, "ignored");
		expect(rejected.returnValue).toBeNull();
		expect(listener).not.toHaveBeenCalled();
		const trusted = rendererEvent(editor);
		dispatch(trusted, "accepted");
		expect(listener).toHaveBeenCalledWith(trusted, "accepted");
		cleanup();
		expect(ipcMain.removeListener).toHaveBeenCalledWith("test-event", dispatch);
	});
});
