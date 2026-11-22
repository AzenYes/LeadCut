const previewVideos = new WeakMap<Window, HTMLVideoElement>();

export function setTimelinePreviewVideo(owner: Window, video: HTMLVideoElement | null) {
	if (video) previewVideos.set(owner, video);
	else previewVideos.delete(owner);
}

/** While playing, schedule the viewport after the pending preview picture. */
export function scheduleTimelineViewportUpdate(owner: Window, update: () => void): () => void {
	const video = previewVideos.get(owner);
	if (!video || video.paused || video.seeking || !video.requestVideoFrameCallback) {
		const frame = owner.requestAnimationFrame(update);
		return () => owner.cancelAnimationFrame(frame);
	}

	let afterFrame: number | undefined;
	const updateOnce = () => {
		cancel();
		update();
	};
	const frame = video.requestVideoFrameCallback(() => {
		afterFrame = owner.setTimeout(updateOnce, 0);
	});
	const timeout = owner.setTimeout(updateOnce, 45);
	const cancel = () => {
		video.cancelVideoFrameCallback(frame);
		owner.clearTimeout(timeout);
		if (afterFrame !== undefined) owner.clearTimeout(afterFrame);
	};
	return cancel;
}
