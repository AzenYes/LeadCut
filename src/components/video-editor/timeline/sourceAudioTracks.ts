import type { SourceAudioTrackWithPeaks } from "@/components/video-editor/audio/audioTypes";
import { resolveCompanionPreviewStartDelaySeconds } from "@/components/video-editor/audio/companionAudioTiming";
import { resolvePreviewMediaDuration } from "@/lib/mediaTiming";
import type { AudioPeaksData } from "./core/timelineTypes";

const SOURCE_SIDECAR_EXTENSIONS = [".wav", ".m4a", ".webm"] as const;

export function buildSourceSidecarPathCandidates(
	source: string,
	suffix: "mic" | "system",
): string[] {
	const normalized = source.replace(/\\/g, "/");
	const lastSlash = normalized.lastIndexOf("/");
	const dir = lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : "";
	const fileName = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
	const dotIndex = fileName.lastIndexOf(".");
	const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
	return SOURCE_SIDECAR_EXTENSIONS.map((extension) => `${dir}${baseName}.${suffix}${extension}`);
}

export function buildTimelineSourceAudioTracks({
	sourceAudioPeaks,
	micSidecarPeaks,
	systemSidecarPeaks,
	micStartDelayMs,
	systemStartDelayMs,
	labels,
}: {
	sourceAudioPeaks: AudioPeaksData | null;
	micSidecarPeaks: AudioPeaksData | null;
	systemSidecarPeaks: AudioPeaksData | null;
	micStartDelayMs?: number;
	systemStartDelayMs?: number;
	labels: {
		system: string;
		mic: string;
		mixed: string;
	};
}): SourceAudioTrackWithPeaks[] {
	if (systemSidecarPeaks || micSidecarPeaks) {
		const tracks: SourceAudioTrackWithPeaks[] = [];
		if (systemSidecarPeaks) {
			tracks.push({
				id: "system",
				label: labels.system,
				peaks: systemSidecarPeaks,
				...(systemStartDelayMs ? { startDelayMs: systemStartDelayMs } : {}),
			});
		} else if (micSidecarPeaks && sourceAudioPeaks) {
			tracks.push({
				id: "system",
				label: labels.system,
				peaks: sourceAudioPeaks,
			});
		}
		if (micSidecarPeaks) {
			tracks.push({
				id: "mic",
				label: labels.mic,
				peaks: micSidecarPeaks,
				...(micStartDelayMs ? { startDelayMs: micStartDelayMs } : {}),
			});
		}
		return tracks;
	}

	return sourceAudioPeaks
		? [
				{
					id: "mixed",
					label: labels.mixed,
					peaks: sourceAudioPeaks,
				},
			]
		: [];
}

export function getSourceSidecarWaveformStartDelayMs({
	resource,
	peaks,
	videoDuration,
	kind,
	startDelayMsByPath,
}: {
	resource: string | null;
	peaks: AudioPeaksData | null;
	videoDuration: number;
	kind: "mic" | "system";
	startDelayMsByPath?: Readonly<Record<string, number>>;
}): number {
	if (!resource || !peaks) return 0;
	const normalize = (file: string) => file.replace(/\\/g, "/");
	const normalized = normalize(resource);
	const startDelayMs = startDelayMsByPath && (
		startDelayMsByPath[resource] ?? Object.entries(startDelayMsByPath)
			.find(([file]) => normalize(file) === normalized)?.[1]
	);
	return resolveCompanionPreviewStartDelaySeconds({
		kind,
		durationSec: videoDuration,
		audioDurationSec: resolvePreviewMediaDuration(peaks.durationMs / 1000, videoDuration),
		startDelayMs,
	}) * 1000;
}
