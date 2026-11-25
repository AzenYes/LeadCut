import { emptyChapterProgress, type ChapterProgress } from "../chapterProgress";
import { emptyChangeLog, type ChangeLog } from "../changeLog";
import { useState } from "react";
import { createObservableValue } from "@/lib/observableValue";
import type { VideoRegion, VideoTrack } from "../videoTracks";
import type { SourceAudioTrackSettings } from "../audio/audioTypes";
import type { ProjectTranscript } from "../transcript";
import { useRecordingKeystrokes } from "../keystrokes/useRecordingKeystrokes";
import type {
	AnnotationRegion,
	AudioRegion,
	AutoCaptionSettings,
	CaptionCue,
	ClipRegion,
	CursorTelemetryPoint,
	KeystrokeOverlaySettings,
	SpeedRegion,
	TimelineMarker,
	TrimRegion,
	ZoomRegion,
} from "../types";
import { DEFAULT_AUTO_CAPTION_SETTINGS, DEFAULT_KEYSTROKE_OVERLAY } from "../types";

export function useTimelineState(videoSourcePath: string | null = null) {
	const [chapterProgress, setChapterProgress] = useState<ChapterProgress>(emptyChapterProgress);
	const [keystrokeOverlay, setKeystrokeOverlay] = useState<KeystrokeOverlaySettings>(DEFAULT_KEYSTROKE_OVERLAY);
	const [markers, setMarkers] = useState<TimelineMarker[]>([]);
	const [transcript, setTranscript] = useState<ProjectTranscript | null>(null);
	const [changeLog, setChangeLog] = useState<ChangeLog>(emptyChangeLog);
	const [videoTracks, setVideoTracks] = useState<VideoTrack[]>([]);
	const [videoRegions, setVideoRegions] = useState<VideoRegion[]>([]);
	const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
	const [selectedRegionIds, setSelectedRegionIds] = useState<string[]>([]);
	const [zoomRegions, setZoomRegions] = useState<ZoomRegion[]>([]);
	const [cursorTelemetry, setCursorTelemetry] = useState<CursorTelemetryPoint[]>([]);
	const [cursorTelemetrySourcePath, setCursorTelemetrySourcePath] = useState<string | null>(null);
	const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);
	const [trimRegions, setTrimRegions] = useState<TrimRegion[]>([]);
	const [clipRegions, setClipRegions] = useState<ClipRegion[]>([]);
	const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
	const [speedRegions, setSpeedRegions] = useState<SpeedRegion[]>([]);
	const [annotationRegions, setAnnotationRegions] = useState<AnnotationRegion[]>([]);
	const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
	const [audioRegions, setAudioRegions] = useState<AudioRegion[]>([]);
	const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
	const [selectedCaptionId, setSelectedCaptionId] = useState<string | null>(null);
	const [sourceAudioTrackSettingsByClip, setSourceAudioTrackSettingsByClip] = useState<
		Record<string, SourceAudioTrackSettings>
	>({});
	const [defaultSourceAudioTrackSettings, setDefaultSourceAudioTrackSettings] =
		useState<SourceAudioTrackSettings>({});
	const [sourceAudioFallbackRefreshKey, setSourceAudioFallbackRefreshKey] = useState(0);
	const [hasClipSourceAudio, setHasClipSourceAudio] = useState(false);
	const [autoCaptions, setAutoCaptions] = useState<CaptionCue[]>([]);
	const [captionFontSizeDraft] = useState(() => createObservableValue<number | null>(null));
	const [autoCaptionSettings, setAutoCaptionSettings] = useState<AutoCaptionSettings>(
		DEFAULT_AUTO_CAPTION_SETTINGS,
	);
	const recordedKeystrokes = useRecordingKeystrokes(videoSourcePath, clipRegions, keystrokeOverlay);

	return {
		chapterProgress, setChapterProgress,
		keystrokeOverlay, setKeystrokeOverlay,
		recordedKeystrokes,
		markers, setMarkers,
		transcript, setTranscript,
		changeLog, setChangeLog,
		videoTracks, setVideoTracks, videoRegions, setVideoRegions,
		selectedVideoId, setSelectedVideoId, selectedRegionIds, setSelectedRegionIds,
		zoomRegions,
		setZoomRegions,
		cursorTelemetry,
		setCursorTelemetry,
		cursorTelemetrySourcePath,
		setCursorTelemetrySourcePath,
		selectedZoomId,
		setSelectedZoomId,
		trimRegions,
		setTrimRegions,
		clipRegions,
		setClipRegions,
		selectedClipId,
		setSelectedClipId,
		speedRegions,
		setSpeedRegions,
		annotationRegions,
		setAnnotationRegions,
		selectedAnnotationId,
		setSelectedAnnotationId,
		audioRegions,
		setAudioRegions,
		selectedAudioId,
		setSelectedAudioId,
		selectedCaptionId,
		setSelectedCaptionId,
		sourceAudioTrackSettingsByClip,
		setSourceAudioTrackSettingsByClip,
		defaultSourceAudioTrackSettings,
		setDefaultSourceAudioTrackSettings,
		sourceAudioFallbackRefreshKey,
		setSourceAudioFallbackRefreshKey,
		hasClipSourceAudio,
		setHasClipSourceAudio,
		autoCaptions,
		setAutoCaptions,
		autoCaptionSettings,
		captionFontSizeDraft,
		setAutoCaptionSettings,
	};
}
