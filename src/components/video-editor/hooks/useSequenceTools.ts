import { useCallback, useEffect, useMemo, useState } from "react";
import { splitVideoRegion } from "../videoTracks";
import { projectCaptionCues } from "../captionTimeline";
import { mergeEditRanges, planRippleDelete, splitTimelineCaptions, timelineRangesToSourceRanges, type EditRange } from "../sequenceEdits";
import type { ChangeLogEntry } from "../changeLog";
import type { useTimelineState } from "../state/useTimelineState";
import type { useClipRegionCommands } from "./useClipRegionCommands";
import type { useVideoTrackCommands } from "./useVideoTrackCommands";

export function useSequenceTools({ timeline, clipCommands, getCurrentTime }: {
	timeline: ReturnType<typeof useTimelineState>;
	clipCommands: ReturnType<typeof useClipRegionCommands>;
	videoCommands: ReturnType<typeof useVideoTrackCommands>;
	getCurrentTime: () => number;
}) {
	const [forwardSelectionActive, setForwardSelectionActive] = useState(false);
	const singleSelection = timeline.selectedVideoId ?? timeline.selectedClipId ?? timeline.selectedAudioId ?? timeline.selectedAnnotationId ?? timeline.selectedZoomId ?? timeline.selectedCaptionId;
	const {
		selectedRegionIds, autoCaptions, clipRegions, videoRegions, videoTracks, audioRegions,
		annotationRegions, zoomRegions, setSelectedRegionIds, setAutoCaptions, setVideoRegions,
		setAudioRegions, setAnnotationRegions, setZoomRegions,
	} = timeline;
	const { handleClipSplit } = clipCommands;
	const selected = useMemo(
		() => selectedRegionIds.length ? selectedRegionIds : singleSelection ? [singleSelection] : [],
		[selectedRegionIds, singleSelection],
	);
	const clearSelection = useCallback(() => {
		timeline.setSelectedClipId(null); timeline.setSelectedVideoId(null); timeline.setSelectedAudioId(null); timeline.setSelectedAnnotationId(null); timeline.setSelectedZoomId(null); timeline.setSelectedCaptionId(null); timeline.setSelectedRegionIds([]);
	}, [timeline.setSelectedClipId, timeline.setSelectedVideoId, timeline.setSelectedAudioId, timeline.setSelectedAnnotationId, timeline.setSelectedZoomId, timeline.setSelectedCaptionId, timeline.setSelectedRegionIds]);
	useEffect(() => {
		const id = timeline.selectedClipId ?? timeline.selectedAudioId ?? timeline.selectedAnnotationId ?? timeline.selectedZoomId ?? timeline.selectedCaptionId;
		if (id) { timeline.setSelectedVideoId(null); timeline.setSelectedRegionIds([id]); }
	}, [timeline.selectedClipId, timeline.selectedAudioId, timeline.selectedAnnotationId, timeline.selectedZoomId, timeline.selectedCaptionId, timeline.setSelectedVideoId, timeline.setSelectedRegionIds]);
	const selectRegions = useCallback((ids: string[]) => {
		clearSelection();
		const captions = projectCaptionCues(autoCaptions, clipRegions);
		const locked = new Set(videoRegions
			.filter(region => videoTracks.find(track => track.id === region.trackId)?.locked)
			.map(region => region.id));
		const sourceIds = ids.filter(id => !locked.has(id))
			.map(id => captions.find(cue => cue.id === id)?.sourceCueId ?? id);
		setSelectedRegionIds([...new Set(sourceIds)]);
	}, [clearSelection, autoCaptions, clipRegions, videoRegions, videoTracks, setSelectedRegionIds]);
	const selectForward = useCallback((atMs: number) => {
		const unlockedVideos = videoRegions.filter(region => !videoTracks.find(track => track.id === region.trackId)?.locked);
		const regions = [...clipRegions, ...unlockedVideos, ...audioRegions, ...annotationRegions, ...zoomRegions];
		clearSelection();
		const captions = projectCaptionCues(autoCaptions, clipRegions).filter((region) => region.endMs > atMs);
		setSelectedRegionIds([
			...regions.filter(region => region.endMs > atMs).map(region => region.id),
			...captions.flatMap(cue => [cue.id, cue.sourceCueId]),
		]);
		setForwardSelectionActive(false);
	}, [clipRegions, videoRegions, videoTracks, audioRegions, annotationRegions, zoomRegions, clearSelection, autoCaptions, setSelectedRegionIds]);
	const split = useCallback(() => {
		const atMs = Math.round(getCurrentTime() * 1000);
		const ids = new Set(selected);
		const cutsPrimary = clipRegions.some((region) => (!ids.size || ids.has(region.id)) && region.startMs < atMs && region.endMs > atMs);
		const includes = (id: string) => cutsPrimary || ids.size === 0 || ids.has(id);
		setAutoCaptions((current) => splitTimelineCaptions(current, clipRegions, atMs, cutsPrimary ? undefined : ids));
		if (clipRegions.some((region) => includes(region.id) && region.startMs < atMs && region.endMs > atMs)) handleClipSplit(atMs);
		setVideoRegions((current) => current.flatMap((region) => !includes(region.id) || videoTracks.find((track) => track.id === region.trackId)?.locked ? [region] : splitVideoRegion(region, atMs, () => `video-${crypto.randomUUID()}`)));
		setAudioRegions((current) => current.flatMap((region) => !includes(region.id) || atMs <= region.startMs || atMs >= region.endMs ? [region] : [{ ...region, endMs: atMs }, { ...region, id: `audio-${crypto.randomUUID()}`, startMs: atMs, sourceStartMs: (region.sourceStartMs ?? 0) + (atMs - region.startMs) * (region.speed ?? 1) }]));
		setAnnotationRegions((current) => current.flatMap((region) => !includes(region.id) || atMs <= region.startMs || atMs >= region.endMs ? [region] : [{ ...region, endMs: atMs }, { ...region, id: `annotation-${crypto.randomUUID()}`, startMs: atMs }]));
		setZoomRegions((current) => current.flatMap((region) => !includes(region.id) || atMs <= region.startMs || atMs >= region.endMs ? [region] : [{ ...region, endMs: atMs }, { ...region, id: `zoom-${crypto.randomUUID()}`, startMs: atMs }]));
	}, [getCurrentTime, selected, clipRegions, setAutoCaptions, handleClipSplit, videoTracks, setVideoRegions,
		setAudioRegions, setAnnotationRegions, setZoomRegions]);
	const rippleDeleteRanges = useCallback((selection: EditRange[], reason?: string) => {
		const ranges = mergeEditRanges(selection);
		if (!ranges.length) return false;
		const plan = planRippleDelete(timeline, ranges);
		const sourceRanges = timelineRangesToSourceRanges(ranges, timeline.clipRegions);
		if (sourceRanges.length) {
			const batchId = crypto.randomUUID();
			const createdAt = new Date().toISOString();
			const entries: ChangeLogEntry[] = sourceRanges.map(({ timelineStartMs, timelineEndMs: _end, ...source }) => {
				const removedBefore = ranges.reduce((sum, range) =>
					sum + Math.max(0, Math.min(timelineStartMs, range.endMs) - range.startMs), 0);
				const timelineMs = Math.round(timelineStartMs - removedBefore);
				const afterClipId = plan.clipRegions.find(clip => Math.round(clip.startMs) >= timelineMs)?.id;
				return {
					...source, id: crypto.randomUUID(), source: "manual", kind: "cut", batchId, createdAt,
					timelineMs, ...(afterClipId ? { afterClipId } : {}), ...(reason ? { reason } : {}), review: "pending",
				};
			});
			timeline.setChangeLog(current => ({ ...current, entries: [...current.entries, ...entries] }));
		}
		timeline.setClipRegions(plan.clipRegions);
		timeline.setSourceAudioTrackSettingsByClip(plan.sourceAudioTrackSettingsByClip);
		timeline.setVideoRegions(plan.videoRegions);
		timeline.setAudioRegions(plan.audioRegions);
		timeline.setAnnotationRegions(plan.annotationRegions);
		timeline.setZoomRegions(plan.zoomRegions);
		timeline.setAutoCaptions(plan.autoCaptions);
		clearSelection();
		return true;
	}, [timeline, clearSelection]);
	const rippleDelete = useCallback(() => {
		const ids = new Set(selected);
		if (!ids.size) return;
		const primary = timeline.clipRegions.filter(region => ids.has(region.id));
		const locked = new Set(timeline.videoTracks.filter(track => track.locked).map(track => track.id));
		const captions = projectCaptionCues(timeline.autoCaptions, timeline.clipRegions);
		// Primary selections define the cut interval, even if a linked caption spans it.
		rippleDeleteRanges(primary.length ? primary : [
			...timeline.videoRegions.filter(region => !locked.has(region.trackId)),
			...timeline.audioRegions, ...timeline.annotationRegions, ...timeline.zoomRegions, ...captions,
		].filter(region => ids.has(region.id) || ("sourceCueId" in region && ids.has(region.sourceCueId as string))));
	}, [selected, timeline, rippleDeleteRanges]);
	// Delete/Backspace edit the selection. Ripple delete removes time across tracks.
	const deleteSelection = useCallback(() => {
		const ids = new Set(selected);
		if (!ids.size) return;
		const primary = timeline.clipRegions.filter((region) => ids.has(region.id));
		const removedVideos = timeline.videoRegions.filter((region) => ids.has(region.id) && !timeline.videoTracks.find((track) => track.id === region.trackId)?.locked);
		const videoIds = new Set(removedVideos.map((region) => region.id));
		timeline.setVideoRegions((current) => current.filter((region) => !videoIds.has(region.id)).map((region) => {
			if (primary.length) return region;
			const shift = removedVideos.filter((removed) => removed.trackId === region.trackId && removed.endMs <= region.startMs).reduce((sum, removed) => sum + removed.endMs - removed.startMs, 0);
			return { ...region, startMs: region.startMs - shift, endMs: region.endMs - shift };
		}));
		timeline.setAudioRegions((current) => {
			const removed = current.filter((region) => ids.has(region.id));
			return current.filter((region) => !ids.has(region.id)).map((region) => {
				if (primary.length) return region;
				const shift = removed.filter((removed) => (removed.trackIndex ?? 0) === (region.trackIndex ?? 0) && removed.endMs <= region.startMs).reduce((sum, removed) => sum + removed.endMs - removed.startMs, 0);
				return { ...region, startMs: region.startMs - shift, endMs: region.endMs - shift };
			});
		});
		timeline.setAnnotationRegions((current) => current.filter((region) => !ids.has(region.id)));
		timeline.setZoomRegions((current) => current.filter((region) => !ids.has(region.id)));
		timeline.setAutoCaptions((current) => current.filter((region) => !ids.has(region.id)));
		if (primary.length) clipCommands.applySequence(timeline.clipRegions.filter((region) => !ids.has(region.id)));
		clearSelection();
	}, [timeline, selected, clipCommands, clearSelection]);
	const deleteGroupedSelection = useCallback(() => {
		if (!timeline.selectedVideoId && timeline.selectedRegionIds.length <= 1 &&
			(singleSelection || !timeline.selectedRegionIds.length)) return false;
		deleteSelection();
		return true;
	}, [timeline.selectedVideoId, timeline.selectedRegionIds.length, singleSelection, deleteSelection]);
	const clearForwardSelection = () => {
		setForwardSelectionActive(false);
		timeline.setSelectedRegionIds([]);
	};
	return { split, rippleDelete, rippleDeleteRanges, deleteGroupedSelection, selectRegions, selectForward,
		forwardSelectionActive, setForwardSelectionActive, clearForwardSelection, hasSelection: selected.length > 0 };
}
