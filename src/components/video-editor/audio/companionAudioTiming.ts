import { clampMediaTimeToDuration, estimateCompanionAudioStartDelaySeconds } from "@/lib/mediaTiming";

interface CompanionTiming {
	durationSec: number;
	audioDurationSec: number | null;
	startDelayMs?: number;
	kind: "mic" | "system";
}

export function resolveCompanionPreviewStartDelaySeconds({
	durationSec,
	audioDurationSec,
	startDelayMs,
	kind,
}: CompanionTiming): number {
	// Older mic recordings may lack a timestamp. A shorter track can also mean
	// the capture ended earlier, so use explicit mic timing when it is available.
	const delay = estimateCompanionAudioStartDelaySeconds(
		durationSec,
		kind === "mic" ? null : audioDurationSec,
		startDelayMs,
	);
	if (kind === "mic" && delay > 2) return 0;
	if (
		Number.isFinite(durationSec) &&
		(delay >= Math.max(0, durationSec - 0.01) ||
			delay > Math.max(5, durationSec * 0.9))
	) return 0;
	return delay;
}

export function resolveCompanionPreviewTargetTime({
	currentTimeSec,
	...timing
}: CompanionTiming & { currentTimeSec: number }) {
	const delay = resolveCompanionPreviewStartDelaySeconds(timing);
	return {
		targetTimeSec: clampMediaTimeToDuration(currentTimeSec - delay, timing.audioDurationSec),
		beforeAudioStart: currentTimeSec + 0.001 < delay,
	};
}
