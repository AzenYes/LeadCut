import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { openAacExportWriter } from "./aacExportWriter";

type ExportWriter = {
	write(position: number, data: Buffer): Promise<unknown>;
	close(): Promise<void>;
	abort?(): void;
};

export type ExportStreamOptions = { extension?: string; mode?: "aac-from-wav"; destinationPath?: string };

type ExportStreamSession = {
	streamId: string;
	sessionDir: string;
	tempPath: string;
	writer: ExportWriter;
	bytesWritten: number;
	highestWatermark: number;
	writeQueue: Promise<void>;
	aborted: boolean;
};

const exportStreamSessions = new Map<string, ExportStreamSession>();

const EXTENSION_ALLOWLIST = /^[a-z0-9]{1,8}$/;
const SESSION_DIR_PREFIX = "leadcut-export-";
const DESTINATION_DIR_PREFIX = ".leadcut-export-";

// Paths that the export pipeline itself produced (stream temp files plus any
// successor temp files returned by main-process helpers such as
// muxNativeVideoExportAudio). Every renderer-facing handler that moves or
// deletes a path must assert membership here before touching disk, so a
// compromised renderer can never route arbitrary file paths into the IPC.
const ownedExportPaths = new Map<string, boolean>();

function normalizeOwnedPath(candidate: string): string {
	return path.resolve(candidate);
}

export function registerOwnedExportPath(candidate: string, stagedBesideDestination = false): void {
	ownedExportPaths.set(normalizeOwnedPath(candidate), stagedBesideDestination);
}

export function releaseOwnedExportPath(candidate: string): void {
	ownedExportPaths.delete(normalizeOwnedPath(candidate));
}

export function isOwnedExportPath(candidate: string): boolean {
	return ownedExportPaths.has(normalizeOwnedPath(candidate));
}

export function isDestinationStagedExportPath(candidate: string): boolean {
	return ownedExportPaths.get(normalizeOwnedPath(candidate)) === true;
}

function generateStreamId() {
	return `leadcut-export-stream-${randomUUID()}`;
}

export async function openExportStream(options?: ExportStreamOptions, destinationDirectory?: string): Promise<{
	streamId: string;
	tempPath: string;
}> {
	const encodeAac = options?.mode === "aac-from-wav";
	const extension = encodeAac ? "m4a" : options?.extension ?? "mp4";
	if (!EXTENSION_ALLOWLIST.test(extension)) {
		throw new Error(`Invalid export stream extension: ${extension}`);
	}
	const streamId = generateStreamId();

	// The per-session directory protects both the initial stream and its mux output.
	const sessionDir = await fsp.mkdtemp(destinationDirectory
		? path.join(destinationDirectory, DESTINATION_DIR_PREFIX)
		: path.join(app.getPath("temp"), SESSION_DIR_PREFIX));
	const tempPath = path.join(sessionDir, `${streamId}.${extension}`);
	let writer: ExportWriter;
	try {
		await fsp.chmod(sessionDir, 0o700).catch(() => undefined);
		if (encodeAac) {
			writer = openAacExportWriter(tempPath);
		} else {
			const file = await fsp.open(tempPath, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
			writer = {
				write: (position, data) => file.write(data, 0, data.byteLength, position),
				close: () => file.close().catch(() => undefined),
			};
		}
	} catch (error) {
		await fsp.rmdir(sessionDir).catch(() => undefined);
		throw error;
	}

	exportStreamSessions.set(streamId, {
		streamId,
		sessionDir,
		tempPath,
		writer,
		bytesWritten: 0,
		highestWatermark: 0,
		writeQueue: Promise.resolve(),
		aborted: false,
	});
	registerOwnedExportPath(tempPath, Boolean(destinationDirectory));

	return { streamId, tempPath };
}

export async function writeToExportStream(
	streamId: string,
	position: number,
	chunk: Uint8Array,
): Promise<void> {
	const session = exportStreamSessions.get(streamId);
	if (!session) {
		throw new Error(`Export stream not found: ${streamId}`);
	}

	if (session.aborted) {
		throw new Error("Export stream was aborted");
	}

	// Serialize writes against the session to keep byte counters consistent when
	// the renderer issues concurrent chunks.
	const previous = session.writeQueue;
	const next = previous.then(async () => {
		if (session.aborted) {
			return;
		}
		const buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
		await session.writer.write(position, buffer);
		session.bytesWritten += buffer.byteLength;
		const end = position + buffer.byteLength;
		if (end > session.highestWatermark) {
			session.highestWatermark = end;
		}
	});
	session.writeQueue = next.catch(() => undefined);
	await next;
}

export async function closeExportStream(
	streamId: string,
	options?: { abort?: boolean },
): Promise<{ tempPath: string | null; bytesWritten: number }> {
	const session = exportStreamSessions.get(streamId);
	if (!session) {
		throw new Error(`Export stream not found: ${streamId}`);
	}

	const abort = options?.abort === true;
	if (abort) {
		session.aborted = true;
		session.writer.abort?.();
	}

	let closeError: unknown;
	try {
		await session.writeQueue;
		await session.writer.close();
	} catch (error) {
		closeError = error;
	}

	exportStreamSessions.delete(streamId);

	if (session.aborted || closeError) {
		releaseOwnedExportPath(session.tempPath);
		try {
			await fsp.rm(session.tempPath, { force: true });
		} catch {
			// Temp file may be gone already.
		}
		try {
			await fsp.rmdir(session.sessionDir);
		} catch {
			// ignore
		}
		if (closeError && !session.aborted) throw closeError;
		// Aborted streams return `tempPath: null` so callers cannot accidentally
		// reuse a path that no longer references a file on disk (or, worse, a
		// path a later session may recycle).
		return { tempPath: null, bytesWritten: 0 };
	}

	return {
		tempPath: session.tempPath,
		bytesWritten: session.highestWatermark,
	};
}

export function hasExportStream(streamId: string): boolean {
	return exportStreamSessions.has(streamId);
}

export async function removeExportStreamTemp(tempPath: string): Promise<void> {
	await fsp.rm(tempPath, { force: true });
	await removeExportStreamDirectory(tempPath);
}

export async function removeExportStreamDirectory(tempPath: string): Promise<void> {
	const parent = path.dirname(tempPath);
	const name = path.basename(parent);
	if (
		path.basename(tempPath).startsWith("leadcut-export-stream-") &&
		(name.startsWith(DESTINATION_DIR_PREFIX) ||
			(name.startsWith(SESSION_DIR_PREFIX) && path.relative(app.getPath("temp"), path.dirname(parent)) === ""))
	) {
		await fsp.rmdir(parent).catch(() => undefined);
	}
}

export async function cleanupAllExportStreams(beforeRemovingFiles?: Promise<unknown>): Promise<void> {
	const sessions = Array.from(exportStreamSessions.values());
	const tempPaths = Array.from(ownedExportPaths.keys());
	exportStreamSessions.clear();
	ownedExportPaths.clear();
	await Promise.allSettled(
		sessions.map(async (session) => {
			session.aborted = true;
			session.writer.abort?.();
			await session.writeQueue;
			await session.writer.close();
		}),
	);
	await beforeRemovingFiles;
	await Promise.allSettled(tempPaths.map(removeExportStreamTemp));
}
