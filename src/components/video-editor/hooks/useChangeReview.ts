import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "@/components/ui/toast";
import { useI18n } from "@/contexts/I18nContext";
import { MAX_CUT_REDO_NOTE_LENGTH, type ChangeConfidence, type ChangeLogEntry, type ChangeReview } from "../changeLog";
import { CUT_REVIEW_CONTEXT_MS, insertTimelineGap, projectChangeLogEntry, restoreClipSequence } from "../changeLogRestore";
import { packClipSequence } from "../clipSequence";
import type { useTimelineState } from "../state/useTimelineState";
import type { EditorEffectSection, WebcamOverlaySettings } from "../types";
import { getCutSeams } from "../videoPlayback/playbackStepping";
import type { PlaybackClock } from "../videoPlayback/playbackClock";
import { createWebcamVideoRegions } from "../videoTracks";
import type { useClipRegionCommands } from "./useClipRegionCommands";
import type { useEditorPlaybackControls } from "./useEditorPlaybackControls";

export const changeConfidencePriority: Record<ChangeConfidence, number> = { low: 0, medium: 1, high: 2 };

export function useChangeReview({
	timeline, sourceDurationMs, webcam, playbackClock, durationSeconds, isPlaying,
	applySequence, seek, startPlayback, pause, setActiveSection,
}: {
	timeline: ReturnType<typeof useTimelineState>;
	sourceDurationMs: number;
	webcam: WebcamOverlaySettings;
	playbackClock: PlaybackClock;
	durationSeconds: number;
	isPlaying: boolean;
	applySequence: ReturnType<typeof useClipRegionCommands>["applySequence"];
	seek: ReturnType<typeof useEditorPlaybackControls>["handleTimelineSeek"];
	startPlayback: ReturnType<typeof useEditorPlaybackControls>["startPlayback"];
	pause: ReturnType<typeof useEditorPlaybackControls>["pauseOnly"];
	setActiveSection: Dispatch<SetStateAction<EditorEffectSection>>;
}) {
	const { t } = useI18n();
	const [selected, setSelected] = useState<string | null>(null);
	const [auditionUntil, setAuditionUntil] = useState<number | null>(null);
	const { clipRegions, changeLog, setChangeLog } = timeline;
	const entries = useMemo(() => changeLog.entries.filter(entry => entry.source === "agent")
		.map(entry => ({ ...entry, timelineMs: projectChangeLogEntry(entry, clipRegions) }))
		.sort((left, right) => left.timelineMs - right.timelineMs),
	[changeLog.entries, clipRegions]);
	const current = entries.find(entry => entry.id === selected) ?? entries[0];
	const markers = useMemo(() => {
		const result = new Map<number, ChangeConfidence | "unknown">();
		const seams = new Set(getCutSeams(clipRegions).map(Math.round));
		for (const entry of entries) {
			if (entry.review === "restored" || !seams.has(entry.timelineMs)) continue;
			const next = entry.confidence ?? "unknown";
			const previous = result.get(entry.timelineMs);
			if (!previous || previous === "unknown" ||
				(next !== "unknown" && changeConfidencePriority[next] < changeConfidencePriority[previous])) {
				result.set(entry.timelineMs, next);
			}
		}
		return result;
	}, [clipRegions, entries]);

	function select(entry: ChangeLogEntry) {
		setSelected(entry.id);
		setAuditionUntil(null);
		seek(entry.timelineMs / 1000);
	}

	function goToEntry(direction: -1 | 1) {
		if (!entries.length) return;
		const previous = entries.findIndex(entry => entry.id === selected);
		const index = previous < 0 ? (direction > 0 ? 0 : entries.length - 1)
			: (previous + direction + entries.length) % entries.length;
		setActiveSection("review");
		select(entries[index]);
	}

	const updateReview = useCallback((id: string, review: ChangeReview) => {
		setChangeLog(log => ({ ...log, entries: log.entries.map(entry => entry.id === id ? { ...entry, review } : entry) }));
	}, [setChangeLog]);

	function setRedo(entry: ChangeLogEntry, note: string | null) {
		const redo = note === null ? undefined : {
			note: note.trim().slice(0, MAX_CUT_REDO_NOTE_LENGTH),
			markedAt: new Date().toISOString(),
		};
		setChangeLog(log => ({
			...log,
			entries: log.entries.map(current => current.id !== entry.id || current.review === "restored"
				? current
				: { ...current, review: redo ? "pending" : current.review, redo }),
		}));
	}

	function accept(entry = current) {
		if (!entry || entry.review === "restored" || entry.review === "accepted") return;
		setSelected(entry.id);
		updateReview(entry.id, "accepted");
	}

	function restore(entry = current) {
		if (!entry || entry.review === "restored") return;
		const id = `clip-${crypto.randomUUID()}`;
		const edited = restoreClipSequence(clipRegions, entry, () => id);
		const packed = packClipSequence(edited);
		const index = packed.findIndex(clip => clip.id === id);
		if (index < 0) return;
		const restored = packed[index];
		const left = packed[index - 1];
		setSelected(entry.id);
		setAuditionUntil(null);
		pause();
		applySequence(edited);
		timeline.setAutoCaptions(cues => insertTimelineGap(cues, restored.startMs, entry.durationMs));
		const camera = timeline.videoTracks.find(track => track.kind === "webcam" && !track.locked);
		if (camera) {
			const regions = createWebcamVideoRegions([restored], webcam, sourceDurationMs, camera.id);
			if (regions.length) timeline.setVideoRegions(current => [...current, ...regions]);
		}
		if (left) {
			timeline.setSourceAudioTrackSettingsByClip(settings => settings[left.id]
				? { ...settings, [id]: structuredClone(settings[left.id]) }
				: settings);
		}
		updateReview(entry.id, "restored");
		const hasBroll = timeline.videoTracks.some(track => track.kind === "video" &&
			timeline.videoRegions.some(region => region.trackId === track.id));
		const hasTimelineCaptions = timeline.autoCaptions.some(cue => cue.timeBasis === "timeline");
		toast.success(t(hasBroll || hasTimelineCaptions ? "common.interface.reviewRestoredWithGaps" : "common.interface.reviewRestored"));
	}

	function audition(entry = current) {
		if (!entry) return;
		const cut = entry.timelineMs / 1000;
		setSelected(entry.id);
		const contextSeconds = CUT_REVIEW_CONTEXT_MS / 1000;
		setAuditionUntil(Math.min(durationSeconds, cut + contextSeconds));
		seek(Math.max(0, cut - contextSeconds));
		startPlayback();
	}

	useEffect(() => {
		if (auditionUntil === null) return;
		if (!isPlaying) {
			setAuditionUntil(null);
			return;
		}
		const checkEnd = () => {
			if (playbackClock.getTime() < auditionUntil) return;
			pause();
			setAuditionUntil(null);
		};
		const unsubscribe = playbackClock.subscribe(checkEnd);
		checkEnd();
		return unsubscribe;
	}, [auditionUntil, playbackClock, isPlaying, pause]);

	return {
		entries, markers, current, selected: current?.id ?? null, auditioning: auditionUntil !== null,
		select, goToEntry, accept, restore, audition, setRedo,
	};
}
