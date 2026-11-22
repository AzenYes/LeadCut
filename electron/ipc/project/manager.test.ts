import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("local media path policy", () => {
	let tempRoot: string;
	let appDataPath: string;
	let userDataPath: string;
	let tempPath: string;
	let appPath: string;

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-media-policy-"));
		appDataPath = path.join(tempRoot, "AppData");
		userDataPath = path.join(tempRoot, "UserData");
		tempPath = path.join(tempRoot, "Temp");
		appPath = path.join(tempRoot, "App");

		await Promise.all(
			[appDataPath, userDataPath, tempPath, appPath].map((dirPath) =>
				fs.mkdir(dirPath, { recursive: true }),
			),
		);

		vi.resetModules();
		vi.doMock("electron", () => ({
			app: {
				isPackaged: false,
				setName: () => undefined,
				getAppPath: () => appPath,
				getPath: (name: string) => {
					if (name === "appData") return appDataPath;
					if (name === "userData") return userDataPath;
					if (name === "temp") return tempPath;
					return tempRoot;
				},
				setPath: () => undefined,
			},
		}));
	});

	afterEach(async () => {
		vi.resetModules();
		vi.doUnmock("electron");
		vi.doUnmock("../../mediaServer");
		vi.doUnmock("./firstFrameThumbnail");
		if (tempRoot) {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	it("changes the recordings directory without erasing stored device choices", async () => {
		const { RECORDINGS_SETTINGS_FILE } = await import("../constants");
		const { persistRecordingsDirectorySetting } = await import("./manager");
		const { getRecordingsDir } = await import("../utils");
		const preferences = { microphoneDeviceId: "mic", webcamDeviceId: "camera", systemAudioEnabled: false };
		const recordingsDir = path.join(tempRoot, "recordings-new");
		await fs.mkdir(path.dirname(RECORDINGS_SETTINGS_FILE), { recursive: true });
		await fs.mkdir(recordingsDir);
		await fs.writeFile(RECORDINGS_SETTINGS_FILE, JSON.stringify(preferences));
		await persistRecordingsDirectorySetting(recordingsDir);
		expect(JSON.parse(await fs.readFile(RECORDINGS_SETTINGS_FILE, "utf8"))).toEqual({
			...preferences,
			recordingsDir,
		});
		await expect(getRecordingsDir()).resolves.toBe(recordingsDir);
	});

	it("reads library previews without switching the active project and rejects unknown projects", async () => {
		vi.doMock("../../mediaServer", () => ({
			getMediaServerBaseUrl: () => "http://127.0.0.1:1234",
			buildMediaUrl: (base: string, file: string) =>
				`${base}/media?path=${encodeURIComponent(file)}`,
		}));
		const manager = await import("./manager");
		const state = await import("../state");
		const source = path.join(tempRoot, "video.mp4");
		await fs.writeFile(source, "video");
		const projectsDir = await manager.getProjectsDir();
		const projectPath = path.join(projectsDir, "preview.recordly");
		await fs.writeFile(
			projectPath,
			JSON.stringify({ version: 1, videoPath: source, editor: {} }),
		);
		state.setCurrentProjectPath("active.recordly");
		state.setCurrentVideoPath("active.mp4");
		const result = await manager.readProjectPreview(projectPath);
		expect(result.videoUrl).toContain(encodeURIComponent(source));
		expect(result.webcamUrl).toBeNull();
		await expect(fs.stat(projectPath)).resolves.toBeDefined();
		expect(state.currentProjectPath).toBe("active.recordly");
		expect(state.currentVideoPath).toBe("active.mp4");
		await expect(
			manager.readProjectPreview(path.join(tempRoot, "unknown.recordly")),
		).rejects.toThrow("not in the library");
	});

	it("lists missing video, webcam and auxiliary files, then persists relinks with a revision guard", async () => {
		const manager = await import("./manager");
		const { releaseEditorLock } = await import("./editorLock");
		const projectPath = path.join(tempRoot, "relink.leadcut");
		const screen = path.join(tempRoot, "lost-screen.mp4");
		const replacement = path.join(tempRoot, "new-screen.mp4");
		const webcam = path.join(tempRoot, "lost-camera.mp4");
		const audio = path.join(tempRoot, "lost-voice.wav");
		const broll = path.join(tempRoot, "lost-broll.mov");
		const project = {
			version: 2,
			videoPath: screen,
			editor: {
				webcam: { sourcePath: webcam, enabled: true },
				audioRegions: [{ id: "sound", audioPath: audio }],
				videoRegions: [{ id: "video", sourcePath: broll }],
			},
		};
		const missing = [
			{ kind: "video", path: screen },
			{ kind: "webcam", path: webcam },
			{ kind: "audio", path: audio, refId: "sound" },
			{ kind: "broll", path: broll, refId: "video" },
		];
		await fs.writeFile(projectPath, JSON.stringify(project));
		await fs.writeFile(replacement, "video");
		expect(await manager.collectMissingProjectMedia(project)).toEqual(missing);
		const loaded = await manager.loadProjectFromPath(projectPath);
		expect(loaded).toMatchObject({ success: false, code: "media-missing", missing, project });
		if (!("revision" in loaded) || !loaded.revision) throw new Error("missing project revision");

		const mapping = { [screen]: replacement, [webcam]: null, [audio]: null, [broll]: null };
		expect(await manager.saveRelinkedProjectMedia(projectPath, "stale", mapping, () => true)).toMatchObject({ success: false });
		expect(await manager.saveRelinkedProjectMedia(projectPath, loaded.revision, mapping, () => false)).toMatchObject({ success: false });
		try {
			const saved = await manager.saveRelinkedProjectMedia(projectPath, loaded.revision, mapping, file => file === replacement);
			expect(saved.success).toBe(true);
			const readBack = JSON.parse(await fs.readFile(projectPath, "utf8"));
			expect(readBack).toMatchObject({ videoPath: replacement, editor: { webcam: { enabled: false, sourcePath: null }, audioRegions: [], videoRegions: [] } });
			expect(await manager.collectMissingProjectMedia(readBack)).toEqual([]);
			expect(JSON.parse(await fs.readFile(`${projectPath}.bak`, "utf8"))).toEqual(project);
		} finally {
			await releaseEditorLock(projectPath);
		}
	});

	it("matches basenames at up to three folder levels and flags duplicates", async () => {
		const { matchRelinkMediaInFolder } = await import("./relinkMediaFiles");
		const third = path.join(tempRoot, "one", "two", "three");
		const fourth = path.join(third, "four");
		await fs.mkdir(fourth, { recursive: true });
		await Promise.all([
			fs.writeFile(path.join(tempRoot, "same.wav"), "first"),
			fs.writeFile(path.join(third, "same.wav"), "second"),
			fs.writeFile(path.join(third, "screen.mp4"), "screen"),
			fs.writeFile(path.join(fourth, "deep.mp4"), "beyond the search"),
		]);
		expect(await matchRelinkMediaInFolder(tempRoot, ["same.wav", "screen.mp4", "deep.mp4"])).toEqual({
			matches: { "screen.mp4": path.join(third, "screen.mp4") },
			ambiguous: ["same.wav"],
		});
	});

	it("lists current and legacy formats and flags legacy entries", async () => {
		const manager = await import("./manager");
		const directory = await manager.getProjectsDir();
		for (const name of ["new.leadcut", "old.RECORDLY", "first.openscreen", "skip.mp4"]) {
			await fs.writeFile(path.join(directory, name), "{}");
		}
		const result = await manager.listProjectLibraryEntries();
		expect(Object.fromEntries(result.entries.map(entry => [entry.name, entry.isLegacyFormat]))).toEqual({
			new: false, old: true, first: true,
		});
	});

	it("rejects existing media files outside allowed directories until they are approved", async () => {
		const downloadsPath = path.join(tempRoot, "Downloads");
		const exportPath = path.join(downloadsPath, "export-test.mp4");
		await fs.mkdir(downloadsPath, { recursive: true });
		await fs.writeFile(exportPath, "test-video");

		const { isAllowedLocalMediaPath, rememberApprovedLocalReadPath } = await import(
			"./manager"
		);

		await expect(isAllowedLocalMediaPath(exportPath)).resolves.toBe(false);

		await rememberApprovedLocalReadPath(exportPath);

		await expect(isAllowedLocalMediaPath(exportPath)).resolves.toBe(true);
	});

	it("rejects missing media files outside the allowed directories", async () => {
		const missingPath = path.join(tempRoot, "Downloads", "missing.mp4");
		const { isAllowedLocalMediaPath } = await import("./manager");

		await expect(isAllowedLocalMediaPath(missingPath)).resolves.toBe(false);
	});

	it("allows approved media paths before the file exists", async () => {
		const pendingExportPath = path.join(tempRoot, "Downloads", "pending-export.mp4");
		const { isAllowedLocalMediaPath, rememberApprovedLocalReadPath } = await import(
			"./manager"
		);

		await rememberApprovedLocalReadPath(pendingExportPath);

		await expect(isAllowedLocalMediaPath(pendingExportPath)).resolves.toBe(true);
	});

	it("approves media-server access for approved external files resolved through the URL policy", async () => {
		const downloadsPath = path.join(tempRoot, "Downloads");
		const videoPath = path.join(downloadsPath, "external-video.mp4");
		await fs.mkdir(downloadsPath, { recursive: true });
		await fs.writeFile(videoPath, "test-video");
		const resolvedVideoPath = await fs.realpath(videoPath);

		const { resolveApprovedLocalMediaPath, rememberApprovedLocalReadPath } = await import(
			"./manager"
		);
		const { isAllowedMediaPath } = await import("../../mediaServer");

		// Unapproved external paths are rejected before they ever reach the media server.
		expect(isAllowedMediaPath(videoPath)).toBe(false);
		await expect(resolveApprovedLocalMediaPath(videoPath)).resolves.toBeNull();

		// Once the user opts in (via dialog/export/etc.) the path is approved.
		await rememberApprovedLocalReadPath(videoPath);

		await expect(resolveApprovedLocalMediaPath(videoPath)).resolves.toBe(resolvedVideoPath);
		expect(isAllowedMediaPath(videoPath)).toBe(true);
	});

	it("rejects existing non-media files when resolving local media URLs", async () => {
		const downloadsPath = path.join(tempRoot, "Downloads");
		const textPath = path.join(downloadsPath, "notes.txt");
		await fs.mkdir(downloadsPath, { recursive: true });
		await fs.writeFile(textPath, "not media");

		const { resolveApprovedLocalMediaPath } = await import("./manager");
		const { isAllowedMediaPath } = await import("../../mediaServer");

		await expect(resolveApprovedLocalMediaPath(textPath)).resolves.toBeNull();
		expect(isAllowedMediaPath(textPath)).toBe(false);
	});

	it("rejects symlinks under allowed prefixes that point outside the allowlist", async () => {
		const outsideTarget = path.join(tempRoot, "outside-secret.mp4");
		const symlinkInsideUserData = path.join(userDataPath, "shortcut-to-secret.mp4");
		await fs.writeFile(outsideTarget, "secret-bytes");

		try {
			await fs.symlink(outsideTarget, symlinkInsideUserData);
		} catch (error) {
			// Windows requires Developer Mode or admin to create file symlinks. If
			// we can't create one, the bypass we're guarding against also can't be
			// crafted on this machine, so skipping is safe.
			if ((error as NodeJS.ErrnoException).code === "EPERM") {
				return;
			}
			throw error;
		}

		const { isAllowedLocalMediaPath, resolveApprovedLocalMediaPath } = await import(
			"./manager"
		);

		await expect(isAllowedLocalMediaPath(symlinkInsideUserData)).resolves.toBe(false);
		await expect(resolveApprovedLocalMediaPath(symlinkInsideUserData)).resolves.toBeNull();
	});

	it("generates a missing project poster once and keeps it cached", async () => {
		const png = Buffer.alloc(24);
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
		png.writeUInt32BE(640, 16);
		png.writeUInt32BE(480, 20);
		const generate = vi.fn().mockResolvedValue(png);
		vi.doMock("./firstFrameThumbnail", () => ({ createProjectFirstFrameThumbnail: generate }));
		const manager = await import("./manager");
		const source = path.join(tempRoot, "source.mp4");
		const projectPath = path.join(tempRoot, "test.recordly");
		await fs.writeFile(source, "video");
		await fs.writeFile(
			projectPath,
			JSON.stringify({ version: 2, videoPath: source, editor: {} }),
		);
		const before = await fs.readFile(projectPath, "utf8");
		const entry = await manager.buildProjectLibraryEntry(projectPath, tempRoot);
		expect(entry?.thumbnailPath).toBeNull();
		await manager.refreshProjectThumbnail(projectPath, await fs.stat(projectPath));
		expect((await manager.buildProjectLibraryEntry(projectPath, tempRoot))?.thumbnailPath).toBe(
			manager.getProjectThumbnailPath(projectPath),
		);
		expect(generate).toHaveBeenCalledWith(source);
		await manager.buildProjectLibraryEntry(projectPath, tempRoot);
		expect(generate).toHaveBeenCalledTimes(1);
		expect(await fs.readFile(projectPath, "utf8")).toBe(before);
	});

	it("preserves an existing project thumbnail when no replacement is provided", async () => {
		const projectPath = path.join(tempRoot, "Projects", "demo.recordly");
		const png = Buffer.alloc(24);
		Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
		png.writeUInt32BE(640, 16); png.writeUInt32BE(480, 20);
		const thumbnailDataUrl = `data:image/png;base64,${png.toString("base64")}`;
		await fs.mkdir(path.dirname(projectPath), { recursive: true });

		const { getProjectThumbnailPath, saveProjectThumbnail } = await import("./manager");
		const thumbnailPath = getProjectThumbnailPath(projectPath);

		await saveProjectThumbnail(projectPath, thumbnailDataUrl);
		await saveProjectThumbnail(projectPath, undefined);

		await expect(fs.readFile(thumbnailPath)).resolves.toEqual(png);
		expect(thumbnailPath.startsWith(userDataPath)).toBe(true);
		await expect(fs.stat(`${projectPath}.preview.png`)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it.each(["save existing project", "create project after recording"])("embeds the source frame when asked to %s without a screenshot", async (operation) => {
		const png = Buffer.alloc(24);
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
		png.writeUInt32BE(640, 16);
		png.writeUInt32BE(480, 20);
		const generate = vi.fn().mockResolvedValue(png);
		vi.doMock("./firstFrameThumbnail", () => ({ createProjectFirstFrameThumbnail: generate }));
		const { createProjectFromRecording, serializeProjectForSave } = await import("./manager");
		const source = path.join(tempRoot, "recording.mp4");
		const project = { version: 2, videoPath: source, editor: {} };
		await fs.writeFile(source, "video");
		let projectPath: string;
		if (operation === "save existing project") {
			projectPath = path.join(tempRoot, "old.leadcut");
			await fs.writeFile(projectPath, JSON.stringify(project));
			await fs.writeFile(projectPath, await serializeProjectForSave(project, projectPath));
		} else {
			const created = await createProjectFromRecording(tempRoot, project);
			projectPath = created.target;
			expect(created.revision).toBeTruthy();
		}
		const saved = JSON.parse(await fs.readFile(projectPath, "utf8"));
		expect(saved).toMatchObject({ ...project, thumbnailPng: `data:image/png;base64,${png.toString("base64")}` });
		expect(generate).toHaveBeenCalledExactlyOnceWith(source);
	});

	it("loads project files that start with a UTF-8 byte order mark", async () => {
		const videoPath = path.join(tempPath, "recording.mp4");
		const projectPath = path.join(tempPath, "recording.leadcut");
		await fs.writeFile(videoPath, "test-video");
		await fs.writeFile(
			projectPath,
			`\uFEFF${JSON.stringify({
				version: 1,
				videoPath,
				editor: {},
			})}`,
			"utf-8",
		);

		const { loadProjectFromPath } = await import("./manager");

		const result = await loadProjectFromPath(projectPath);
		expect(result.success).toBe(true);
		expect(result.path).toBe(projectPath);
		expect(result.project).toMatchObject({ videoPath });
	});

	it("rejects invalid project payloads before approving media paths", async () => {
		const downloadsPath = path.join(tempRoot, "Downloads");
		const videoPath = path.join(downloadsPath, "recording.mp4");
		const projectPath = path.join(tempPath, "invalid.recordly");
		await fs.mkdir(downloadsPath, { recursive: true });
		await fs.writeFile(videoPath, "test-video");
		await fs.writeFile(
			projectPath,
			JSON.stringify({
				videoPath,
				editor: {},
			}),
			"utf-8",
		);

		const { loadProjectFromPath, resolveApprovedLocalMediaPath } = await import("./manager");

		const result = await loadProjectFromPath(projectPath);
		expect(result.success).toBe(false);
		expect(result.message).toBe("Invalid project file format");
		await expect(resolveApprovedLocalMediaPath(videoPath)).resolves.toBeNull();
	});

	it("approves editor audioRegions audioPath entries when loading a project", async () => {
		const downloadsPath = path.join(tempRoot, "Downloads");
		const videoPath = path.join(tempPath, "recording.mp4");
		const audioPath = path.join(downloadsPath, "music.ogg");
		const projectPath = path.join(tempPath, "recording.recordly");
		await fs.mkdir(downloadsPath, { recursive: true });
		await fs.writeFile(videoPath, "test-video");
		await fs.writeFile(audioPath, "test-audio");
		await fs.writeFile(
			projectPath,
			JSON.stringify({
				version: 1,
				videoPath,
				editor: {
					audioRegions: [{ id: "a1", startMs: 0, endMs: 1000, audioPath, volume: 1 }],
				},
			}),
			"utf-8",
		);

		const { loadProjectFromPath, resolveApprovedLocalMediaPath } = await import("./manager");
		const resolvedAudioPath = await fs.realpath(audioPath);

		const result = await loadProjectFromPath(projectPath);
		expect(result.success).toBe(true);
		await expect(resolveApprovedLocalMediaPath(audioPath)).resolves.toBe(resolvedAudioPath);
	});
	it("approves independent video sources on project reopen", async () => {
		const videoPath = path.join(tempPath, "recording.mp4");
		const brollPath = path.join(tempRoot, "B-roll", "视频素材.mp4");
		const projectPath = path.join(tempPath, "multitrack.recordly");
		await fs.mkdir(path.dirname(brollPath), { recursive: true });
		await fs.writeFile(videoPath, "screen"); await fs.writeFile(brollPath, "broll");
		await fs.writeFile(projectPath, JSON.stringify({ version: 2, videoPath, editor: { videoTracks: [{ id: "v2", name: "B-roll", kind: "video" }], videoRegions: [{ id: "b1", trackId: "v2", sourcePath: brollPath, sourceStartMs: 500, sourceDurationMs: 3000, startMs: 1000, endMs: 2500, speed: 1 }] } }));
		const { loadProjectFromPath, resolveApprovedLocalMediaPath } = await import("./manager");
		expect((await loadProjectFromPath(projectPath)).success).toBe(true);
		await expect(resolveApprovedLocalMediaPath(brollPath)).resolves.toBe(await fs.realpath(brollPath));
	});
	it("returns a library entry while a thumbnail decode is still pending", async () => {
		let release!: (data: Buffer) => void;
		const pending = new Promise<Buffer>((resolve) => {
			release = resolve;
		});
		const generate = vi.fn(() => pending);
		vi.doMock("./firstFrameThumbnail", () => ({ createProjectFirstFrameThumbnail: generate }));
		const manager = await import("./manager");
		const source = path.join(tempRoot, "slow.mp4");
		const projectPath = path.join(tempRoot, "slow.recordly");
		await fs.writeFile(source, "video");
		await fs.writeFile(
			projectPath,
			JSON.stringify({ version: 2, videoPath: source, editor: {} }),
		);
		const ready = vi.fn();
		const entry = await manager.buildProjectLibraryEntry(projectPath, tempRoot, ready);
		expect(entry?.path).toBe(projectPath);
		expect(entry?.thumbnailPath).toBeNull();
		const task = manager.refreshProjectThumbnail(projectPath, await fs.stat(projectPath));
		expect(ready).not.toHaveBeenCalled();
		release(Buffer.from("fixture thumbnail"));
		await task;
		expect(generate).toHaveBeenCalledTimes(1);
		expect(ready).toHaveBeenCalledWith(expect.objectContaining({ path: projectPath }));
	});

	it("replaces a thumbnail symlink without overwriting its target", async () => {
		vi.doMock("./firstFrameThumbnail", () => ({
			createProjectFirstFrameThumbnail: vi.fn().mockResolvedValue(Buffer.from("new poster")),
		}));
		const manager = await import("./manager");
		const source = path.join(tempRoot, "source.mp4");
		const projectPath = path.join(tempRoot, "linked.recordly");
		const target = path.join(tempRoot, "private.txt");
		await fs.writeFile(source, "video");
		await fs.writeFile(
			projectPath,
			JSON.stringify({ version: 2, videoPath: source, editor: {} }),
		);
		await fs.writeFile(target, "must remain intact");
		const thumbnail = manager.getProjectThumbnailPath(projectPath);
		await fs.mkdir(path.dirname(thumbnail), { recursive: true });
		try {
			await fs.symlink(target, thumbnail);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EPERM") return;
			throw error;
		}
		await manager.refreshProjectThumbnail(projectPath, await fs.stat(projectPath));
		expect(await fs.readFile(target, "utf8")).toBe("must remain intact");
		expect((await fs.lstat(thumbnail)).isSymbolicLink()).toBe(false);
		expect(await fs.readFile(thumbnail, "utf8")).toBe("new poster");
	});

	it("discards a thumbnail when the project changes during decoding", async () => {
		let release!: (data: Buffer) => void;
		const pending = new Promise<Buffer>((resolve) => {
			release = resolve;
		});
		const generate = vi.fn(() => pending);
		vi.doMock("./firstFrameThumbnail", () => ({ createProjectFirstFrameThumbnail: generate }));
		const manager = await import("./manager");
		const source = path.join(tempRoot, "source.mp4");
		const projectPath = path.join(tempRoot, "edited.recordly");
		await fs.writeFile(source, "video");
		await fs.writeFile(
			projectPath,
			JSON.stringify({ version: 2, videoPath: source, editor: {} }),
		);
		const task = manager.refreshProjectThumbnail(projectPath, await fs.stat(projectPath));
		await vi.waitFor(() => expect(generate).toHaveBeenCalled());
		await fs.appendFile(projectPath, " ");
		release(Buffer.from("obsolete poster"));
		expect(await task).toBeNull();
		await expect(fs.stat(manager.getProjectThumbnailPath(projectPath))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});
});
