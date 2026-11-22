/** A source can stop delivering frames without ending its MediaRecorder. */
export function watchWebcamTrack(
	track: MediaStreamTrack,
	onInterrupted: (reason: string) => void,
	graceMs = 5000,
) {
	let muteTimeout: ReturnType<typeof setTimeout> | undefined;
	const clearMuteTimeout = () => {
		clearTimeout(muteTimeout);
		muteTimeout = undefined;
	};
	const onEnded = () => {
		clearMuteTimeout();
		onInterrupted("Camera video track ended");
	};
	const onMuted = () => {
		clearMuteTimeout();
		muteTimeout = setTimeout(() => {
			muteTimeout = undefined;
			onInterrupted("Camera stopped supplying video frames");
		}, graceMs);
	};
	track.addEventListener("ended", onEnded);
	track.addEventListener("mute", onMuted);
	track.addEventListener("unmute", clearMuteTimeout);
	if (track.muted) onMuted();
	return () => {
		clearMuteTimeout();
		track.removeEventListener("ended", onEnded);
		track.removeEventListener("mute", onMuted);
		track.removeEventListener("unmute", clearMuteTimeout);
	};
}
export async function runOptionalWebcamTask(
	task: () => Promise<unknown>,
	onFailure: (error: unknown) => void,
) {
	try {
		await task();
	} catch (error) {
		onFailure(error);
	}
}
