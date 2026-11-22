export function createSilenceDetector({ threshold, windowMs = 10_000 }: { threshold: number; windowMs?: number }) {
	let silenceSince: number | undefined;
	let reported = false;
	return (level: number, nowMs: number) => {
		if (!Number.isFinite(level) || level >= threshold) {
			silenceSince = undefined;
			reported = false;
			return false;
		}
		silenceSince ??= nowMs;
		if (reported || nowMs - silenceSince < windowMs) return false;
		reported = true;
		return true;
	};
}
