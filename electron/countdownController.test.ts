import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createCountdownController, getCountdownWindowPosition } from "./countdownController";
function fixture(loading = false) {
	const contents = Object.assign(new EventEmitter(), {
		isLoadingMainFrame: () => loading,
		isDestroyed: () => false,
		send: vi.fn(),
	});
	const win = Object.assign(new EventEmitter(), {
		webContents: contents,
		isDestroyed: () => false,
		close: vi.fn(),
	});
	const state = vi.fn();
	const controller = createCountdownController(() => win as unknown as BrowserWindow, state);
	return { controller, win, contents, state };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it("cancels an active countdown immediately and allows another start", async () => {
	const { controller, state } = fixture();
	const pending = controller.start(3);
	controller.cancel();
	await expect(pending).resolves.toEqual({ success: false, cancelled: true });
	expect(state).toHaveBeenLastCalledWith(null);
	expect(vi.getTimerCount()).toBe(0);
	const next = controller.start(1);
	await vi.advanceTimersByTimeAsync(1000);
	await expect(next).resolves.toEqual({ success: true });
});
it("settles cancellation before the countdown renderer finishes loading", async () => {
	const { controller, contents } = fixture(true);
	const pending = controller.start(3);
	controller.cancel();
	await expect(pending).resolves.toEqual({ success: false, cancelled: true });
	contents.emit("did-finish-load");
	expect(contents.send).not.toHaveBeenCalled();
	expect(vi.getTimerCount()).toBe(0);
});
it.each([
	"closed",
	"render-process-gone",
])("settles when the window exits through %s", async (event) => {
	const { controller, win, contents } = fixture(true);
	const pending = controller.start(3);
	(event === "closed" ? win : contents).emit(event);
	await expect(pending).resolves.toEqual({ success: false, cancelled: true });
});
it("settles loading failures and releases the countdown lock", async () => {
	const { controller, contents } = fixture(true);
	const pending = controller.start(3);
	contents.emit("did-fail-load");
	await expect(pending).resolves.toMatchObject({ success: false, error: expect.any(String) });
	const next = controller.start(1);
	contents.emit("did-finish-load");
	await vi.advanceTimersByTimeAsync(1000);
	await expect(next).resolves.toEqual({ success: true });
});
it("rejects concurrent starts and emits ticks until normal completion", async () => {
	const { controller, contents } = fixture();
	const pending = controller.start(2);
	await expect(controller.start(3)).resolves.toMatchObject({
		success: false,
		error: expect.any(String),
	});
	await vi.advanceTimersByTimeAsync(2000);
	await expect(pending).resolves.toEqual({ success: true });
	expect(contents.send.mock.calls).toEqual([
		["countdown-tick", 2],
		["countdown-tick", 1],
	]);
	expect(vi.getTimerCount()).toBe(0);
});
it("resets state if creating the countdown window fails", async () => {
	const state = vi.fn();
	const controller = createCountdownController(() => {
		throw Error("window unavailable");
	}, state);
	await expect(controller.start(3)).resolves.toMatchObject({
		success: false,
		error: expect.any(String),
	});
	expect(state).toHaveBeenLastCalledWith(null);
});

it("can retain a prepared window and reuse it for consecutive countdowns", async () => {
	const { win, contents, state } = fixture();
	const release = vi.fn();
	const controller = createCountdownController(() => win as unknown as BrowserWindow, state, release);
	for (let i = 0; i < 2; i++) {
		const pending = controller.start(1);
		await vi.advanceTimersByTimeAsync(1000);
		await expect(pending).resolves.toEqual({ success: true });
	}
	expect(contents.send.mock.calls).toEqual([["countdown-tick", 1], ["countdown-tick", 1]]);
	expect(release).toHaveBeenCalledTimes(2);
	expect(win.close).not.toHaveBeenCalled();
});

it("passes the caller's work area unchanged to the countdown window", async () => {
	const { win, state } = fixture();
	const createWindow = vi.fn(() => win as unknown as BrowserWindow);
	const controller = createCountdownController(createWindow, state);
	const area = { x: -1600, y: 60, width: 1600, height: 925 };
	const pending = controller.start(1, area);
	await vi.advanceTimersByTimeAsync(1000);
	await expect(pending).resolves.toEqual({ success: true });
	expect(createWindow).toHaveBeenCalledWith(area);
});

it("leaves the work area undefined when using the HUD display", async () => {
	const { win, state } = fixture();
	const createWindow = vi.fn(() => win as unknown as BrowserWindow);
	const controller = createCountdownController(createWindow, state);
	const pending = controller.start(1);
	await vi.advanceTimersByTimeAsync(1000);
	await expect(pending).resolves.toEqual({ success: true });
	expect(createWindow).toHaveBeenCalledWith(undefined);
});

it("centers the 200 px window in an offset work area", () => {
	expect(getCountdownWindowPosition({ x: 1920, y: 0, width: 2560, height: 1400 }))
		.toEqual({ x: 3100, y: 600 });
});
