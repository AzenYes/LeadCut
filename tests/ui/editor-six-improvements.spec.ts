import { expect, test, type Page } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function prepare(page: Page, layers = false) {
 await installDesktopBridge(page, "waveform.mp4");
 await installDesktopBridgeOverrides(page, () => {
  window.electronAPI.getAppSetting = (key) => key === "leadcut.onboarding.v1.seen" ? true : JSON.parse(localStorage.getItem(`app:${key}`) ?? "null");
  window.electronAPI.setAppSetting = (key, value) => { localStorage.setItem(`app:${key}`, JSON.stringify(value)); return true; };
 });
 await page.addInitScript((layers) => {
  localStorage.setItem("leadcut.timeline.height", "600");
  const base = `${location.origin}/tests/ui/fixtures/`;
  const project = { version: 2, projectId: "six-improvements", videoPath: `${base}waveform.mp4`, editor: {
   clipRegions: [{ id: "screen", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 }],
   webcam: { enabled: true, sourcePath: `${base}webcam-red.mp4`, scale: 1, width: 40, height: 40, reactToZoom: false },
   videoTracks: [{ id: "camera", name: "Camera", kind: "webcam" }, { id: "v2", name: "Video 2", kind: "video" }],
   videoRegions: [{ id: "camera-clip", trackId: "camera", kind: "webcam", sourcePath: `${base}webcam-red.mp4`, sourceDurationMs: 3000, sourceStartMs: 0, startMs: 0, endMs: 2000, speed: 1, volume: 0 }, ...(layers ? [{ id: "broll", trackId: "v2", kind: "video", sourcePath: `${base}broll-blue.mp4`, sourceDurationMs: 3000, sourceStartMs: 0, startMs: 2000, endMs: 4000, speed: 1, volume: 1 }] : [])],
   audioRegions: layers ? [{ id: "audio-a", audioPath: `${base}waveform.mp4`, startMs: 0, endMs: 2000, sourceStartMs: 0, trackIndex: 0, volume: 1 }, { id: "audio-b", audioPath: `${base}waveform.mp4`, startMs: 2000, endMs: 4000, sourceStartMs: 0, trackIndex: 1, volume: 1 }] : [],
   autoCaptionSettings: { enabled: true },
  }};
  window.electronAPI.loadCurrentProjectFile = async () => ({ success: true, path: "/projects/six.leadcut", project: JSON.parse(sessionStorage.getItem("six-project") ?? JSON.stringify(project)) });
  window.electronAPI.saveProjectFile = async (project) => { sessionStorage.setItem("six-project", JSON.stringify(project)); return { success: true, path: "/projects/six.leadcut", projectId: project.projectId }; };
  window.electronAPI.openVideoFilePicker = async () => ({ success: true, path: `${base}broll-blue.mp4` });
  window.electronAPI.openAudioFilePicker = async () => ({ success: true, path: `${base}waveform.mp4` });
 }, layers);
 await page.goto("/?windowType=editor");
 await expect(page.locator('[data-variant="clip"]')).toHaveCount(1, { timeout: 20000 });
 await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, { timeout: 20000 });
}
async function seek(page: Page, seconds: number) { const input = page.getByRole("textbox", { name: "Timeline timecode", exact: true }); await input.fill(`00:00:${seconds.toFixed(3).padStart(6, "0")}`); await input.press("Enter"); }

test("camera scale covers 0.2–2 and a saved preset restores it after reopening", async ({ page }) => {
 await prepare(page);
 await page.getByRole("radio", { name: "Webcam", exact: true }).click();
 const slider = page.getByRole("slider", { name: "Webcam Scale", exact: true });
 await expect(slider).toHaveAttribute("min", "0.2"); await expect(slider).toHaveAttribute("max", "2");
 await slider.focus(); await page.keyboard.press("Home"); await expect(slider).toHaveValue("0.2");
 await page.getByRole("button", { name: "Open presets", exact: true }).click();
 await page.getByRole("textbox", { name: "Preset name", exact: true }).fill("Small camera");
 await page.getByRole("button", { name: "Save", exact: true }).click();
 await page.keyboard.press("Escape");
 await slider.focus(); await page.keyboard.press("End"); await expect(slider).toHaveValue("2");
 await page.getByRole("button", { name: "Open presets", exact: true }).click();
 await page.getByRole("button", { name: "Small camera", exact: true }).click(); await page.keyboard.press("Escape");
 await expect(slider).toHaveValue("0.2");
 await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("six-project") ?? "{}").editor?.webcam?.scale)).toBe(0.2);
 await page.reload(); await page.getByRole("radio", { name: "Webcam", exact: true }).click();
 await expect(slider).toHaveValue("0.2");
});

test("empty lanes do not add items; explicit zoom actions use the playhead without selecting a clip", async ({ page }) => {
 await prepare(page);
 const add = page.getByRole("button", { name: "Add Zoom (Z)", exact: true });
 await expect(add).toBeEnabled();
 for (const row of ["row-zoom", "row-captions"]) await page.locator(`[data-timeline-row="${row}"]`).click({ position: { x: 300, y: 8 } });
 await expect(page.locator('[data-variant="zoom"]')).toHaveCount(0); await expect(page.locator('[data-variant="caption"]')).toHaveCount(0);
 await seek(page, 0);
 await expect(page.locator('[data-variant="clip"][data-selected="true"]')).toHaveCount(0);
 await page.locator('[data-testid="timeline-scroll"]').focus();
 await page.keyboard.press("z"); await expect(page.locator('[data-variant="zoom"]')).toHaveCount(1);
 await expect(page.locator('[data-variant="zoom"]')).toHaveAttribute("data-start-ms", "0");
 await expect(page.locator('[data-variant="zoom"]')).toContainText("1.5×");
 await seek(page, 2);
 await expect(page.getByTestId("playhead-cap")).toHaveAttribute("aria-label", "Playhead 00:00:02.000");
 await add.click(); await expect(page.locator('[data-variant="zoom"][data-start-ms="2000"]')).toHaveCount(1);
 await page.getByRole("button", { name: "Add caption", exact: true }).click(); await expect(page.locator('[data-variant="caption"]')).toHaveCount(1);
});

test("rectangle selects multiple tracks, Delete removes them together, undo restores all", async ({ page }) => {
 await prepare(page, true);
 const camera = page.locator('[data-region-id="camera-clip"]'); const broll = page.locator('[data-region-id="broll"]');
 const a = (await camera.boundingBox())!, b = (await broll.boundingBox())!;
 const right = Math.max(a.x + a.width, b.x + b.width) + 12;
 await page.mouse.move(right, b.y + 4); await page.mouse.down();
 await page.mouse.move(a.x + 4, a.y + a.height - 4, { steps: 15 }); await page.mouse.up();
 await expect(camera).toHaveAttribute("data-selected", "true"); await expect(broll).toHaveAttribute("data-selected", "true");
 await page.keyboard.press("Delete"); await expect(page.locator('[data-variant="video"]')).toHaveCount(0);
 await expect(page.locator('[data-variant="clip"]')).toHaveCount(1);
 await page.keyboard.press("Meta+z"); await expect(page.locator('[data-variant="video"]')).toHaveCount(2);
});

test("audio can move between tracks and adding into a gap reuses a track", async ({ page }) => {
 await prepare(page, true);
 const audio = page.locator('[data-region-id="audio-b"]'); const target = page.locator('[data-region-id="audio-a"]');
 const a = (await audio.boundingBox())!, b = (await target.boundingBox())!;
 await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down(); await page.mouse.move(a.x + a.width / 2, b.y + b.height / 2, { steps: 15 }); await page.mouse.up();
 await expect(page.locator('[data-timeline-row="row-audio-0"] [data-variant="audio"]')).toHaveCount(2);
 await seek(page, 4);
 await page.getByRole("button", { name: "Add Layer", exact: true }).click(); await page.getByRole("menuitem", { name: "Audio", exact: true }).click();
 await expect(page.locator('[data-timeline-row="row-audio-0"] [data-variant="audio"]')).toHaveCount(3);
});

test("video moves between tracks preserving camera identity and imports reuse an empty span", async ({ page }) => {
 await prepare(page, true);
 const camera = page.locator('[data-region-id="camera-clip"]'), broll = page.locator('[data-region-id="broll"]');
 const a = (await camera.boundingBox())!, b = (await broll.boundingBox())!;
 await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down(); await page.mouse.move(a.x + a.width / 2, b.y + b.height / 2, { steps: 15 }); await page.mouse.up();
 await expect(page.locator('[data-timeline-row="row-video:v2"] [data-variant="video"]')).toHaveCount(2);
 await seek(page, 4); await page.getByRole("button", { name: "Import B-roll", exact: true }).click();
 await expect(page.locator('[data-variant="video"]')).toHaveCount(3); await expect(page.locator('[data-timeline-row^="row-video:"]')).toHaveCount(2);
 await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("six-project") ?? "{}").editor?.videoRegions?.find((r: { id: string }) => r.id === "camera-clip"))).toMatchObject({ kind: "webcam", trackId: "v2" });
});


test("source audio lanes identify system and microphone separately", async ({ page }) => {
 await page.route("**/waveform.system.wav", route => route.fulfill({ path: "tests/ui/fixtures/waveform.mp4", contentType: "audio/mp4" }));
 await page.route("**/waveform.mic.wav", route => route.fulfill({ path: "tests/ui/fixtures/waveform.mp4", contentType: "audio/mp4" }));
 await prepare(page);
 await expect(page.locator('[data-timeline-row="row-source-audio-system"]').getByText("Source System", { exact: true })).toBeVisible();
 await expect(page.locator('[data-timeline-row="row-source-audio-mic"]').getByText("Source Mic", { exact: true })).toBeVisible();
});

test("multi-track split, rectangle segment deletion and undo preserve remaining media timing", async ({ page }) => {
 await prepare(page, true);
 // Clear selection, then cut every unlocked track at both boundaries.
 await page.locator('[data-timeline-row="row-zoom"]').click({ position: { x: 800, y: 8 } });
 await seek(page, 0.5); await page.keyboard.press("F2");
 await seek(page, 1.5); await page.keyboard.press("F2");
 const screen = page.locator('[data-variant="clip"][data-start-ms="500"]');
 const camera = page.locator('[data-variant="video"][data-start-ms="500"]');
 const audio = page.locator('[data-variant="audio"][data-start-ms="500"]');
 await expect(screen).toHaveCount(1); await expect(camera).toHaveCount(1); await expect(audio).toHaveCount(1);
 // Shift adds across unlike tracks, then one delete removes the chosen interval.
 await screen.click({ position: { x: 20, y: 20 } });
 await camera.click({ modifiers: ["Shift"], position: { x: 20, y: 20 } });
 await audio.click({ modifiers: ["Shift"], position: { x: 20, y: 8 } });
 await expect(screen).toHaveAttribute("data-selected", "true"); await expect(camera).toHaveAttribute("data-selected", "true"); await expect(audio).toHaveAttribute("data-selected", "true");
 await page.keyboard.press("Delete");
 await expect(page.locator('[data-variant="clip"]')).toHaveCount(2);
 await expect(page.locator('[data-variant="clip"]').last()).toHaveAttribute("data-start-ms", "500");
 await expect(page.locator('[data-variant="clip"]').last()).toHaveAttribute("data-end-ms", "5000");
 await page.keyboard.press("Meta+z");
 await expect(page.locator('[data-variant="clip"]')).toHaveCount(3);
 await expect(page.locator('[data-variant="audio"]')).toHaveCount(4);
});
