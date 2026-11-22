const supportedRates = new Map<number, boolean>();
const fallbackRates = new WeakMap<HTMLMediaElement, { requested: number; applied: number }>();

/** Ask the runtime rather than assuming every platform accepts the same rates. */
export function supportsPreviewPlaybackRate(rate: number): boolean {
	if (!Number.isFinite(rate) || rate <= 0) return false;
	const cached = supportedRates.get(rate);
	if (cached !== undefined) return cached;
	const video = document.createElement("video");
	try {
		video.playbackRate = rate;
		supportedRates.set(rate, true);
		return true;
	} catch (error) {
		if (!(error instanceof DOMException) || error.name !== "NotSupportedError") throw error;
		supportedRates.set(rate, false);
		return false;
	}
}

/** Keep an extreme review speed playable at the nearest rate accepted by the element. */
export function applyPreviewPlaybackRate(media: HTMLMediaElement, requested: number) {
	const desired = Number.isFinite(requested) && requested > 0 ? requested : 1;
	if (media.playbackRate === desired) return;
	const cached = fallbackRates.get(media);
	if (cached?.requested === desired && media.playbackRate === cached.applied) return;
	const apply = (rate: number) => {
		try {
			media.playbackRate = rate;
			return true;
		} catch (error) {
			if (!(error instanceof DOMException) || error.name !== "NotSupportedError") throw error;
			return false;
		}
	};
	if (apply(desired)) return;
	let accepted = 1;
	let rejected = desired;
	for (let iteration = 0; iteration < 20 && Math.abs(accepted - rejected) > 0.001; iteration++) {
		const candidate = (accepted + rejected) / 2;
		if (apply(candidate)) accepted = candidate;
		else rejected = candidate;
	}
	apply(accepted);
	fallbackRates.set(media, { requested: desired, applied: media.playbackRate });
}

/** Contiguous quarter-step range supported by the runtime, anchored at normal speed. */
export function getPreviewPlaybackRateRange(): { min: number; max: number } {
	let min = 1;
	let max = 1;
	while (min > 0.25 && supportsPreviewPlaybackRate(min - 0.25)) min -= 0.25;
	while (max < 30 && supportsPreviewPlaybackRate(max + 0.25)) max += 0.25;
	return { min, max };
}
