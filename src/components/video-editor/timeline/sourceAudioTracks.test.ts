import { describe, expect, it } from "vitest";
import type { AudioPeaksData } from "./core/timelineTypes";
import {
	buildSourceSidecarPathCandidates,
	buildTimelineSourceAudioTracks,
	getSourceSidecarWaveformStartDelayMs,
} from "./sourceAudioTracks";

function peaks(id: number): AudioPeaksData {
	return {
		durationMs: 1000,
		peaks: new Float32Array([id]),
	};
}

const labels = {
	system: "Source System",
	mic: "Source Mic",
	mixed: "Source",
};

describe("timeline source audio tracks", () => {
	it("samples the selected microphone sidecar with the same timing as playback", () => {
		const mic = { durationMs: 2211480, peaks: new Float32Array([1]) };
		const micStartDelayMs = getSourceSidecarWaveformStartDelayMs({
			resource: "D:/Recordings/capture.mic.wav",
			peaks: mic,
			videoDuration: 2212.7825,
			kind: "mic",
			startDelayMsByPath: { "D:\\Recordings\\capture.mic.wav": 1140 },
		});
		expect(buildTimelineSourceAudioTracks({
			sourceAudioPeaks: null,
			micSidecarPeaks: mic,
			systemSidecarPeaks: null,
			micStartDelayMs,
			labels,
		})).toEqual([{ id: "mic", label: "Source Mic", peaks: mic, startDelayMs: 1140 }]);
	});

	it("builds candidates for Windows and macOS sidecar containers", () => {
		expect(buildSourceSidecarPathCandidates("C:\\Recordly\\recording-1.mp4", "mic")).toEqual([
			"C:/Recordly/recording-1.mic.wav",
			"C:/Recordly/recording-1.mic.m4a",
			"C:/Recordly/recording-1.mic.webm",
		]);
	});

	it("keeps embedded system audio controllable when mic is a sidecar", () => {
		const source = peaks(1);
		const mic = peaks(2);

		expect(
			buildTimelineSourceAudioTracks({
				sourceAudioPeaks: source,
				micSidecarPeaks: mic,
				systemSidecarPeaks: null,
				labels,
			}),
		).toEqual([
			{ id: "system", label: "Source System", peaks: source },
			{ id: "mic", label: "Source Mic", peaks: mic },
		]);
	});

	it("does not invent a system track when only the mic sidecar exists", () => {
		const mic = peaks(2);

		expect(
			buildTimelineSourceAudioTracks({
				sourceAudioPeaks: null,
				micSidecarPeaks: mic,
				systemSidecarPeaks: null,
				labels,
			}),
		).toEqual([{ id: "mic", label: "Source Mic", peaks: mic }]);
	});

	it("uses dedicated sidecars over the embedded track when both source tracks exist", () => {
		const source = peaks(1);
		const system = peaks(2);
		const mic = peaks(3);

		expect(
			buildTimelineSourceAudioTracks({
				sourceAudioPeaks: source,
				micSidecarPeaks: mic,
				systemSidecarPeaks: system,
				labels,
			}),
		).toEqual([
			{ id: "system", label: "Source System", peaks: system },
			{ id: "mic", label: "Source Mic", peaks: mic },
		]);
	});

	it("falls back to one mixed source track when no dedicated sidecar exists", () => {
		const source = peaks(1);

		expect(
			buildTimelineSourceAudioTracks({
				sourceAudioPeaks: source,
				micSidecarPeaks: null,
				systemSidecarPeaks: null,
				labels,
			}),
		).toEqual([{ id: "mixed", label: "Source", peaks: source }]);
	});
});
