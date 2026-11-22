import fs from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { needsCutRedo, normalizeChangeLog, resolveEntryTimelineMs } from "./changeLogModel.js";
import { readProjectSnapshot, reply } from "./mutation.js";
import { resolveProjectMediaPath } from "./projectStore.js";
import { normalizeRecordingMarkers } from "./recordingMarkersModel.js";
import { getKeysPathForVideo, parseKeystrokeSidecar } from "./keystrokeSidecar.js";

export function registerProjectReviewTools(server: McpServer) {
	const args = { project: z.string().min(1) };
	server.tool("list_change_log",
		"Read source cuts and their current sequence positions in milliseconds, including review status and any notes requesting a redo.",
		args, async ({ project }) => {
			const { file, project: data, revision } = await readProjectSnapshot(project);
			const { version, entries } = normalizeChangeLog(data.editor.changeLog);
			const clips = Array.isArray(data.editor.clipRegions) ? data.editor.clipRegions.filter(clip =>
				clip && Number.isFinite(clip.startMs) && Number.isFinite(clip.endMs),
			) : [];
			return reply({
				project: file, revision, version,
				entries: entries.map(entry => ({
					...entry, currentTimelineMs: resolveEntryTimelineMs(entry, clips),
					...(entry.redo ? { needsRedo: needsCutRedo(entry) } : {}),
				})),
			});
		});
	server.tool("get_recording_markers",
		"Read cut and highlight markers captured during recording. Times are source milliseconds. Recordings without a marker file return an empty list.",
		args, async ({ project }) => {
			const { file, project: data, revision } = await readProjectSnapshot(project);
			const videoPath = resolveProjectMediaPath(file, data.videoPath);
			const raw = await fs.readFile(`${videoPath}.leadcut-markers.json`, "utf8").catch(error => {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
				throw error;
			});
			const markers = raw === null ? [] : normalizeRecordingMarkers(JSON.parse(raw.replace(/^\uFEFF/, "")));
			return reply({ project: file, revision, timeBasis: "source", markers });
		});
	server.tool("get_key_events", "Read captured keyboard events in source milliseconds for a LeadCut project.",
		args, async ({ project }) => {
			const { file, project: data, revision } = await readProjectSnapshot(project);
			const videoPath = resolveProjectMediaPath(file, data.videoPath);
			const raw = await fs.readFile(getKeysPathForVideo(videoPath), "utf8").catch(error => {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
				throw error;
			});
			return reply({ project: file, revision, timeBasis: "source", ...(raw === null ? { events: [] } : parseKeystrokeSidecar(raw)) });
		});
}
