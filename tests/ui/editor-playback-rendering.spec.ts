import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import ffmpeg from "ffmpeg-static";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test.use({ launchOptions: process.platform === "win32" ? {
	args: ["--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist"],
} : undefined });

type Fiber = {
	child: Fiber | null;
	sibling: Fiber | null;
	flags: number;
	actualStartTime: number;
	type: { name?: string; displayName?: string } | null;
};

test("ten seconds of playback advances the playhead without rendering the editor or settings", async ({ page }, testInfo) => {
	test.setTimeout(90_000);
	const fixture = path.resolve(".code/playback-rendering-18s.mp4");
	if (!fs.existsSync(fixture)) {
		fs.mkdirSync(path.dirname(fixture), { recursive: true });
		execFileSync(ffmpeg!, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=480x270:r=30:d=18",
			"-c:v", "libx264", "-preset", "ultrafast", "-threads", "2", "-movflags", "+faststart", fixture], { windowsHide: true });
	}
	await page.addInitScript(() => {
		const counts = { VideoEditor: 0, SettingsPanel: 0 };
		const renderers = new Map();
		const lastRenderStart = new WeakMap<Fiber, number>();
		Object.assign(window, { editorRenderCounts: counts, __REACT_DEVTOOLS_GLOBAL_HOOK__: {
			supportsFiber: true,
			renderers,
			inject(renderer: unknown) {
				const id = renderers.size + 1;
				renderers.set(id, renderer);
				return id;
			},
			onCommitFiberRoot(_id: number, root: { current: Fiber }) {
				const pending = [root.current];
				while (pending.length) {
					const fiber = pending.pop()!;
					const name = fiber.type?.name ?? fiber.type?.displayName;
					if ((name === "VideoEditor" || name === "SettingsPanel") && (fiber.flags & 1) &&
						fiber.actualStartTime >= 0 && fiber.actualStartTime !== lastRenderStart.get(fiber)) {
						// Other commits can keep the same finished Fiber, including its previous render flag.
						lastRenderStart.set(fiber, fiber.actualStartTime);
						counts[name]++;
					}
					if (fiber.sibling) pending.push(fiber.sibling);
					if (fiber.child && name !== "TimelineEditor" && name !== "VideoPlayback") pending.push(fiber.child);
				}
			},
		} });
	});
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true, path: "/projects/Playback profile.leadcut", revision: "profile",
			project: { version: 2, videoPath: `${location.origin}/.code/playback-rendering-18s.mp4`, editor: {
				clipRegions: Array.from({ length: 200 }, (_, index) => ({
					id: `clip-${index}`, startMs: index * 90, endMs: (index + 1) * 90, sourceStartMs: index * 90, speed: 1,
				})),
				autoCaptions: Array.from({ length: 30 }, (_, index) => ({
					id: `cue-${index}`, text: `Line ${index + 1}`, startMs: index * 600, endMs: (index + 1) * 600,
				})),
				autoCaptionSettings: { enabled: true, animationStyle: "none" },
			} },
		});
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]').first()).toBeVisible({ timeout: 30_000 });
	await page.getByRole("radio", { name: "Motion", exact: true }).click();
	const readCounts = () => page.evaluate(() => (window as unknown as {
		editorRenderCounts: { VideoEditor: number; SettingsPanel: number };
	}).editorRenderCounts);
	await expect.poll(async () => (await readCounts()).SettingsPanel).toBeGreaterThan(0);
	expect((await readCounts()).VideoEditor).toBeGreaterThan(0);
	const video = page.locator('video[aria-hidden="true"]');
	await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(2);
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0);
	await page.evaluate(() => new Promise<void>(resolve => {
		const counts = (window as unknown as { editorRenderCounts: { VideoEditor: number; SettingsPanel: number } }).editorRenderCounts;
		let total = counts.VideoEditor + counts.SettingsPanel;
		let quietSince = performance.now();
		const check = (now: number) => {
			const current = counts.VideoEditor + counts.SettingsPanel;
			if (current !== total) {
				total = current;
				quietSince = now;
			}
			// Initial project save and preview preparation can commit after the clip first appears.
			if (now - quietSince >= 1_200) resolve();
			else requestAnimationFrame(check);
		};
		requestAnimationFrame(check);
	}));
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0.75);
	const profile = await page.evaluate(() => new Promise<{
		VideoEditor: number; SettingsPanel: number; playedSeconds: number; longTasksMs: number[];
	}>(resolve => {
		const counts = (window as unknown as { editorRenderCounts: { VideoEditor: number; SettingsPanel: number } }).editorRenderCounts;
		const before = { ...counts };
		const media = document.querySelector<HTMLVideoElement>('video[aria-hidden="true"]')!;
		const sourceStart = media.currentTime;
		const longTasksMs: number[] = [];
		const observer = new PerformanceObserver(entries => longTasksMs.push(...entries.getEntries().map(entry => entry.duration)));
		observer.observe({ type: "longtask" });
		setTimeout(() => {
			longTasksMs.push(...observer.takeRecords().map(entry => entry.duration));
			observer.disconnect();
			resolve({ VideoEditor: counts.VideoEditor - before.VideoEditor, SettingsPanel: counts.SettingsPanel - before.SettingsPanel,
				playedSeconds: media.currentTime - sourceStart, longTasksMs });
		}, 10_000);
	}));
	console.log(JSON.stringify(profile));
	await testInfo.attach("editor-playback-profile", { body: JSON.stringify(profile), contentType: "application/json" });
	expect(profile.playedSeconds).toBeGreaterThan(8);
	expect(profile.VideoEditor).toBe(0);
	expect(profile.SettingsPanel).toBe(0);
});
