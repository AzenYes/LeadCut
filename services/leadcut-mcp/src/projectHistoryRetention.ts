import fs from "node:fs/promises";
import path from "node:path";

const MAX_HISTORY_BYTES = 128 * 1024 * 1024;
const DAY_MS = 86_400_000;
export const PROJECT_HISTORY_RETENTION = {
	keepLast: 30,
	maxAgeDays: 30,
	maxBytes: MAX_HISTORY_BYTES,
};

export function agentBackupLinkPath(backup: string) {
	const directory = path.dirname(backup);
	if (path.basename(directory) !== ".mcp-backups") return null;
	const match = /\.\d{13}-([a-f0-9-]{36})\.leadcut$/.exec(path.basename(backup));
	return match ? path.join(directory, `.agent-revision-${match[1]}.json`) : null;
}

export async function pruneHistoryFiles(
	files: readonly { path: string; createdAt: number }[],
	options: { keepLast: number; maxAgeDays: number; maxBytes?: number } = PROJECT_HISTORY_RETENTION,
) {
	const cutoff = Date.now() - options.maxAgeDays * DAY_MS;
	const oldDays = new Set<number>();
	let bytes = 0;
	let kept = 0;
	let removed = 0;
	for (const file of files) {
		const details = await fs.lstat(file.path).catch(error => {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			return null;
		});
		if (!details?.isFile()) continue;
		const day = Math.floor(file.createdAt / DAY_MS);
		const duplicateOldDay = file.createdAt < cutoff && oldDays.has(day);
		if (kept >= options.keepLast || (kept > 0 && bytes + details.size > (options.maxBytes ?? MAX_HISTORY_BYTES)) || duplicateOldDay) {
			await fs.rm(file.path, { force: true });
			const link = agentBackupLinkPath(file.path);
			if (link) await fs.rm(link, { force: true });
			removed++;
			continue;
		}
		oldDays.add(day);
		kept++;
		bytes += details.size;
	}
	return removed;
}
