import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	editorLockPath,
	isLiveEditorLock,
	readEditorLock,
	type LeadCutEditorLock,
} from "../../../services/leadcut-mcp/src/editorLock";

export { editorLockPath } from "../../../services/leadcut-mcp/src/editorLock";

type HeldLock = { marker: LeadCutEditorLock; heartbeat: NodeJS.Timeout };
const heldLocks = new Map<string, HeldLock>();
let queue: Promise<unknown> = Promise.resolve();
let exiting = false;

function serialize<T>(action: () => Promise<T>): Promise<T> {
	const next = queue.catch(() => undefined).then(action);
	queue = next;
	return next;
}

function belongsToUs(value: Partial<LeadCutEditorLock> | null, marker: LeadCutEditorLock): boolean {
	return Boolean(value && value.pid === marker.pid && value.hostname === marker.hostname &&
		value.openedAt === marker.openedAt && value.projectPath === marker.projectPath);
}

async function writeMarker(marker: LeadCutEditorLock, exclusive = false) {
	const destination = editorLockPath(marker.projectPath);
	const temporary = path.join(path.dirname(destination), `.leadcut-lock-${randomUUID()}.tmp`);
	const body = JSON.stringify(marker);
	try {
		await fs.writeFile(temporary, body, { encoding: "utf8", flag: "wx" });
		if (exiting) return;
		if (exclusive) {
			try {
				await fs.link(temporary, destination);
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (code !== "ENOTSUP" && code !== "EOPNOTSUPP" && code !== "EPERM") throw error;
				await fs.writeFile(destination, body, { encoding: "utf8", flag: "wx" });
			}
		} else {
			await fs.rename(temporary, destination);
		}
	} finally {
		await fs.rm(temporary, { force: true }).catch(() => undefined);
	}
}

export function acquireEditorLock(projectPath: string): Promise<void> {
	const file = path.resolve(projectPath);
	return serialize(async () => {
		if (exiting || heldLocks.has(file)) return;
		const existing = await readEditorLock(file);
		if (existing && existing.pid !== process.pid && isLiveEditorLock(existing)) {
			throw new Error("The project is already open in LeadCut.");
		}
		const now = new Date().toISOString();
		const marker: LeadCutEditorLock = {
			app: "LeadCut", version: 1, pid: process.pid, hostname: os.hostname(), projectPath: file,
			openedAt: now, heartbeatAt: now,
		};
		try {
			await writeMarker(marker, !existing);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const newer = await readEditorLock(file);
			if (newer && newer.pid !== process.pid && isLiveEditorLock(newer)) {
				throw new Error("The project is already open in LeadCut.");
			}
			await writeMarker(marker);
		}
		if (exiting) return;
		const heartbeat = setInterval(() => {
			void serialize(async () => {
				if (heldLocks.get(file)?.marker !== marker) return;
				const disk = await readEditorLock(file);
				if (!belongsToUs(disk, marker)) return;
				marker.heartbeatAt = new Date().toISOString();
				await writeMarker(marker);
			}).catch(error => console.warn("Could not update LeadCut editor lock", error));
		}, 10_000);
		heartbeat.unref();
		heldLocks.set(file, { marker, heartbeat });
	});
}

export function releaseEditorLock(projectPath: string): Promise<void> {
	const file = path.resolve(projectPath);
	return serialize(async () => {
		const held = heldLocks.get(file);
		if (!held) return;
		if (belongsToUs(await readEditorLock(file), held.marker)) {
			await fs.rm(editorLockPath(file), { force: true });
		}
		clearInterval(held.heartbeat);
		heldLocks.delete(file);
	});
}

export function releaseEditorLocksOnExit() {
	exiting = true;
	for (const [file, { marker, heartbeat }] of heldLocks) {
		clearInterval(heartbeat);
		const lockPath = editorLockPath(file);
		try {
			const disk = JSON.parse(readFileSync(lockPath, "utf8")) as LeadCutEditorLock;
			if (belongsToUs(disk, marker)) unlinkSync(lockPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("Could not remove LeadCut editor lock on exit", error);
		}
	}
	heldLocks.clear();
}
