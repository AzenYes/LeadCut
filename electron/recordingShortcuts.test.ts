import { beforeEach, expect, it, vi } from "vitest";
import {
	applyRecordingShortcuts,
	bindingToAccelerator,
	DEFAULT_RECORDING_SHORTCUTS,
	findRecordingShortcutConflict,
	getRecordingShortcuts,
	saveRecordingShortcuts,
	startRecordingShortcuts,
} from "./recordingShortcuts";

const state = vi.hoisted(() => ({
	register: vi.fn((_accelerator: string, _callback: () => void) => true),
	unregister: vi.fn(),
	setSuspended: vi.fn(),
	read: vi.fn<() => unknown>(),
	write: vi.fn(),
}));
vi.mock("electron", () => ({ globalShortcut: state, BrowserWindow: {} }));
vi.mock("./appSettingsStore", () => ({ readAppSetting: state.read, writeAppSetting: state.write }));
vi.mock("./logger", () => ({ appLog: vi.fn() }));

beforeEach(() => {
	vi.resetAllMocks();
	state.register.mockReturnValue(true);
});

it("formats CommandOrControl, Alt, Shift and named accelerator keys", () => {
	expect(bindingToAccelerator({ key: "R", ctrl: true, alt: true })).toBe("CommandOrControl+Alt+R");
	expect(bindingToAccelerator({ key: "ArrowDown", shift: true, alt: true })).toBe("Alt+Shift+Down");
	expect(bindingToAccelerator({ key: "+", ctrl: true })).toBe("CommandOrControl+Plus");
	expect(bindingToAccelerator({ key: "Dead", alt: true })).toBeNull();
});

it("rejects bindings without Ctrl or Alt and duplicate accelerators", () => {
	const defaults = DEFAULT_RECORDING_SHORTCUTS;
	expect(findRecordingShortcutConflict({ ...defaults, toggleRecording: { key: "r", shift: true } }))
		.toEqual({ type: "modifier", action: "toggleRecording" });
	expect(findRecordingShortcutConflict({ ...defaults, togglePause: { key: "R", ctrl: true, alt: true } }))
		.toEqual({ type: "duplicate", action: "togglePause", other: "toggleRecording" });
});

it("routes registered actions and reports occupied combinations", () => {
	state.register.mockImplementation(accelerator => accelerator !== "CommandOrControl+Alt+P");
	const toggleRecording = vi.fn();
	expect(applyRecordingShortcuts(DEFAULT_RECORDING_SHORTCUTS, { toggleRecording })).toEqual(["togglePause"]);
	state.register.mock.calls.find(([key]) => key === "CommandOrControl+Alt+R")?.[1]();
	expect(toggleRecording).toHaveBeenCalledOnce();
});

it("unregisters the old bindings before applying and persisting replacements", () => {
	startRecordingShortcuts({});
	state.unregister.mockClear();
	state.register.mockClear();
	const replacement = { ...DEFAULT_RECORDING_SHORTCUTS, toggleRecording: { key: "b", ctrl: true } };
	expect(saveRecordingShortcuts(replacement)).toMatchObject({ success: true, failed: [] });
	expect(state.unregister).toHaveBeenCalledWith("CommandOrControl+Alt+R");
	expect(state.unregister.mock.invocationCallOrder.at(-1)!).toBeLessThan(state.register.mock.invocationCallOrder[0]);
	expect(state.register).toHaveBeenCalledWith("CommandOrControl+B", expect.any(Function));
	expect(state.write).toHaveBeenCalledWith("leadcut.recordingShortcuts", expect.objectContaining({
		toggleRecording: expect.objectContaining({ key: "b" }),
	}), { flush: true });
});

it("restores configured keys when the store cannot be written", () => {
	startRecordingShortcuts({});
	state.write.mockImplementation(() => { throw new Error("read-only"); });
	const replacement = { ...DEFAULT_RECORDING_SHORTCUTS, toggleRecording: { key: "b", ctrl: true } };
	expect(saveRecordingShortcuts(replacement).success).toBe(false);
	expect(getRecordingShortcuts().config).toEqual(DEFAULT_RECORDING_SHORTCUTS);
	expect(state.register).toHaveBeenCalledWith("CommandOrControl+Alt+R", expect.any(Function));
});
