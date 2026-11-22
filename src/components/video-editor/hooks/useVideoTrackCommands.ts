import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { toast } from "@/components/ui/toast";
import { getRenderableVideoUrl } from "@/lib/assetPath";
import type { useTimelineState } from "../state/useTimelineState";
import type { useAppearanceState } from "../state/useAppearanceState";
import { createWebcamVideoRegions, DEFAULT_WEBCAM_TRACK_ID, splitVideoRegion, trimVideoRegion, type VideoRegion, type VideoTrack } from "../videoTracks";

type Input = { timeline: ReturnType<typeof useTimelineState>; appearance: ReturnType<typeof useAppearanceState>; sourceDuration: number; currentTime: number };

export function useVideoTrackCommands({ timeline, appearance, sourceDuration, currentTime }: Input) {
	const { t } = useI18n();
	const [importing, setImporting] = useState(false);
	useEffect(() => {
		const sourcePath = appearance.webcam.sourcePath;
		if (!sourcePath || sourceDuration <= 0 || timeline.clipRegions.length === 0 || timeline.videoTracks.some((track) => track.kind === "webcam")) return;
		const track: VideoTrack = { id: DEFAULT_WEBCAM_TRACK_ID, name: t("editor.tracks.webcam", "Webcam"), kind: "webcam" };
		timeline.setVideoTracks((tracks) => tracks.some((track) => track.kind === "webcam") ? tracks : [...tracks, track]);
		const regions = createWebcamVideoRegions(timeline.clipRegions, appearance.webcam, sourceDuration * 1000, track.id);
		if (regions.length) timeline.setVideoRegions((current) => [...current, ...regions]);
	}, [appearance.webcam, sourceDuration, timeline.videoTracks, timeline.clipRegions, timeline.setVideoTracks, timeline.setVideoRegions, t]);

	const addTrack = useCallback(() => {
		const track = { id: `video-track-${crypto.randomUUID()}`, name: `${t("editor.tracks.video", "Video")} ${timeline.videoTracks.length + 2}`, kind: "video" as const };
		timeline.setVideoTracks((current) => [...current, track]);
		return track.id;
	}, [timeline.videoTracks.length, timeline.setVideoTracks, t]);
	const select = useCallback((id: string | null) => {
		timeline.setSelectedVideoId(id);
		timeline.setSelectedRegionIds(id ? [id] : []);
		timeline.setSelectedClipId(null); timeline.setSelectedZoomId(null); timeline.setSelectedAudioId(null); timeline.setSelectedAnnotationId(null); timeline.setSelectedCaptionId(null);
	}, [timeline.setSelectedVideoId, timeline.setSelectedRegionIds, timeline.setSelectedClipId, timeline.setSelectedZoomId, timeline.setSelectedAudioId, timeline.setSelectedAnnotationId, timeline.setSelectedCaptionId]);
	const importVideo = useCallback(async (targetTrackId?: string) => {
		if (importing) return;
		setImporting(true);
		try {
			const picked = await window.electronAPI.openVideoFilePicker();
			if (picked.canceled || !picked.success || !picked.path) return;
			const sourcePath = picked.path;
			const video = document.createElement("video");
			video.preload = "metadata";
			video.src = await getRenderableVideoUrl(sourcePath);
			let sourceDurationMs: number;
			try {
				sourceDurationMs = await new Promise<number>((resolve, reject) => {
					const timeout = setTimeout(() => reject(new Error(t("editor.tracks.loadTimeout", "Media metadata timed out"))), 15000);
					video.onloadedmetadata = () => { clearTimeout(timeout); resolve(video.duration * 1000); };
					video.onerror = () => { clearTimeout(timeout); reject(new Error(t("editor.tracks.loadFailed", "Could not read this video"))); };
				});
			} finally { video.removeAttribute("src"); video.load(); }
			if (!(sourceDurationMs > 0) || !Number.isFinite(sourceDurationMs)) throw new Error(t("editor.tracks.invalidDuration", "Video duration is invalid"));
			const metadata = await window.electronAPI.probeNativeVideoMetadata?.(sourcePath).catch(() => undefined);
			const startMs = Math.max(0, Math.round(currentTime * 1000));
			const available = timeline.videoTracks.find((track) => !track.locked && !timeline.videoRegions.some((region) => region.trackId === track.id && region.startMs < startMs + sourceDurationMs && region.endMs > startMs));
			const trackId = targetTrackId ?? available?.id ?? addTrack();
			if (timeline.videoTracks.find((track) => track.id === trackId)?.locked || timeline.videoRegions.some((region) => region.trackId === trackId && region.startMs < startMs + sourceDurationMs && region.endMs > startMs)) throw new Error(t("editor.tracks.occupied", "This track is locked or the selected interval is occupied."));
			const region: VideoRegion = { id: `video-${crypto.randomUUID()}`, kind: "video", trackId, sourcePath, sourceDurationMs, hasAudio: metadata?.metadata?.hasAudio, sourceStartMs: 0, startMs, endMs: startMs + sourceDurationMs, speed: 1, volume: 1, fit: "cover" };
			timeline.setVideoRegions((current) => [...current, region]);
			select(region.id);
		} catch (error) { toast.error(String(error instanceof Error ? error.message : error)); }
		finally { setImporting(false); }
	}, [importing, currentTime, addTrack, timeline.videoTracks, timeline.videoRegions, timeline.setVideoRegions, select, t]);
	const changeSpan = useCallback((id: string, span: { start: number; end: number }, trackId?: string) => {
		timeline.setVideoRegions((current) => current.map((region) => {
			if (region.id !== id || timeline.videoTracks.find((track) => track.id === region.trackId)?.locked || timeline.videoTracks.find((track) => track.id === trackId)?.locked) return region;
			return { ...trimVideoRegion(region, span.start, span.end), kind: region.kind ?? timeline.videoTracks.find((track) => track.id === region.trackId)?.kind, trackId: trackId ?? region.trackId };
		}));
	}, [timeline.setVideoRegions, timeline.videoTracks]);
	const split = useCallback((atMs: number) => {
		timeline.setVideoRegions((current) => current.flatMap((region) => {
			if (timeline.videoTracks.find((track) => track.id === region.trackId)?.locked) return [region];
			if (timeline.selectedVideoId && region.id !== timeline.selectedVideoId) return [region];
			return splitVideoRegion(region, atMs, () => `video-${crypto.randomUUID()}`);
		}));
	}, [timeline.setVideoRegions, timeline.videoTracks, timeline.selectedVideoId]);
	return { addTrack, importVideo, importing, select, changeSpan, split };
}
