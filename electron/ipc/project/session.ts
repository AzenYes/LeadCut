import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
	LEGACY_RECORDING_SESSION_MANIFEST_SUFFIXES,
	RECORDING_SESSION_MANIFEST_SUFFIX,
} from "../recording/recordingFileNames";
import type { RecordingSessionData, RecordingSessionManifest } from "../types";
import { normalizeVideoSourcePath, parseJsonWithByteOrderMark } from "../utils";

function normalizeRecordingTimeOffsetMs(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

function manifestPathForSuffix(videoPath: string, suffix: string) {
	const extension = path.extname(videoPath);
	const baseName = path.basename(videoPath, extension);
	return path.join(path.dirname(videoPath), `${baseName}${suffix}`);
}

export function getRecordingSessionManifestPath(videoPath: string) {
	return manifestPathForSuffix(videoPath, RECORDING_SESSION_MANIFEST_SUFFIX);
}

export function getRecordingSessionManifestPaths(videoPath: string) {
	return [
		getRecordingSessionManifestPath(videoPath),
		...LEGACY_RECORDING_SESSION_MANIFEST_SUFFIXES.map(suffix => manifestPathForSuffix(videoPath, suffix)),
	];
}

export async function persistRecordingSessionManifest(
	session: RecordingSessionData,
): Promise<void> {
	const normalizedVideoPath = normalizeVideoSourcePath(session.videoPath);
	if (!normalizedVideoPath) {
		return;
	}

	const normalizedWebcamPath = normalizeVideoSourcePath(session.webcamPath ?? null);
	const manifestPath = getRecordingSessionManifestPath(normalizedVideoPath);

	if (!normalizedWebcamPath) {
		await Promise.all(getRecordingSessionManifestPaths(normalizedVideoPath).map(file => fs.rm(file, { force: true })));
		return;
	}

	const manifest: RecordingSessionManifest = {
		version: 2,
		videoFileName: path.basename(normalizedVideoPath),
		webcamFileName: path.basename(normalizedWebcamPath),
		timeOffsetMs: normalizeRecordingTimeOffsetMs(session.timeOffsetMs),
	};

	await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
}

async function readRecordingSessionManifest(
	manifestPath: string, normalizedVideoPath: string,
): Promise<RecordingSessionData | null> {

	try {
		const content = await fs.readFile(manifestPath, "utf-8");
		const parsed = parseJsonWithByteOrderMark<Partial<RecordingSessionManifest>>(content);
		if (parsed.version !== 1 && parsed.version !== 2) {
			return null;
		}

		const webcamFileName =
			typeof parsed.webcamFileName === "string" && parsed.webcamFileName.trim()
				? parsed.webcamFileName.trim()
				: null;
		if (!webcamFileName) {
			return {
				videoPath: normalizedVideoPath,
				webcamPath: null,
				timeOffsetMs: normalizeRecordingTimeOffsetMs(parsed.timeOffsetMs),
			};
		}

		const webcamPath = path.join(path.dirname(normalizedVideoPath), webcamFileName);
		const webcamExists = await fs
			.access(webcamPath, fsConstants.F_OK)
			.then(() => true)
			.catch(() => false);

		return {
			videoPath: normalizedVideoPath,
			webcamPath: webcamExists ? webcamPath : null,
			timeOffsetMs: normalizeRecordingTimeOffsetMs(parsed.timeOffsetMs),
		};
	} catch {
		return null;
	}
}

export async function resolveRecordingSessionManifest(
	videoPath?: string | null,
): Promise<RecordingSessionData | null> {
	const normalizedVideoPath = normalizeVideoSourcePath(videoPath);
	if (!normalizedVideoPath) return null;
	for (const manifestPath of getRecordingSessionManifestPaths(normalizedVideoPath)) {
		const session = await readRecordingSessionManifest(manifestPath, normalizedVideoPath);
		if (session) return session;
	}
	return null;
}

export async function resolveLinkedWebcamPath(videoPath?: string | null): Promise<string | null> {
	const normalizedVideoPath = normalizeVideoSourcePath(videoPath);
	if (!normalizedVideoPath) {
		return null;
	}

	const extension = path.extname(normalizedVideoPath);
	const baseName = path.basename(normalizedVideoPath, extension);
	if (!baseName || baseName.endsWith("-webcam")) {
		return null;
	}

	const candidateExtensions = Array.from(
		new Set([extension, ".webm", ".mp4", ".mov", ".mkv", ".avi"].filter(Boolean)),
	);

	for (const candidateExtension of candidateExtensions) {
		const candidatePath = path.join(
			path.dirname(normalizedVideoPath),
			`${baseName}-webcam${candidateExtension}`,
		);

		try {
			await fs.access(candidatePath, fsConstants.F_OK);
			return candidatePath;
		} catch {
			continue;
		}
	}

	return null;
}

export async function resolveRecordingSession(
	videoPath?: string | null,
): Promise<RecordingSessionData | null> {
	const manifestSession = await resolveRecordingSessionManifest(videoPath);
	if (manifestSession) {
		return manifestSession;
	}

	const normalizedVideoPath = normalizeVideoSourcePath(videoPath);
	if (!normalizedVideoPath) {
		return null;
	}

	const linkedWebcamPath = await resolveLinkedWebcamPath(normalizedVideoPath);
	return {
		videoPath: normalizedVideoPath,
		webcamPath: linkedWebcamPath,
	};
}
