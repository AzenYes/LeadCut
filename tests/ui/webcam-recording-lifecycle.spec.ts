import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const interruption of ["normal stop", "unexpected stop", "encoder error", "track ended"]) {
	test(`webcam shares preview capture and preserves the video on ${interruption}`, async ({
		page,
	}) => {
		await installDesktopBridge(page);
		await installDesktopBridgeOverrides(page, (mode) => {
			const success = async () => ({ success: true });
			const cameraSaved = new Promise<void>(resolve => {
				window.addEventListener("test-release-camera-file", () => resolve(), { once: true });
			});
			Object.assign(window.electronAPI, {
				getPlatform: async () => "win32",
				getCountdownDelay: async () => ({ success: true, delay: 0 }),
				getRecordingPreferences: async () => ({
					success: true,
					webcamEnabled: true,
					microphoneEnabled: false,
					systemAudioEnabled: false,
				}),
				isNativeWindowsCaptureAvailable: async () => ({ available: true }),
				startNativeScreenRecording: async () => {
					document.documentElement.dataset.nativeStarted = "true";
					return { success: true };
				},
				setRecordingState: success,
				stopNativeScreenRecording: async () => {
					document.documentElement.dataset.nativeStopped = "true";
					return { success: true, path: "/recordings/screen.mp4" };
				},
				muxNativeWindowsRecording: success,
				switchToEditor: async () => {
					document.documentElement.dataset.editorOpened = "true";
					return { success: true };
				},
				hudOverlayClose: success,
				writeWebcamChunk: async (_name: string, data: ArrayBuffer) => {
					const root = document.documentElement;
					root.dataset.webcamSavedBytes = String(Number(root.dataset.webcamSavedBytes ?? 0) + data.byteLength);
				},
				finishWebcamFile: async (name: string) => {
					if (mode === "normal stop") await cameraSaved;
					return `/recordings/${name}`;
				},
				setCurrentRecordingSession: async (session: { webcamPath?: string | null }, options?: { background?: string }) => {
					if (options?.background === "camera") document.documentElement.dataset.sessionWebcam = session.webcamPath ?? "missing";
					return { success: true };
				},
			});
			Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
				value: async () => [],
			});
			let cameraRequests = 0;
			Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
				value: async () => {
					document.documentElement.dataset.cameraRequests = String(++cameraRequests);
					const canvas = document.createElement("canvas");
					canvas.width = 320;
					canvas.height = 180;
					const context = canvas.getContext("2d")!;
					setInterval(() => {
						context.fillStyle = `hsl(${Date.now() % 360} 60% 50%)`;
						context.fillRect(0, 0, 320, 180);
					}, 33);
					return canvas.captureStream(30);
				},
			});
			const Recorder = window.MediaRecorder;
			window.MediaRecorder = class extends Recorder {
				constructor(stream: MediaStream, options?: MediaRecorderOptions) {
					super(stream, options);
					window.addEventListener("test-camera-interrupted", () => this.stop(), {
						once: true,
					});
					window.addEventListener(
						"test-camera-error",
						() => this.dispatchEvent(new Event("error")),
						{ once: true },
					);
					window.addEventListener(
						"test-camera-ended",
						() => stream.getVideoTracks()[0].dispatchEvent(new Event("ended")),
						{ once: true },
					);
				}
			};
		}, interruption);
		await page.goto("/?windowType=hud-overlay");
		await expect(page.locator("html")).toHaveAttribute("data-camera-requests", "1");
		await page.getByRole("button", { name: "Record", exact: true }).click();
		await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
		await expect(page.locator("html")).toHaveAttribute("data-camera-requests", "1");
		// Accumulate actual encoded frames, then exercise both stop paths.
		await page.waitForTimeout(1500);
		if (interruption !== "normal stop") {
			await page.evaluate(
				(mode) =>
					window.dispatchEvent(
						new Event(
							mode === "encoder error"
								? "test-camera-error"
								: mode === "track ended"
									? "test-camera-ended"
									: "test-camera-interrupted",
						),
					),
				interruption,
			);
			await expect(
				page.getByText("Camera disconnected. Screen recording continues.", { exact: true }),
			).toBeVisible();
			await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
			await expect(page.locator("html")).not.toHaveAttribute("data-native-stopped", "true");
			await expect(page.getByRole("img", { name: "Camera disconnected. Screen recording continues." })).toBeVisible();
			await page.getByRole("button", { name: "Stop Recording", exact: true }).click();
		} else {
			await page.getByRole("button", { name: "Stop", exact: true }).click();
		}
		await expect(page.locator("html")).toHaveAttribute("data-native-stopped", "true");
		await expect(page.locator("html")).toHaveAttribute("data-editor-opened", "true");
		if (interruption === "normal stop") {
			await expect(page.locator("html")).not.toHaveAttribute("data-session-webcam");
			await page.evaluate(() => window.dispatchEvent(new Event("test-release-camera-file")));
		}
		await expect
			.poll(() => page.locator("html").getAttribute("data-session-webcam"))
			.toMatch(/-webcam\.(mp4|webm)$/);
		expect(
			Number(await page.locator("html").getAttribute("data-webcam-saved-bytes")),
		).toBeGreaterThan(1000);
	});
}

test("screen recording still starts when the camera cannot be prepared", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		Object.assign(window.electronAPI, {
			getPlatform: async () => "win32",
			getCountdownDelay: async () => ({ success: true, delay: 0 }),
			getRecordingPreferences: async () => ({
				success: true, webcamEnabled: true, microphoneEnabled: false, systemAudioEnabled: false,
			}),
			isNativeWindowsCaptureAvailable: async () => ({ available: true }),
			startNativeScreenRecording: async () => ({ success: true }),
			setRecordingState: async () => undefined,
		});
		Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
			value: async () => { throw new DOMException("No camera", "NotFoundError"); },
		});
	});
	await page.goto("/?windowType=hud-overlay");
	await page.getByRole("button", { name: "Record", exact: true }).click();
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
	await expect(page.getByText("Camera unavailable. Recording the screen only.", { exact: true })).toBeVisible();
});

test("the recording HUD shows a microphone meter and reports pause failures", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getRecordingState = async () => ({
			recording: true, paused: false, elapsedMs: 6000, backend: "native-windows",
		});
		window.electronAPI.getRecordingPreferences = async () => ({
			success: true, microphoneEnabled: true, webcamEnabled: false, systemAudioEnabled: false,
		});
		window.electronAPI.pauseNativeScreenRecording = async () => ({ success: false, error: "fixture pause failed" });
		Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
			value: async () => new MediaStream(),
		});
	});
	await page.goto("/?windowType=hud-overlay");
	await expect(page.getByRole("meter", { name: "Microphone level" })).toBeVisible();
	await page.getByRole("button", { name: "Pause", exact: true }).click();
	await expect(page.getByText("Could not pause the recording.", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Resume", exact: true })).toHaveCount(0);
});
