import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("HUD placement restores relative position and saves a new position after dragging", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getPlatform = async () => "win32";
		window.electronAPI.getHudOverlayPlacement = async () => ({
			displayId: 2, barPlacement: { displayId: 2, xRatio: 0.25, yRatio: 0.5 },
		});
		window.electronAPI.hudOverlaySetPlacement = async (kind, placement) => {
			document.documentElement.dataset.savedPlacement = JSON.stringify({ kind, ...placement });
			return true;
		};
		window.electronAPI.hudOverlayFollowCursorDisplay = () => {
			document.documentElement.dataset.followedCursorDisplay = "true";
		};
	});
	await page.goto("/?windowType=hud-overlay");
	const handle = page.getByTestId("hud-drag-handle");
	const bar = handle.locator("..");
	await expect.poll(() => bar.evaluate(node => {
		const rect = node.getBoundingClientRect();
		return [Math.round(rect.left / (innerWidth - rect.width) * 100), Math.round(rect.top / (innerHeight - rect.height) * 100)];
	})).toEqual([25, 50]);
	const box = (await handle.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 - 80, { steps: 6 });
	await page.mouse.up();
	const html = page.locator("html");
	await expect(html).toHaveAttribute("data-followed-cursor-display", "true");
	await expect(html).toHaveAttribute("data-saved-placement", /"kind":"bar"/);
	const saved = JSON.parse((await html.getAttribute("data-saved-placement"))!);
	expect(saved).toMatchObject({ kind: "bar", displayId: 2 });
	expect(saved.xRatio).toBeGreaterThan(0.25);
	expect(saved.xRatio).toBeLessThanOrEqual(1);
	expect(saved.yRatio).toBeGreaterThanOrEqual(0);
	expect(saved.yRatio).toBeLessThan(0.5);
});

test("HUD dividers are vertically centered", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=hud-overlay");
	const dividers = page.locator(".separator--vertical");
	await expect(dividers.first()).toBeVisible();
	const offsets = await dividers.evaluateAll((elements) =>
		elements.map((element) => {
			const bounds = element.getBoundingClientRect();
			const parent = element.parentElement!.getBoundingClientRect();
			return Math.abs(bounds.y + bounds.height / 2 - parent.y - parent.height / 2);
		}),
	);
	for (const offset of offsets) expect(offset).toBeLessThanOrEqual(1);
	const home = page.getByRole("button", { name: "Home", exact: true });
	await expect(home.locator("svg")).toHaveAttribute("data-icon-style", "bold");
	await expect(page.getByRole("button", { name: "More", exact: true })).toHaveCount(0);
	await expect.poll(() => home.locator("svg").evaluate((element) => {
		const { width, height } = element.getBoundingClientRect();
		return Math.max(Math.abs(width - 20), Math.abs(height - 20));
	})).toBeLessThan(0.5);
	await page.screenshot({ path: "test-results/hud-idle.png", animations: "disabled" });
	await home.click();
	await expect(page.locator("html")).toHaveAttribute("data-dashboard-opened", "true");
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("dialog", { name: "Projects dashboard" })).toBeVisible();
});

test("each idle HUD control shows a tooltip and the final button quits the app", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getRecordingDiskStatus = async () => ({
			freeBytes: 100_000_000_000,
			level: "ok",
		});
		window.electronAPI.hudOverlayQuitApp = () => {
			document.documentElement.dataset.hudQuitRequested = "true";
		};
	});
	await page.goto("/?windowType=hud-overlay");
	const handle = page.getByTestId("hud-drag-handle");
	const bar = handle.locator("..");
	await expect(handle).toBeVisible({ timeout: 20000 });
	await page.mouse.move(10, 10);
	await handle.hover();
	await expect(page.getByRole("tooltip")).toHaveText("Drag to move the toolbar");
	for (const [button, tooltip] of [
		["Built-in Display", "Select recording source"],
		["Disable system audio", "Disable system audio"],
		["Enable microphone", "Microphone"],
		["Enable webcam overlay", "Webcam"],
		["Countdown delay", "Countdown delay"],
		["Record", "Record"],
		["Home", "Home"],
		["Hide HUD", "Hide HUD"],
		["Close App", "Close App"],
	]) {
		await bar.getByRole("button", { name: button, exact: true }).hover();
		await expect(page.getByRole("tooltip").filter({ hasText: tooltip })).toBeVisible();
	}
	const close = bar.getByRole("button", { name: "Close App", exact: true });
	await expect(bar.getByRole("button").last()).toHaveAccessibleName("Close App");
	await expect(bar.getByRole("status")).toHaveCount(0);
	await expect(bar).not.toContainText(/about|\bmin\b|预计|可录|分钟/i);
	await close.click();
	await expect(page.locator("html")).toHaveAttribute("data-hud-quit-requested", "true");
});

test("Windows HUD exposes keystroke modes outside the countdown menu", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getPlatform = async () => "win32";
		window.electronAPI.setAppSetting = (key, value) => {
			if (key === "leadcut.keystrokeCaptureMode") document.documentElement.dataset.savedKeyCapture = String(value);
			return true;
		};
	});
	await page.goto("/?windowType=hud-overlay");
	const keyboard = page.getByRole("button", { name: "Record keystrokes", exact: true });
	await expect(keyboard).toHaveAttribute("data-key-capture", "all");
	await page.mouse.move(10, 10);
	await keyboard.hover();
	await expect(page.getByRole("tooltip")).toContainText("Ctrl + Alt + K");
	await expect(page.getByRole("tooltip")).toContainText("before entering a password");
	for (const [label, key] of [["Off", "off"], ["Shortcuts only", "shortcuts"], ["All keys", "all"]]) {
		await keyboard.click();
		await page.getByRole("button", { name: label, exact: true }).click();
		await expect(keyboard).toHaveAttribute("data-key-capture", key);
		await expect(page.locator("html")).toHaveAttribute("data-saved-key-capture", key);
	}
	await page.getByRole("button", { name: "Countdown delay", exact: true }).click();
	const countdown = page.getByRole("dialog", { name: "Options" });
	await expect(countdown.getByRole("button", { name: "3s", exact: true })).toBeVisible();
	await expect(countdown.getByRole("button", { name: "All keys", exact: true })).toHaveCount(0);
});

test("shows paused and unavailable key capture in the recording toolbar", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getPlatform = async () => "win32";
		window.electronAPI.onRecordingStateChanged = callback => {
			const listener = () => callback({ recording: true, sourceName: "Screen" });
			window.addEventListener("test-live-recording", listener);
			return () => window.removeEventListener("test-live-recording", listener);
		};
		window.electronAPI.onRecordingKeystrokeCaptureChanged = callback => {
			const listener = (event: Event) => callback((event as CustomEvent<boolean>).detail);
			window.addEventListener("test-key-capture-pause", listener);
			return () => window.removeEventListener("test-key-capture-pause", listener);
		};
		window.electronAPI.onRecordingKeystrokeCaptureUnavailable = callback => {
			window.addEventListener("test-key-capture-unavailable", callback);
			return () => window.removeEventListener("test-key-capture-unavailable", callback);
		};
	});
	await page.goto("/?windowType=hud-overlay");
	await expect(page.getByRole("button", { name: "Record keystrokes", exact: true })).toBeVisible();
	await page.evaluate(() => window.dispatchEvent(new Event("test-live-recording")));
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
	const indicator = page.locator('[role="img"][data-key-capture]');
	await expect(indicator).toHaveAttribute("data-key-capture", "all");
	await page.evaluate(() => window.dispatchEvent(new CustomEvent("test-key-capture-pause", { detail: true })));
	await expect(indicator).toHaveAttribute("data-key-capture", "paused");
	await expect(indicator).toHaveAccessibleName("Keystroke capture paused");
	await page.evaluate(() => window.dispatchEvent(new CustomEvent("test-key-capture-pause", { detail: false })));
	await expect(indicator).toHaveAttribute("data-key-capture", "all");
	await page.evaluate(() => window.dispatchEvent(new Event("test-key-capture-unavailable")));
	await expect(indicator).toHaveAttribute("data-key-capture", "unavailable");
	await expect(page.getByText("Keystroke capture is unavailable for this recording.", { exact: true })).toBeVisible();
});

test("recording HUD uses uniform controls and a readable timer", async ({ page }) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.onRecordingStateChanged = (callback) => {
			const listener = () => callback({ recording: true, sourceName: "Built-in Display" });
			window.addEventListener("test-recording-started", listener);
			return () => window.removeEventListener("test-recording-started", listener);
		};
	});
	await page.goto("/?windowType=hud-overlay");
	await expect(page.locator(".separator--vertical").first()).toBeVisible({ timeout: 20000 });
	await page.evaluate(() => window.dispatchEvent(new Event("test-recording-started")));
	const controls = page.getByRole("group", { name: "Recording controls" });
	await expect(controls).toBeVisible();
	await expect(controls.getByRole("status")).toContainText("00:00");
	await expect(controls.getByRole("button", { name: "Home", exact: true })).toBeVisible();
	const sizes = await controls.getByRole("button").evaluateAll((buttons) =>
		buttons.map((button) => {
			return [(button as HTMLElement).offsetWidth, (button as HTMLElement).offsetHeight];
		}),
	);
	for (const size of sizes) expect(size).toEqual([36, 36]);
	await page.screenshot({ path: "test-results/hud-recording.png" });
	await page.mouse.move(10, 10);
	for (const name of ["Home", "Pause", "Stop", "Hide HUD", "Discard recording"]) {
		await controls.getByRole("button", { name, exact: true }).hover();
		await expect(page.getByRole("tooltip").filter({ hasText: name })).toBeVisible();
	}
});

test("discarding a live recording requires confirmation and is separate from closing the app", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		const success = async () => ({ success: true });
		Object.assign(window.electronAPI, {
			getPlatform: async () => "win32",
			getSelectedSource: async () => ({ id: "screen:1:0", name: "Screen 1", sourceType: "screen" }),
			isNativeWindowsCaptureAvailable: async () => ({ available: true }),
			startNativeScreenRecording: success,
			startCountdown: success,
			pauseNativeScreenRecording: success,
			resumeNativeScreenRecording: success,
			setRecordingState: async (recording: boolean) => {
				document.documentElement.dataset.nativeRecording = String(recording);
				return { success: true };
			},
			stopNativeScreenRecording: async () => {
				document.documentElement.dataset.nativeStopped = "true";
				return { success: true, path: "/recordings/recording-123.mp4" };
			},
			deleteRecordingFile: async (capture: string) => {
				document.documentElement.dataset.captureDiscarded = capture;
				return { success: true };
			},
		});
	});
	await page.goto("/?windowType=hud-overlay");
	const html = page.locator("html");
	const close = page.getByRole("button", { name: "Close App", exact: true });
	await expect(close).toBeVisible();
	await page.getByRole("button", { name: "Record", exact: true }).click();
	await expect(html).toHaveAttribute("data-native-recording", "true");
	await expect(close).toHaveCount(0);
	const annotation = page.getByRole("button", { name: "Screen annotation", exact: true });
	await expect(annotation).toBeDisabled();
	await annotation.locator("..").hover();
	await expect(page.getByRole("tooltip").filter({ hasText: "unavailable while recording a window" })).toBeVisible();
	await page.getByRole("button", { name: "Discard recording", exact: true }).click();
	const confirm = page.getByRole("button", { name: "Press again to discard", exact: true });
	await expect(confirm).toBeVisible();
	await expect(html).toHaveAttribute("data-native-recording", "true");
	await expect(html).not.toHaveAttribute("data-native-stopped");
	await confirm.click();
	await expect(html).toHaveAttribute("data-native-recording", "false");
	await expect(html).toHaveAttribute("data-native-stopped", "true");
	await expect(html).toHaveAttribute("data-capture-discarded", "/recordings/recording-123.mp4");
	await expect(close).toBeVisible();
});

test("New recording mode starts the webcam with an editor still open and releases it on Home", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.getEditorMode = async () => true;
		window.electronAPI.onEditorModeChanged = (callback) => {
			const listener = (event: Event) => callback((event as CustomEvent<boolean>).detail);
			window.addEventListener("test-editor-mode", listener);
			return () => window.removeEventListener("test-editor-mode", listener);
		};
		window.electronAPI.getRecordingPreferences = async () => ({
			success: true,
			microphoneEnabled: false,
			webcamEnabled: true,
			systemAudioEnabled: false,
		});
		navigator.mediaDevices.getUserMedia = async () => {
			const canvas = document.createElement("canvas");
			canvas.width = 320;
			canvas.height = 320;
			const context = canvas.getContext("2d")!;
			context.fillStyle = "#2874ff";
			context.fillRect(0, 0, 320, 320);
			const stream = canvas.captureStream(24);
			setInterval(() => context.fillRect(0, 0, 320, 320), 100);
			return stream;
		};
		navigator.mediaDevices.enumerateDevices = async () => [];
	});
	await page.goto("/?windowType=hud-overlay");
	const preview = page.locator("video").first();
	await expect(preview).toBeVisible();
	await expect
		.poll(() => preview.evaluate((video: HTMLVideoElement) => video.srcObject === null))
		.toBe(true);
	await page.evaluate(() =>
		window.dispatchEvent(new CustomEvent("test-editor-mode", { detail: false })),
	);
	await expect
		.poll(() =>
			preview.evaluate(
				(video: HTMLVideoElement) =>
					!!video.srcObject && !video.paused && video.videoWidth === 320,
			),
		)
		.toBe(true);
	await page.evaluate(() =>
		window.dispatchEvent(new CustomEvent("test-editor-mode", { detail: true })),
	);
	await expect
		.poll(() => preview.evaluate((video: HTMLVideoElement) => video.srcObject === null))
		.toBe(true);
});

for (const storageBlocked of [false, true]) {
	test(`floating webcam preview resizes from its corners ${storageBlocked ? "when storage is unavailable" : "and remembers the size"}`, async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await installDesktopBridge(page);
		if (storageBlocked) {
			await page.addInitScript(() => {
				const getItem = Storage.prototype.getItem;
				const setItem = Storage.prototype.setItem;
				Storage.prototype.getItem = function (key) {
					if (key === "leadcut.webcam-preview-size")
						throw new Error("Storage unavailable");
					return getItem.call(this, key);
				};
				Storage.prototype.setItem = function (key, value) {
					if (key === "leadcut.webcam-preview-size")
						throw new Error("Storage unavailable");
					return setItem.call(this, key, value);
				};
			});
		}
		await page.addInitScript(() => {
			window.electronAPI.hudOverlaySetIgnoreMouse = async (ignore) => {
				document.documentElement.dataset.webcamPassthrough = String(ignore);
				return { success: true };
			};
			window.electronAPI.getRecordingPreferences = async () => ({
				success: true,
				microphoneEnabled: false,
				webcamEnabled: true,
				systemAudioEnabled: false,
			});
			navigator.mediaDevices.getUserMedia = async () => {
				const canvas = document.createElement("canvas");
				canvas.getContext("2d")!.fillRect(0, 0, 320, 320);
				return canvas.captureStream(24);
			};
			navigator.mediaDevices.enumerateDevices = async () => [];
		});
		await page.goto("/?windowType=hud-overlay");
		const preview = page.locator("[data-resize-handle]").first().locator("..");
		await expect(preview).toBeVisible();
		const before = (await preview.boundingBox())!;
		expect([before.width, before.height]).toEqual([288, 288]);

		const dragHandle = async (handle: string, dx: number, dy: number) => {
			const box = (await preview.locator(`[data-resize-handle="${handle}"]`).boundingBox())!;
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
			await page.mouse.down();
			await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, {
				steps: 5,
			});
			await page.mouse.up();
		};

		// Top-left grows the preview while the bottom-right corner stays anchored.
		await dragHandle("nw", -60, -40);
		const grown = (await preview.boundingBox())!;
		expect([grown.width, grown.height]).toEqual([348, 328]);
		expect(grown.x + grown.width).toBeCloseTo(before.x + before.width);
		expect(grown.y + grown.height).toBeCloseTo(before.y + before.height);

		// Bottom-right shrinks the preview while the top-left corner stays put, down to the minimum.
		await dragHandle("se", -500, -500);
		const shrunk = (await preview.boundingBox())!;
		expect([shrunk.width, shrunk.height]).toEqual([120, 120]);
		expect(shrunk.x).toBeCloseTo(grown.x);
		expect(shrunk.y).toBeCloseTo(grown.y);
		await expect(page.locator("html")).toHaveAttribute("data-webcam-passthrough", "true");

		await page.reload();
		await expect(preview).toBeVisible();
		const restored = (await preview.boundingBox())!;
		expect([restored.width, restored.height]).toEqual(storageBlocked ? [288, 288] : [120, 120]);
		expect(errors).toEqual([]);
	});
}
