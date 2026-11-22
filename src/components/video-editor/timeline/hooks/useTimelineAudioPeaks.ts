import { useCallback, useEffect, useState } from "react";
import { getVersionedAudioResourceUrl } from "@/components/video-editor/audio/audioResourceVersion";
import { getLocalFilePath, resolveMediaResourceUrl } from "@/lib/exporter/localMediaSource";
import { WaveformMediaNotFoundError, waveformGenerator } from "../../audio/waveform/WaveformGenerator";
import { fromFileUrl } from "../../projectPersistence";
import { WAVEFORM_DEFAULT_PEAK_COUNT } from "../core/constants";
import type { AudioPeaksData } from "../core/timelineTypes";

const EMPTY_FALLBACK_RESOURCES: string[] = [];
let nextWaveformRequestId = 0;

function buildSidecarAudioCandidates(sourcePath: string): string[] {
	const normalized = sourcePath.replace(/\\/g, "/");
	const lastSlash = normalized.lastIndexOf("/");
	const dir = lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : "";
	const fileName = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
	const dotIndex = fileName.lastIndexOf(".");
	const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;

	return [
		`${dir}${baseName}.system.wav`,
		`${dir}${baseName}.mic.wav`,
		`${dir}${baseName}.system.m4a`,
		`${dir}${baseName}.mic.m4a`,
		`${dir}${baseName}.system.webm`,
		`${dir}${baseName}.mic.webm`,
	];
}

interface TimelineAudioPeaksOptions {
	enableSourceSidecarFallback?: boolean;
	fallbackResources?: string[];
	optionalSource?: boolean;
	peakCount?: number;
	resourceVersion?: number;
}

export interface TimelineAudioPeaksResult {
	peaks: AudioPeaksData | null;
	resource: string | null;
	loading: boolean;
	progress: number | null;
	error: string | null;
	retry: () => void;
}

export function useTimelineAudioPeaks(
	mediaResource: string | null | undefined,
	options: TimelineAudioPeaksOptions = {},
): TimelineAudioPeaksResult {
	const [result, setResult] = useState<{ peaks: AudioPeaksData; resource: string } | null>(null);
	const [loading, setLoading] = useState(false);
	const [progress, setProgress] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);
	const retry = useCallback(() => setAttempt((current) => current + 1), []);
	const enableSourceSidecarFallback = options.enableSourceSidecarFallback ?? false;
	const fallbackResources = options.fallbackResources ?? EMPTY_FALLBACK_RESOURCES;
	const optionalSource = options.optionalSource ?? false;
	const peakCount = options.peakCount ?? WAVEFORM_DEFAULT_PEAK_COUNT;
	const resourceVersion = options.resourceVersion ?? 0;

	useEffect(() => {
		setResult(null);
		setError(null);
		setProgress(null);
		if (!mediaResource) {
			setLoading(false);
			return;
		}

		setLoading(true);
		let cancelled = false;
		let requestId: number | null = null;
		const desktop = window.electronAPI;
		const unsubscribe = desktop?.onWaveformPeaksProgress?.((event) => {
			if (!cancelled && event.requestId === requestId) setProgress(event.ratio);
		});

		const run = async () => {
			const tryGenerate = async (resource: string, optional: boolean): Promise<AudioPeaksData | null> => {
				requestId = null;
				if (!cancelled) setProgress(null);
				const resolvedUrl = await resolveMediaResourceUrl(resource);
				const filePath = getLocalFilePath(resolvedUrl);
				if (filePath && desktop?.generateWaveformPeaks) {
					requestId = ++nextWaveformRequestId;
					const response = await desktop.generateWaveformPeaks(filePath, requestId);
					if (!response.success) {
						if (optional && response.unavailable) return null;
						throw new Error(response.error);
					}
					return "noAudio" in response ? null : { peaks: response.peaks, durationMs: response.durationMs };
				}
				const versionedUrl = getVersionedAudioResourceUrl(resolvedUrl, resourceVersion);
				try {
					return await waveformGenerator.generate(versionedUrl, peakCount, resourceVersion);
				} catch (error) {
					if (optional && error instanceof WaveformMediaNotFoundError) return null;
					throw error;
				}
			};

			const localPath = getLocalFilePath(mediaResource) || fromFileUrl(mediaResource);
			const sourceSidecarCandidates = enableSourceSidecarFallback && localPath
				? buildSidecarAudioCandidates(localPath) : EMPTY_FALLBACK_RESOURCES;
			const candidates = Array.from(
				new Set([mediaResource, ...fallbackResources, ...sourceSidecarCandidates]),
			);
			let failure: string | null = null;
			for (const candidate of candidates) {
				if (cancelled) return;
				try {
					const peaks = await tryGenerate(candidate, optionalSource || candidate !== mediaResource);
					if (!peaks) continue;
					if (!cancelled) {
						setResult({ peaks, resource: candidate });
						setLoading(false);
					}
					return;
				} catch (error) {
					failure ??= error instanceof Error ? error.message : String(error);
				}
			}

			if (!cancelled) {
				if (failure) console.warn(`Could not load waveform after attempt ${attempt + 1}:`, failure);
				setError(failure);
				setLoading(false);
			}
		};

		void run();

		return () => {
			cancelled = true;
			unsubscribe?.();
		};
	}, [mediaResource, enableSourceSidecarFallback, fallbackResources, optionalSource, peakCount, resourceVersion, attempt]);

	return { peaks: result?.peaks ?? null, resource: result?.resource ?? null, loading, progress, error, retry };
}
