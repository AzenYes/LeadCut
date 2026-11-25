import React, { useCallback, useMemo } from "react";
import {
	SOURCE_AUDIO_NORMALIZE_GAIN,
	type SourceAudioTrackSettings,
} from "@/components/video-editor/audio/audioTypes";
import { useSourceAudioTrackSettings } from "./useSourceAudioTrackSettings";
import type { SourceTrackId } from "@/lib/exporter/audioRoutingEngine";
import { isSourceAudioDeleted } from "./sourceAudioEdits";

interface UseClipAudioSettingsControllerParams {
	selectedClipId: string | null;
	sourceAudioTrackSettingsByClip: Record<string, SourceAudioTrackSettings>;
	setSourceAudioTrackSettingsByClip: React.Dispatch<
		React.SetStateAction<Record<string, SourceAudioTrackSettings>>
	>;
	defaultSourceAudioTrackSettings: SourceAudioTrackSettings;
	setDefaultSourceAudioTrackSettings: React.Dispatch<
		React.SetStateAction<SourceAudioTrackSettings>
	>;
}

export function useClipAudioSettingsController({
	selectedClipId,
	sourceAudioTrackSettingsByClip,
	setSourceAudioTrackSettingsByClip,
	defaultSourceAudioTrackSettings,
	setDefaultSourceAudioTrackSettings,
}: UseClipAudioSettingsControllerParams) {
	const {
		sourceAudioTrackMeta,
		selectedClipSourceAudioTrackSettings,
		getSourceAudioTrackSettingsForClip,
		onSourceAudioTracksMetaChange,
		onSelectedClipSourceAudioTrackVolumeChange,
		onSelectedClipSourceAudioTrackNormalizeChange,
		onSourceAudioRangeDelete,
	} = useSourceAudioTrackSettings({
		selectedClipId,
		sourceAudioTrackSettingsByClip,
		setSourceAudioTrackSettingsByClip,
		defaultSourceAudioTrackSettings,
		setDefaultSourceAudioTrackSettings,
	});

	const embeddedTrackId = useMemo<"mixed" | "system">(() => {
		const hasMixedTrack = sourceAudioTrackMeta.some((track) => track.id === "mixed");
		if (hasMixedTrack) return "mixed";
		const hasSystemTrack = sourceAudioTrackMeta.some((track) => track.id === "system");
		return hasSystemTrack ? "system" : "mixed";
	}, [sourceAudioTrackMeta]);

	const getSourceTrackPreviewGain = useCallback(
		(trackId: SourceTrackId, activeClipId: string | null, currentSourceTimeMs: number) => {
			const settings = (activeClipId
				? getSourceAudioTrackSettingsForClip(activeClipId)
				: selectedClipSourceAudioTrackSettings)[trackId] ?? {
				volume: 1,
				normalize: false,
			};
			const normalizeGain = settings.normalize ? SOURCE_AUDIO_NORMALIZE_GAIN : 1;
			if (isSourceAudioDeleted(settings, currentSourceTimeMs)) return 0;
			return Math.max(0, Math.min(1, settings.volume * normalizeGain));
		},
		[getSourceAudioTrackSettingsForClip, selectedClipSourceAudioTrackSettings],
	);

	return {
		onSourceAudioRangeDelete,
		sourceAudioTrackMeta,
		selectedClipSourceAudioTrackSettings,
		getSourceAudioTrackSettingsForClip,
		onSourceAudioTracksMetaChange,
		onSelectedClipSourceAudioTrackVolumeChange,
		onSelectedClipSourceAudioTrackNormalizeChange,
		embeddedTrackId,
		getSourceTrackPreviewGain,
	};
}
