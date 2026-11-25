export function getGifFrameDelayMs(frameIndex: number, frameRate: number): number {
	// Round absolute frame boundaries so the GIF's 10 ms units do not accumulate drift.
	const start = Math.round((frameIndex * 100) / frameRate);
	const end = Math.round(((frameIndex + 1) * 100) / frameRate);
	return (end - start) * 10;
}
