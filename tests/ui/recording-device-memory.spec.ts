import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

type Preferences = Partial<Awaited<ReturnType<Window["electronAPI"]["getRecordingPreferences"]>>>;
const writes = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("recording-pref-writes") ?? "[]") as Preferences[]);

async function openHud(page: Page, preferences: Preferences, otherCameraId = "camera-b") {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, ({ preferences, otherCameraId }) => {
		const saved: Preferences = {
			systemAudioEnabled: false, webcamEnabled: true, microphoneEnabled: true,
			...preferences, ...JSON.parse(sessionStorage.getItem("saved-recording-preferences") ?? "{}"),
		};
		const calls: Preferences[] = [];
		window.electronAPI.getRecordingPreferences = async () => ({
			success: true, systemAudioEnabled: false, webcamEnabled: true, microphoneEnabled: true, ...saved,
		});
		window.electronAPI.setRecordingPreferences = async (patch) => {
			calls.push(patch);
			Object.assign(saved, patch);
			sessionStorage.setItem("recording-pref-writes", JSON.stringify(calls, (_key, value) => value === undefined ? null : value));
			sessionStorage.setItem("saved-recording-preferences", JSON.stringify(saved));
			return { success: true };
		};
		sessionStorage.removeItem("recording-pref-writes");
		let cameraId = otherCameraId;
		window.addEventListener("test-camera-changed", (event) => {
			cameraId = (event as CustomEvent<string>).detail;
			navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
		});
		const device = (kind: MediaDeviceKind, deviceId: string, label: string) => ({
			kind, deviceId, label, groupId: deviceId, toJSON: () => ({ kind, deviceId, label }),
		});
		navigator.mediaDevices.enumerateDevices = async () => [
			device("audioinput", "default", "Default microphone"),
			device("audioinput", "mic-a", "Microphone A"),
			device("audioinput", "mic-b", "Microphone B"),
			device("videoinput", "camera-a", "Camera A"),
			...(cameraId ? [device("videoinput", cameraId, "Camera B")] : []),
		];
		navigator.mediaDevices.getUserMedia = async (constraints) =>
			constraints?.video ? document.createElement("canvas").captureStream(1) : new MediaStream();
	}, { preferences, otherCameraId });
	await page.goto("/?windowType=hud-overlay");
	await expect(page.getByRole("button", { name: "Enable system audio", exact: true })).toBeVisible();
}

const openCamera = (page: Page) => page.getByRole("button", { name: "Disable webcam overlay", exact: true }).click();
const openMic = (page: Page) => page.getByRole("button", { name: "Disable microphone", exact: true }).click();
const row = (page: Page, label: string) => page.getByRole("button", { name: label, exact: true });

test("restores the second webcam without rewriting the saved device", async ({ page }) => {
	await openHud(page, { webcamDeviceId: "camera-b" });
	await openCamera(page);
	await expect(row(page, "Camera B")).toHaveAttribute("aria-pressed", "true");
	expect((await writes(page)).filter(patch => "webcamDeviceId" in patch)).toEqual([]);
});

test("restores the nondefault microphone without rewriting the preference", async ({ page }) => {
	await openHud(page, { microphoneDeviceId: "mic-b" });
	await openMic(page);
	const microphone = page.getByRole("button", { name: /^Microphone B\b/ });
	await expect(microphone).toHaveAttribute("aria-pressed", "true");
	expect((await writes(page)).filter(patch => "microphoneDeviceId" in patch)).toEqual([]);
});

test("finds a renamed device ID by label and updates the saved ID once", async ({ page }) => {
	await openHud(page, { webcamDeviceId: "camera-b-old", webcamDeviceLabel: "Camera B" }, "camera-b-new");
	await openCamera(page);
	await expect(row(page, "Camera B")).toHaveAttribute("aria-pressed", "true");
	await expect.poll(() => writes(page)).toEqual([{ webcamDeviceId: "camera-b-new", webcamDeviceLabel: "Camera B" }]);
});

test("uses the default until the preferred camera is connected again", async ({ page }) => {
	await openHud(page, { webcamDeviceId: "camera-b", webcamDeviceLabel: "Camera B" }, "");
	await openCamera(page);
	await expect(page.getByText("Previously used Camera B is not connected", { exact: true })).toBeVisible();
	await expect(row(page, "System default")).toHaveAttribute("aria-pressed", "true");
	expect((await writes(page)).filter(patch => "webcamDeviceId" in patch)).toEqual([]);
	await page.evaluate(() => window.dispatchEvent(new CustomEvent("test-camera-changed", { detail: "camera-b" })));
	await expect(row(page, "Camera B")).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByText("Previously used Camera B is not connected", { exact: true })).toHaveCount(0);
	expect((await writes(page)).filter(patch => "webcamDeviceId" in patch)).toEqual([]);
});

test("persists explicit device and system default choices", async ({ page }) => {
	await openHud(page, { webcamDeviceId: "camera-b", webcamDeviceLabel: "Camera B" });
	await openCamera(page);
	await row(page, "Camera A").click();
	await expect(row(page, "Camera A")).toHaveAttribute("aria-pressed", "true");
	await expect.poll(async () => (await writes(page)).filter(patch => "webcamDeviceId" in patch))
		.toEqual([expect.objectContaining({ webcamDeviceId: "camera-a", webcamDeviceLabel: "Camera A" })]);
	await row(page, "System default").click();
	await expect(row(page, "System default")).toHaveAttribute("aria-pressed", "true");
	await expect.poll(async () => (await writes(page)).at(-1))
		.toMatchObject({ webcamDeviceId: "default" });
	await page.reload();
	await openCamera(page);
	await expect(row(page, "System default")).toHaveAttribute("aria-pressed", "true");
	expect((await writes(page)).filter(patch => "webcamDeviceId" in patch)).toEqual([]);
});
