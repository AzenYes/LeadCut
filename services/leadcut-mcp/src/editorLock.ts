import fs from "node:fs/promises";
import os from "node:os";

export interface LeadCutEditorLock {
	app: "LeadCut";
	version: 1;
	pid: number;
	hostname: string;
	projectPath: string;
	openedAt: string;
	heartbeatAt: string;
}

export function editorLockPath(projectPath: string): string {
	return `${projectPath}.leadcut-lock`;
}

export async function readEditorLock(projectPath: string): Promise<LeadCutEditorLock | null> {
	try {
		const value: unknown = JSON.parse(await fs.readFile(editorLockPath(projectPath), "utf8"));
		if (!value || typeof value !== "object") return null;
		const marker = value as Partial<LeadCutEditorLock>;
		if (marker.app !== "LeadCut" || marker.version !== 1 || typeof marker.pid !== "number" ||
			!Number.isInteger(marker.pid) || marker.pid <= 0 || typeof marker.hostname !== "string" ||
			typeof marker.projectPath !== "string" || typeof marker.openedAt !== "string" ||
			typeof marker.heartbeatAt !== "string") return null;
		return marker as LeadCutEditorLock;
	} catch (error) {
		if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

export function isLiveEditorLock(marker: LeadCutEditorLock, now = Date.now()): boolean {
	if (marker.hostname.toLowerCase() !== os.hostname().toLowerCase()) return false;
	const heartbeat = Date.parse(marker.heartbeatAt);
	if (!Number.isFinite(heartbeat) || now - heartbeat > 60_000) return false;
	try {
		process.kill(marker.pid, 0);
		return true;
	} catch {
		return false;
	}
}

export async function assertProjectNotOpen(projectPath: string, dryRun: boolean): Promise<boolean> {
	const marker = await readEditorLock(projectPath);
	const openInEditor = marker !== null && isLiveEditorLock(marker);
	if (openInEditor && !dryRun) {
		throw new Error("工程正在 LeadCut 编辑器中打开。请在编辑器里点「交给 Agent」，或回到「主页」释放工程，再重试。");
	}
	return openInEditor;
}
