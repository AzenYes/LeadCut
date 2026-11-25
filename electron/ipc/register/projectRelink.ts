import { handleTrustedIpc } from "../../trustedIpc";
import fs from "node:fs/promises";
import path from "node:path";
import { BrowserWindow, dialog, type OpenDialogOptions, type WebContents } from "electron";
import type { MediaRelinkMapping, ProjectMediaKind } from "../../../src/components/video-editor/projectRelink";
import { uiText } from "../../uiI18n";
import { COMPANION_AUDIO_LAYOUTS } from "../constants";
import { rememberApprovedLocalReadPath, saveRelinkedProjectMedia } from "../project/manager";
import { matchRelinkMediaInFolder } from "../project/relinkMediaFiles";
import { getTelemetryPathForVideo } from "../utils";

async function choose(sender: WebContents, options: OpenDialogOptions) {
	const parent = BrowserWindow.fromWebContents(sender);
	const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
	return result.canceled ? undefined : result.filePaths[0];
}

async function hasRecordingSidecars(video: string) {
	const base = video.slice(0, video.length - path.extname(video).length);
	const files = [
		getTelemetryPathForVideo(video),
		...COMPANION_AUDIO_LAYOUTS.flatMap(({ micSuffix, systemSuffix }) => [base + micSuffix, base + systemSuffix]),
	];
	const present = await Promise.all(files.map(file => fs.stat(file).then(stat => stat.isFile(), () => false)));
	return present.some(Boolean);
}

export function registerProjectRelinkHandlers() {
	const grants = new WeakMap<WebContents, { files: Set<string>; folders: Set<string> }>();
	const getGrants = (sender: WebContents) => {
		let access = grants.get(sender);
		if (!access) {
			access = { files: new Set(), folders: new Set() };
			grants.set(sender, access);
		}
		return access;
	};
	handleTrustedIpc("pick-relink-media", async ({ sender }, kind: ProjectMediaKind) => {
		try {
			if (!["video", "webcam", "audio", "broll"].includes(kind)) return { success: false };
			const file = await choose(sender, {
				title: uiText("relinkChooseFile"),
				properties: ["openFile"],
				filters: kind === "audio"
					? [{ name: uiText("audioFiles"), extensions: ["wav", "mp3", "aac", "m4a", "flac", "ogg", "webm"] }]
					: [{ name: uiText("videoFiles"), extensions: ["mp4", "mov", "webm", "mkv", "avi"] }],
			});
			if (!file) return { success: false, canceled: true };
			await rememberApprovedLocalReadPath(file);
			getGrants(sender).files.add(file);
			return { success: true, path: file };
		} catch (error) {
			return { success: false, message: error instanceof Error ? error.message : String(error) };
		}
	});
	handleTrustedIpc("pick-relink-media-folder", async ({ sender }) => {
		try {
			const folder = await choose(sender, { title: uiText("relinkFindInFolder"), properties: ["openDirectory"] });
			if (!folder) return { success: false, canceled: true };
			getGrants(sender).folders.add(folder);
			return { success: true, path: folder };
		} catch (error) {
			return { success: false, message: error instanceof Error ? error.message : String(error) };
		}
	});
	handleTrustedIpc("match-media-in-folder", async ({ sender }, folder: string, basenames: string[]) => {
		try {
			const access = getGrants(sender);
			if (!access.folders.has(folder) || !Array.isArray(basenames)) return { success: false };
			const { matches, ambiguous } = await matchRelinkMediaInFolder(folder, basenames);
			const withoutSidecars: string[] = [];
			await Promise.all(Object.entries(matches).map(async ([name, file]) => {
				await rememberApprovedLocalReadPath(file);
				access.files.add(file);
				if (!await hasRecordingSidecars(file)) withoutSidecars.push(name);
			}));
			return { success: true, matches, ambiguous, withoutSidecars };
		} catch (error) {
			return { success: false, message: error instanceof Error ? error.message : String(error) };
		}
	});
	handleTrustedIpc("relink-project-media", async ({ sender }, projectPath: string, revision: string, mapping: MediaRelinkMapping) => {
		try {
			if (typeof projectPath !== "string" || !projectPath || typeof revision !== "string" ||
				!revision || !mapping || typeof mapping !== "object" || Array.isArray(mapping)) return { success: false };
			const access = getGrants(sender);
			const result = await saveRelinkedProjectMedia(projectPath, revision, mapping, file => access.files.has(file));
			if (result.success) grants.delete(sender);
			return result;
		} catch (error) {
			return { success: false, message: error instanceof Error ? error.message : String(error) };
		}
	});
}
