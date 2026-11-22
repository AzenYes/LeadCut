export function normalizeWaveformPeaks(peaks: Float32Array) {
	const sorted = peaks.slice().sort();
	const scale = sorted[Math.floor(sorted.length * 0.995)] || sorted[sorted.length - 1] || 0;
	if (scale > 0) {
		for (let index = 0; index < peaks.length; index++) {
			peaks[index] = Math.min(1, peaks[index] / scale);
		}
	}
	return peaks;
}
