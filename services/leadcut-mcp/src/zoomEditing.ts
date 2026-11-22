import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type LeadcutProject, resolveProjectMediaPath } from "./projectStore.js";
import { ZOOM_DEPTH_SCALES } from "./zoomRenderer.js";
import { mutate, readProjectSnapshot, reply } from "./mutation.js";
import { chapterSequenceDuration, type ChapterSequence } from "./chapterModel.js";
import { getMediaInfo } from "./media.js";

type Region = Record<string, unknown> & { id: string; startMs: number; endMs: number };
const time = z.number().finite().int().nonnegative();
const range = {
	startMs: time.optional().describe("Sequence time in milliseconds, inclusive. Supply together with endMs."),
	endMs: time.optional().describe("Sequence time in milliseconds, exclusive. Supply together with startMs."),
};
const projectArg = z.string().min(1).describe("Project name or absolute .leadcut path. Return to Home in LeadCut before writing, then reopen the project. Prefer a working copy.");
const writeArgs = {
	expectedRevision: z.string().optional().describe("SHA-256 revision required for writes from list_zooms; reject if the project changed."),
	dryRun: z.boolean().default(true).describe("Preview the exact change without writing or creating a backup."),
};
const timeBasis = "LeadCut sequence milliseconds";

function regions(project: LeadcutProject): Region[] {
	const list = project.editor.zoomRegions ?? [];
	if (!Array.isArray(list)) throw new Error("zoomRegions must be an array.");
	const ids = new Set<string>();
	for (const r of list) {
		if (!r || typeof r.id !== "string" || !r.id || ids.has(r.id) ||
			!Number.isFinite(r.startMs) || !Number.isFinite(r.endMs) || r.startMs < 0 || r.endMs <= r.startMs) {
			throw new Error("Invalid zoom region or duplicate ID; project was not modified.");
		}
		ids.add(r.id);
	}
	return list as Region[];
}

function checkRange(startMs?: number, endMs?: number): boolean {
	if (startMs === undefined && endMs === undefined) return false;
	if (startMs === undefined || endMs === undefined || endMs <= startMs) {
		throw new Error("Supply both startMs and endMs, with endMs > startMs.");
	}
	return true;
}

function mutateZooms(
	name: string,
	expectedRevision: string | undefined,
	dryRun: boolean,
	edit: (project: LeadcutProject, file: string) =>
		{ next: Region[]; changes: unknown; count: number } | Promise<{ next: Region[]; changes: unknown; count: number }>,
) {
	return mutate(name, dryRun, expectedRevision, async (project, file) => {
		const { next, changes, count } = await edit(project, file);
		return {
			project: count === 0 ? project : { ...project, editor: { ...project.editor, zoomRegions: next } },
			changes, matchedCount: count, timeBasis,
		};
	});
}

async function projectDuration(project: LeadcutProject, file: string) {
	const durationMs = chapterSequenceDuration(project.editor as ChapterSequence);
	if (!Number.isFinite(durationMs)) throw new Error("Invalid sequence duration. Save the project in LeadCut.");
	if (Array.isArray(project.editor.clipRegions)) return durationMs;
	if (Array.isArray(project.editor.trimRegions) && project.editor.trimRegions.length > 0) {
		throw new Error("Save the project in LeadCut to normalize legacy trims before adding a zoom.");
	}
	const media = await getMediaInfo(resolveProjectMediaPath(file, project.videoPath));
	return Math.max(durationMs, media.durationMs);
}

export function registerZoomEditingTools(server: McpServer) {
	server.tool("list_zooms",
		"List zoom IDs, sequence times, depth and focus. The optional range selects overlapping regions using a half-open interval. Depth is a discrete level.",
		{ project: projectArg, ...range },
		async ({ project, startMs, endMs }) => {
			const hasRange = checkRange(startMs, endMs);
			const { file, project: data, revision } = await readProjectSnapshot(project);
			const all = regions(data);
			const selected = all.filter(r => !hasRange || (r.startMs < endMs! && r.endMs > startMs!));
			return reply({ project: file, revision, totalCount: all.length,
				zoomRegions: [...selected].sort((a, b) => a.startMs - b.startMs),
				depthScales: ZOOM_DEPTH_SCALES,
				timeBasis });
		});
	server.tool("add_zoom",
		"Add a zoom in sequence milliseconds. A zoom must stay within the sequence and avoid existing effects. Writes create a backup.",
		{ project: projectArg, startMs: time, endMs: time,
			depth: z.number().int().min(1).max(6).default(1),
			focusX: z.number().finite().min(0).max(1).default(0.5),
			focusY: z.number().finite().min(0).max(1).default(0.5),
			mode: z.enum(["auto", "manual"]).default("auto"), ...writeArgs },
		async ({ project, startMs, endMs, depth, focusX, focusY, mode, expectedRevision, dryRun }) =>
			mutateZooms(project, expectedRevision, dryRun, async (data, file) => {
				checkRange(startMs, endMs);
				const all = regions(data);
				const conflict = all.find(region => region.startMs < endMs && region.endMs > startMs);
				if (conflict) throw new Error(`Zoom overlaps ${conflict.id} (${conflict.startMs}–${conflict.endMs} ms).`);
				const durationMs = await projectDuration(data, file);
				if (endMs > durationMs) throw new Error(`Zoom ends beyond the sequence duration (${durationMs} ms).`);
				const maxId = all.reduce((max, region) => {
					const match = /^zoom-(\d+)$/.exec(region.id);
					const index = match ? Number(match[1]) : 0;
					return Number.isSafeInteger(index) ? Math.max(max, index) : max;
				}, 0);
				if (maxId >= Number.MAX_SAFE_INTEGER) throw new Error("Zoom ID sequence is out of range.");
				const added = { id: `zoom-${maxId + 1}`, startMs, endMs, depth, mode, focus: { cx: focusX, cy: focusY } };
				return { next: [...all, added].sort((left, right) => left.startMs - right.startMs), changes: { added }, count: 1 };
			}),
	);

	server.tool("update_zoom",
		"Edit one EXISTING zoom by ID: adjust depth, focus, start/end, or auto/manual mode. Unspecified and unknown fields are preserved. Use mode=manual with a fixed focus to avoid automatic cursor-follow for this region. Saves an automatic backup; does not render or change video cuts.",
		{ project: projectArg, zoomId: z.string().min(1),
			startMs: time.optional(), endMs: time.optional(),
			depth: z.number().int().min(1).max(6).optional().describe("Discrete zoom strength. Lower is less magnified; see list_zooms depthScales."),
			focusX: z.number().finite().min(0).max(1).optional(),
			focusY: z.number().finite().min(0).max(1).optional(),
			mode: z.enum(["auto", "manual"]).optional(), ...writeArgs },
		async ({ project, zoomId, expectedRevision, dryRun, ...patch }) => mutateZooms(project, expectedRevision, dryRun, data => {
			const all = regions(data);
			const before = all.find(r => r.id === zoomId);
			if (!before) throw new Error(`Zoom ID not found: ${zoomId}`);
			if (!Object.values(patch).some(v => v !== undefined)) throw new Error("Supply at least one zoom field to update.");
			const after = { ...before };
			if (patch.startMs !== undefined) after.startMs = patch.startMs;
			if (patch.endMs !== undefined) after.endMs = patch.endMs;
			if (patch.depth !== undefined) after.depth = patch.depth;
			if (patch.mode !== undefined) after.mode = patch.mode;
			checkRange(after.startMs, after.endMs);
			if (patch.focusX !== undefined || patch.focusY !== undefined) {
				const old = before.focus;
				if (old !== undefined && (!old || typeof old !== "object" || Array.isArray(old))) throw new Error("Invalid existing focus; no changes written.");
				after.focus = { cx: 0.5, cy: 0.5, ...(old as Record<string, unknown> | undefined),
					...(patch.focusX !== undefined ? { cx: patch.focusX } : {}),
					...(patch.focusY !== undefined ? { cy: patch.focusY } : {}) };
			}
			return { next: all.map(r => r.id === zoomId ? after : r), changes: { before, after }, count: 1 };
		}));

	server.tool("delete_zooms",
		"Remove existing zoom effects, leaving the video intact. Select EITHER explicit zoomIds OR a half-open sequence-time startMs/endMs range. Range matching defaults to overlap and deletes whole matching zoom regions, including portions outside the requested range; use dryRun to inspect, or contained to select only fully contained effects. No selector is rejected. Automatic backup on change.",
		{ project: projectArg, zoomIds: z.array(z.string().min(1)).min(1).optional(), ...range,
			match: z.enum(["overlap", "contained"]).default("overlap"), ...writeArgs },
		async ({ project, zoomIds, startMs, endMs, match, expectedRevision, dryRun }) => mutateZooms(project, expectedRevision, dryRun, data => {
			const hasRange = checkRange(startMs, endMs);
			if (Boolean(zoomIds) === hasRange) throw new Error("Select either zoomIds or a startMs/endMs range, never both or neither.");
			const all = regions(data);
			if (zoomIds) {
				const missing = zoomIds.filter(id => !all.some(r => r.id === id));
				if (missing.length) throw new Error(`Zoom IDs not found; nothing deleted: ${missing.join(", ")}`);
			}
			const removed = all.filter(r => zoomIds ? zoomIds.includes(r.id) :
				match === "contained" ? r.startMs >= startMs! && r.endMs <= endMs! : r.startMs < endMs! && r.endMs > startMs!);
			const ids = new Set(removed.map(r => r.id));
			return { next: all.filter(r => !ids.has(r.id)), changes: { removed }, count: removed.length };
		}));
}

