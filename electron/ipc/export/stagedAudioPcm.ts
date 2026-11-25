export function getStagedAudioPcmWindow(window: unknown, sampleRate: number, sourceDurationSec: number) {
	if (!window || typeof window !== "object") return null;
	const { startSec, endSec } = window as Record<string, unknown>;
	if (
		typeof startSec !== "number" || !Number.isFinite(startSec) || startSec < 0 ||
		typeof endSec !== "number" || !Number.isFinite(endSec) || endSec <= startSec ||
		startSec >= sourceDurationSec
	) return null;

	const firstFrame = Math.floor(startSec * sampleRate);
	// Leave the decoded tail intact when the cut approaches the probed end.
	// Some files end with padding beyond their declared audio duration.
	const endFrame = endSec < sourceDurationSec - 1
		? Math.ceil(endSec * sampleRate) : undefined;
	const retainedDuration = (endFrame ?? (sourceDurationSec * sampleRate)) / sampleRate - firstFrame / sampleRate;
	if (
		!Number.isSafeInteger(firstFrame) ||
		(endFrame !== undefined && !Number.isSafeInteger(endFrame)) ||
		retainedDuration >= sourceDurationSec * 0.75
	) return null;

	const filter = endFrame === undefined
		? `atrim=start_sample=${firstFrame}`
		: `atrim=start_sample=${firstFrame}:end_sample=${endFrame}`;
	return { firstFrame, endFrame, filter };
}
