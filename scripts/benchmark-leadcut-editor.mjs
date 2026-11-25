import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { _electron } from "@playwright/test";
import electron from "electron";
import {
	benchmarkRoot,
	generateFixtures,
	parseFixtureOptions,
	repoRoot,
} from "./benchmark-leadcut-fixtures.mjs";
import { runSmokeExport } from "./smoke-leadcut-export.mjs";

const clipSelector = '[data-timeline-item][data-variant="clip"]';
const timelineSelector = '[data-testid="timeline-scroll"]';
const reportingRoot = path.join(repoRoot, "docs", "benchmarks");
const executablePath = process.env.LEADCUT_BENCH_EXE || electron;
const builtApp = !process.env.LEADCUT_BENCH_EXE;
const environmentTimeoutMs = Number(process.env.LEADCUT_SMOKE_EXPORT_TIMEOUT_MS);

function sampleFrameIntervals({ durationMs, scrollAndZoom, timelineSelector }) {
	const timeline = scrollAndZoom
		? document.querySelector(timelineSelector)?.querySelector("[data-forward-selection]")
		: null;
	return new Promise((resolve, reject) => {
		if (scrollAndZoom && !timeline) {
			reject(new Error("Timeline is unavailable for scroll benchmark"));
			return;
		}
		const startedAt = performance.now();
		const video = scrollAndZoom ? null : [...document.querySelectorAll("video")].find(node => !node.paused);
		const mediaStartedAt = video?.currentTime ?? 0;
		const initialQuality = video?.getVideoPlaybackQuality();
		let presentedFrames = 0;
		let frameCallbackId;
		if (video?.requestVideoFrameCallback) {
			const record = (_now, metadata) => {
				firstPresentedFrame ??= metadata.presentedFrames - 1;
				presentedFrames = metadata.presentedFrames - firstPresentedFrame;
				frameCallbackId = video.requestVideoFrameCallback(record);
			};
			let firstPresentedFrame;
			frameCallbackId = video.requestVideoFrameCallback(record);
		}
		let previous = startedAt;
		let lastScroll = startedAt;
		let scrollCount = 0;
		let frames = 0;
		let longAnimationIntervals = 0;
		function step(now) {
			frames++;
			if (now - previous > 50) longAnimationIntervals++;
			previous = now;
			if (timeline && now - lastScroll >= 100) {
				const direction = scrollCount % 4 < 2 ? 1 : -1;
				const zooming = scrollCount % 2 === 0;
				timeline.dispatchEvent(
					new WheelEvent("wheel", {
						bubbles: true,
						cancelable: true,
						deltaX: zooming ? 0 : direction * 110,
						deltaY: zooming ? direction * 110 : 0,
						ctrlKey: zooming,
						clientX: timeline.getBoundingClientRect().left + timeline.clientWidth / 2,
					}),
				);
				scrollCount++;
				lastScroll = now;
			}
			if (now - startedAt >= durationMs) {
				if (frameCallbackId !== undefined) video?.cancelVideoFrameCallback(frameCallbackId);
				const quality = video?.getVideoPlaybackQuality();
				resolve({
					elapsedMs: now - startedAt,
					frames, longAnimationIntervals, presentedFrames,
					videoFrames: quality && initialQuality ? quality.totalVideoFrames - initialQuality.totalVideoFrames : 0,
					videoDrops: quality && initialQuality ? quality.droppedVideoFrames - initialQuality.droppedVideoFrames : 0,
					mediaElapsedMs: video ? (video.currentTime - mediaStartedAt) * 1000 : 0,
				});
			} else requestAnimationFrame(step);
		}
		requestAnimationFrame(step);
	});
}

async function measureEdit(page, key, clipCount) {
	await page.evaluate(
		({ key, clipCount, clipSelector }) => {
			window.leadcutBenchmarkEdit = new Promise((resolve, reject) => {
				const startedAt = performance.now();
				const observer = new MutationObserver(() => {
					if (document.querySelectorAll(clipSelector).length !== clipCount) return;
					clearTimeout(timeout);
					observer.disconnect();
					resolve(performance.now() - startedAt);
				});
				const timeout = setTimeout(() => {
					observer.disconnect();
					reject(new Error(`No clip count change after ${key}`));
				}, 10000);
				observer.observe(document.body, { childList: true, subtree: true });
			});
		},
		{ key, clipCount, clipSelector },
	);
	await page.keyboard.press(key);
	return page.evaluate(() => window.leadcutBenchmarkEdit);
}

async function prepareProfile(work, name) {
	const profile = path.join(work, name);
	await fs.mkdir(profile, { recursive: true });
	await fs.writeFile(
		path.join(profile, "app-settings.json"),
		JSON.stringify({
			// Seed both keys so the same run can measure an older installed build.
			"recordly.onboarding.v1.seen": true,
			"recordly.locale": "en",
			"leadcut.onboarding.v1.seen": true,
			"leadcut.locale": "en",
		}),
	);
	return profile;
}

async function waitForEditor(app) {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		const editor = app
			.windows()
			.find((page) => /[?&]windowType=editor(?:&|$)/.test(page.url()));
		if (editor) {
			if (!builtApp) {
				try {
					await editor.waitForFunction(
						() => typeof window.electronAPI?.getAppVersion === "function",
						undefined,
						{ timeout: 4000 },
					);
				} catch {
					// An already-installed build can start its first renderer before Playwright attaches.
					await editor.evaluate(() => {
						localStorage.setItem("recordly.locale", "en");
						localStorage.setItem("leadcut.locale", "en");
					});
					await editor.reload({ waitUntil: "domcontentloaded" });
					await editor.waitForFunction(
						() => typeof window.electronAPI?.getAppVersion === "function",
						undefined,
						{ timeout: 10000 },
					);
				}
			}
			return editor;
		}
		await delay(50);
	}
	throw new Error("Benchmark editor window did not open");
}

async function measureEditor(fixture, work) {
	const project = path.join(work, path.basename(fixture.project));
	const profile = await prepareProfile(work, "editor-profile");
	await fs.copyFile(fixture.project, project);
	const startedAt = performance.now();
	const app = await _electron.launch({
		...(builtApp ? {} : { executablePath }),
		args: builtApp ? [repoRoot, project] : [project],
		env: { ...process.env, LEADCUT_USER_DATA_DIR: profile },
		timeout: 60000,
	});
	let peakMemoryMb = 0;
	let previousMemorySample = Promise.resolve();
	function sampleMemory() {
		previousMemorySample = app
			.evaluate(
				({ app }) =>
					app
						.getAppMetrics()
						.reduce((total, item) => total + item.memory.workingSetSize, 0) / 1024,
			)
			.then((mb) => {
				peakMemoryMb = Math.max(peakMemoryMb, mb);
			})
			.catch(() => undefined);
	}
	sampleMemory();
	const memoryTimer = setInterval(sampleMemory, 1000);
	try {
		const page = await waitForEditor(app);
		const clips = page.locator(clipSelector);
		const [openToPlayableMs, waveformVisibleMs] = await Promise.all([
			Promise.all([
				clips.first().waitFor({ state: "visible", timeout: 60000 }),
				page.getByText(/loading preview/i).waitFor({ state: "hidden", timeout: 60000 }),
				page.waitForFunction(
					() =>
						Array.from(document.querySelectorAll("video")).some(
							(video) => video.readyState >= 2,
						),
					undefined,
					{ timeout: 60000 },
				),
			]).then(() => performance.now() - startedAt),
			page
				.locator("[data-source-audio-clip]")
				.first()
				.waitFor({ state: "visible", timeout: 120000 })
				.then(() => performance.now() - startedAt),
		]);
		const version = await page.evaluate(() => window.electronAPI.getAppVersion());
		const gpu = await app
			.evaluate(async ({ app }) => {
				const info = await app.getGPUInfo("complete");
				return (info.gpuDevice ?? [])
					.map(
						(device) =>
							device.deviceString ||
							`PCI ${device.vendorId?.toString(16)}:${device.deviceId?.toString(16)}`,
					)
					.join(", ");
			})
			.catch(() => "");

		await page.getByRole("button", { name: "Play", exact: true }).click();
		await page.waitForFunction(() => [...document.querySelectorAll("video")].some(video => !video.paused));
		const playback = await page.evaluate(sampleFrameIntervals, {
			durationMs: 30000,
			scrollAndZoom: false,
			timelineSelector,
		});
		const pause = page.getByRole("button", { name: "Pause", exact: true });
		await pause.evaluateAll(buttons => { if (buttons[0] instanceof HTMLButtonElement) buttons[0].click(); });
		await page.waitForFunction(() => [...document.querySelectorAll("video")].every(video => video.paused));

		const timecode = page.getByRole("textbox", { name: "Timeline timecode" });
		await timecode.fill("00:00:03.000");
		await timecode.press("Enter");
		await page.locator(timelineSelector).focus();
		const clipCount = await clips.count();
		const splitMs = await measureEdit(page, "F2", clipCount + 1);
		// At fit-to-project zoom, the minimum-width boxes of adjacent clips can overlap.
		// Deliver the selection to the split clip itself so it stays outside the timed F3 operation.
		const splitClip = page.locator(`${clipSelector}[data-start-ms="3000"]`);
		await splitClip.dispatchEvent("pointerdown", { button: 0, bubbles: true, pointerType: "mouse" });
		await splitClip.dispatchEvent("pointerup", { button: 0, bubbles: true, pointerType: "mouse" });
		if (await splitClip.getAttribute("data-selected") !== "true") {
			await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute("data-selected") === "true", `${clipSelector}[data-start-ms="3000"]`);
		}
		const rippleDeleteMs = await measureEdit(page, "F3", clipCount);
		const scroll = await page.evaluate(sampleFrameIntervals, {
			durationMs: 5000,
			scrollAndZoom: true,
			timelineSelector,
		});
		await previousMemorySample;

		return {
			version,
			gpu,
			openToPlayableMs,
			waveformVisibleMs,
			peakMemoryMb,
			droppedFrameRatio: playback.videoFrames > 0 ? playback.videoDrops / playback.videoFrames : null,
			presentedFrames: playback.presentedFrames,
			longAnimationIntervalRatio: playback.longAnimationIntervals / playback.frames,
			playbackSpeedX: playback.mediaElapsedMs / playback.elapsedMs,
			splitMs,
			rippleDeleteMs,
			scrollFps: scroll.frames / (scroll.elapsedMs / 1000),
		};
	} finally {
		clearInterval(memoryTimer);
		await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
		await app.close().catch(() => undefined);
	}
}

async function measureExport(fixture, work) {
	const timeoutMs =
		Number.isSafeInteger(environmentTimeoutMs) && environmentTimeoutMs > 0
			? environmentTimeoutMs
			: Math.max(180000, fixture.durationSeconds * 12000);
	const report = await runSmokeExport({
		executable: executablePath,
		args: builtApp ? [repoRoot] : [],
		projectPath: fixture.project,
		outputPath: path.join(work, "export.mp4"),
		logPath: path.join(work, "export.log"),
		profile: await prepareProfile(work, "export-profile"),
		legacyEnvironment: projectExtension === "recordly",
		timeoutMs,
		quality: "source",
		fps: fixture.frameRate,
		backend: "auto",
		renderBackend: "",
	});
	return {
		exportSpeedX: report.metrics?.frameCount / fixture.frameRate / (report.elapsedMs / 1000),
		encoderName: report.metrics?.encoderName,
		encodeBackend: report.metrics?.encodeBackend ?? "unknown",
		exportRouteChanges: report.metrics?.routeChanges,
		exportStages: {
			renderSubmissionMs: report.metrics?.renderFrameMs,
			framePreparationMs: report.metrics?.framePreparationMs,
			encoderQueueWaitMs: report.metrics?.encodeWaitMs,
			gpuRenderCompletionMs: report.metrics?.gpuRenderCompletionMs,
			frameEncodeLatencyMs: report.metrics?.frameEncodeLatencyMs,
		},
	};
}

function assertMeasurements(run) {
	for (const [name, value] of Object.entries(run)) {
		if (["fixture", "encoderName", "encodeBackend", "exportRouteChanges", "exportStages"].includes(name)) continue;
		if (name === "droppedFrameRatio" && value === null) continue;
		if (!Number.isFinite(value) || value < 0) {
			throw new Error(`Invalid measurement for ${run.fixture}: ${name}=${value}`);
		}
	}
	if (!run.encoderName) throw new Error(`No encoder was reported for ${run.fixture}`);
}

const date = new Date().toISOString();
const runs = [];
const machine = {
	cpu: os.cpus()[0]?.model ?? "Unknown CPU",
	gpu: "Unknown GPU",
	ram: `${(os.totalmem() / 1024 ** 3).toFixed(1)} GiB`,
};
let version;
const options = parseFixtureOptions();
// Preserve the launch path for a pre-migration installed build when measuring an older baseline.
const projectExtension = !builtApp && process.env.LEADCUT_BENCH_LEGACY_FORMAT !== "0" ? "recordly" : "leadcut";
for (const fixture of await generateFixtures({ ...options, projectExtension })) {
	const work = await fs.mkdtemp(path.join(benchmarkRoot, "run-"));
	console.log(`Measuring ${fixture.name} in ${work}`);
	const { version: measuredVersion, gpu, ...metrics } = await measureEditor(fixture, work);
	version = measuredVersion;
	if (gpu) machine.gpu = gpu;
	const fixtureName =
		options.captions === 1000 && options.clips === 200
			? fixture.name
			: path.parse(fixture.project).name;
	const run = { fixture: fixtureName, ...metrics, ...(await measureExport(fixture, work)) };
	assertMeasurements(run);
	runs.push(run);
	await fs.writeFile(path.join(work, "metrics.json"), JSON.stringify(run, null, 2) + "\n");
}

const report = { version, date, machine, runs };
const id = `${version}-${date.replaceAll(":", "-")}`;
await fs.mkdir(reportingRoot, { recursive: true });
const jsonPath = path.join(reportingRoot, `${id}.json`);
const markdownPath = path.join(reportingRoot, `${id}.md`);
await fs.writeFile(jsonPath, JSON.stringify(report, null, 2) + "\n");
const markdownRows = runs.map((run) => [
	run.fixture,
	run.openToPlayableMs.toFixed(0),
	run.waveformVisibleMs.toFixed(0),
	run.peakMemoryMb.toFixed(1),
	run.droppedFrameRatio === null ? "—" : `${(run.droppedFrameRatio * 100).toFixed(2)}%`,
	run.presentedFrames,
	run.playbackSpeedX.toFixed(2),
	run.splitMs.toFixed(1),
	run.rippleDeleteMs.toFixed(1),
	run.scrollFps.toFixed(1),
	run.exportSpeedX.toFixed(2),
	`${run.encodeBackend} / ${run.encoderName}`,
	run.exportRouteChanges?.map(change => change.reason).join(", ") || "—",
]);
await fs.writeFile(
	markdownPath,
	[
		`# LeadCut ${version} 性能基准`,
		"",
		date,
		"",
		`- CPU ${machine.cpu}`,
		`- GPU ${machine.gpu}`,
		`- 内存 ${machine.ram}`,
		"",
		"| 素材 | 可播放 ms | 波形 ms | 内存峰值 MiB | 视频掉帧率 | 呈现帧数 | 播放倍速 | F2 ms | F3 ms | 滚动 FPS | 导出倍速 | 编码路由 | 回退原因 |",
		"|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|",
		...markdownRows.map((row) => `| ${row.join(" | ")} |`),
		"",
	].join("\n"),
);
console.log(`Benchmark JSON: ${jsonPath}\nBenchmark Markdown: ${markdownPath}`);
