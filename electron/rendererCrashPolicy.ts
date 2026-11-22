const RELOAD_WINDOW_MS = 60000;
const MAX_RELOADS = 3;

export function recentReloads(timestamps: readonly number[], now: number) {
	return timestamps.filter(timestamp => timestamp > now - RELOAD_WINDOW_MS && timestamp <= now);
}

export function shouldReload(reason: string, reloads: readonly number[], now: number) {
	return reason !== "clean-exit" && recentReloads(reloads, now).length < MAX_RELOADS;
}
