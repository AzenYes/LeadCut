import React, { useCallback, useMemo } from "react";
import type { SourceAudioTrackSettings } from "@/components/video-editor/audio/audioTypes";
import { resolveSourceTrackRoutingPolicy } from "@/lib/exporter/sourceTrackRoutingPolicy";
import type { AudioRegion, ClipRegion } from "../types";
import { getClipSourceStartMs, sortClipRegions } from "../types";
import type { PlaybackClock } from "../videoPlayback/playbackClock";
import { useAudioPreviewSync } from "./useAudioPreviewSync";
import { useClipAudioSettingsController } from "./useClipAudioSettingsController";
import { useSourceAudioFallback } from "./useSourceAudioFallback";

function extractLocalPathFromMediaServerUrl(input: string | null | undefined): string | null {
	if (!input) return null;
	try {
		const url = new URL(input);
		const isLocalMediaServer =
			(url.protocol === "http:" || url.protocol === "https:") &&
			(url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
			url.pathname === "/video";
		if (!isLocalMediaServer) return null;
		return url.searchParams.get("path");
	} catch {
		return null;
	}
}

interface UseVideoEditorAudioParams {
	currentSourcePath: string | null;
	selectedClipId: string | null;
	clipRegions: ClipRegion[];
	audioRegions: AudioRegion[];
	sourceAudioTrackSettingsByClip: Record<string, SourceAudioTrackSettings>;
	setSourceAudioTrackSettingsByClip: React.Dispatch<
		React.SetStateAction<Record<string, SourceAudioTrackSettings>>
	>;
	defaultSourceAudioTrackSettings: SourceAudioTrackSettings;
	setDefaultSourceAudioTrackSettings: React.Dispatch<
		React.SetStateAction<SourceAudioTrackSettings>
	>;
	playbackClock: PlaybackClock;
	mapTimelineTimeToSourceTime: (milliseconds: number) => number;
	duration: number;
	isPlaying: boolean;
	previewPlaybackRate?: number;
	previewVolume: number;
	sourceAudioFallbackRefreshKey?: number;
	summarizeErrorMessage: (message: string) => string;
	onSourceFallbackLoadError: (error: unknown) => void;
}

export function useVideoEditorAudio({
	currentSourcePath,
	selectedClipId,
	clipRegions,
	audioRegions,
	sourceAudioTrackSettingsByClip,
	setSourceAudioTrackSettingsByClip,
	defaultSourceAudioTrackSettings,
	setDefaultSourceAudioTrackSettings,
	playbackClock,
	mapTimelineTimeToSourceTime,
	duration,
	isPlaying,
	previewPlaybackRate = 1,
	previewVolume,
	sourceAudioFallbackRefreshKey = 0,
	summarizeErrorMessage,
	onSourceFallbackLoadError,
}: UseVideoEditorAudioParams) {
	const fallbackLookupSourcePath = useMemo(
		() => extractLocalPathFromMediaServerUrl(currentSourcePath) ?? currentSourcePath,
		[currentSourcePath],
	);

	const { sourceAudioFallbackPaths, sourceAudioSidecarPaths, sourceAudioFallbackStartDelayMsByPath } =
		useSourceAudioFallback({
			currentSourcePath: fallbackLookupSourcePath,
			refreshKey: sourceAudioFallbackRefreshKey,
			summarizeErrorMessage,
		});

	const sourceTrackRoutingPolicy = useMemo(
		() => resolveSourceTrackRoutingPolicy(currentSourcePath, sourceAudioFallbackPaths),
		[currentSourcePath, sourceAudioFallbackPaths],
	);
	const previewSourceAudioFallbackPaths = sourceTrackRoutingPolicy.playbackPaths;
	const shouldMutePreviewVideo = sourceTrackRoutingPolicy.muteEmbeddedPreview;

	const sortedClips = useMemo(() => sortClipRegions(clipRegions), [clipRegions]);
	const getSourcePlayback = useCallback((timelineTime: number) => {
		const ms = timelineTime * 1000;
		const clip = sortedClips.find(candidate => ms >= candidate.startMs && ms < candidate.endMs);
		const speed = clip && Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
		const currentSourceTimeMs = clip
			? Math.round(getClipSourceStartMs(clip) + (Math.round(ms) - clip.startMs) * speed)
			: mapTimelineTimeToSourceTime(ms);
		return {
			activeClipId: clip?.id ?? null,
			currentSourceTimeMs,
			sourcePlaybackRate: speed * previewPlaybackRate,
			isCurrentClipMuted: !clip || clip.muted === true,
		};
	}, [mapTimelineTimeToSourceTime, previewPlaybackRate, sortedClips]);

	const {
		sourceAudioTrackMeta,
		selectedClipSourceAudioTrackSettings,
		getSourceAudioTrackSettingsForClip,
		onSourceAudioTracksMetaChange,
		onSelectedClipSourceAudioTrackVolumeChange,
		onSelectedClipSourceAudioTrackNormalizeChange,
		onSourceAudioRangeDelete,
		embeddedTrackId,
		getSourceTrackPreviewGain,
	} = useClipAudioSettingsController({
		selectedClipId,
		sourceAudioTrackSettingsByClip,
		setSourceAudioTrackSettingsByClip,
		defaultSourceAudioTrackSettings,
		setDefaultSourceAudioTrackSettings,
	});

	const { playSourceAudioPreview } = useAudioPreviewSync({
		audioRegions,
		previewVolume,
		isPlaying,
		playbackClock,
		getSourcePlayback,
		duration,
		timelinePlaybackRate: previewPlaybackRate,
		previewSourceAudioFallbackPaths,
		sourceAudioFallbackStartDelayMsByPath,
		sourceAudioResourceVersion: sourceAudioFallbackRefreshKey,
		getSourceTrackPreviewGain,
		onSourceFallbackLoadError,
	});

	return {
		sourceDurationSeconds: duration,
		onSourceAudioRangeDelete,
		sourceAudioFallbackPaths,
		sourceAudioSidecarPaths,
		sourceAudioFallbackStartDelayMsByPath,
		previewSourceAudioFallbackPaths,
		shouldMutePreviewVideo,
		getSourcePlayback,
		sourceAudioTrackMeta,
		selectedClipSourceAudioTrackSettings,
		playSourceAudioPreview,
		getSourceAudioTrackSettingsForClip,
		onSourceAudioTracksMetaChange,
		onSelectedClipSourceAudioTrackVolumeChange,
		onSelectedClipSourceAudioTrackNormalizeChange,
		embeddedTrackId,
		getSourceTrackPreviewGain,
	};
}
