import type { Span } from "dnd-timeline";
import { type Dispatch, type RefObject, type SetStateAction, useCallback } from "react";
import { editCaptionCueText } from "../captionEditing";
import {
	addCue,
	type CaptionRetimeSpan,
	createCaptionCue,
	deleteCue,
	retimeCue,
} from "../captionOps";
import { captionSpanToSource } from "../captionTimeline";
import {
	type AutoCaptionSettings,
	type CaptionCue,
	type ClipRegion,
	type EditorEffectSection,
	findClipAtTimelineTime,
} from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";

interface UseCaptionCommandsParams {
	clipRegions: ClipRegion[];
	autoCaptions: CaptionCue[];
	setAutoCaptions: Dispatch<SetStateAction<CaptionCue[]>>;
	setAutoCaptionSettings: Dispatch<SetStateAction<AutoCaptionSettings>>;
	setSelectedCaptionId: Dispatch<SetStateAction<string | null>>;
	setSelectedZoomId: Dispatch<SetStateAction<string | null>>;
	setSelectedClipId: Dispatch<SetStateAction<string | null>>;
	setSelectedAnnotationId: Dispatch<SetStateAction<string | null>>;
	setSelectedAudioId: Dispatch<SetStateAction<string | null>>;
	setActiveEffectSection: Dispatch<SetStateAction<EditorEffectSection>>;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	mapSourceTimeToTimelineTime: (timeMs: number) => number;
	handleSeek: (time: number, options?: { pause?: boolean }) => void;
}

export function useCaptionCommands({
	clipRegions,
	autoCaptions,
	setAutoCaptions,
	setAutoCaptionSettings,
	setSelectedCaptionId,
	setSelectedZoomId,
	setSelectedClipId,
	setSelectedAnnotationId,
	setSelectedAudioId,
	setActiveEffectSection,
	videoPlaybackRef,
	mapSourceTimeToTimelineTime,
	handleSeek,
}: UseCaptionCommandsParams) {
	const handleSelectCaption = useCallback(
		(id: string | null, timelineTimeMs?: number, options?: { seek?: boolean }) => {
			setSelectedCaptionId(id);
			if (!id) return;
			setActiveEffectSection("captionList");
			setSelectedZoomId(null);
			setSelectedClipId(null);
			setSelectedAnnotationId(null);
			setSelectedAudioId(null);
			if (options?.seek === false) return;
			const cue = autoCaptions.find((value) => value.id === id);
			const timeMs = timelineTimeMs ?? (cue && (cue.timeBasis === "timeline" ? cue.startMs : mapSourceTimeToTimelineTime(cue.startMs)));
			if (timeMs !== undefined) handleSeek(timeMs / 1000, { pause: true });
		},
		[
			autoCaptions,
			handleSeek,
			mapSourceTimeToTimelineTime,
			setActiveEffectSection,
			setSelectedAnnotationId,
			setSelectedAudioId,
			setSelectedCaptionId,
			setSelectedClipId,
			setSelectedZoomId,
		],
	);

	const handleCaptionTextEdit = useCallback(
		(id: string, text: string) => {
			setAutoCaptions((captions) => {
				const cue = captions.find((value) => value.id === id);
				if (!cue) return captions;
				const edited = editCaptionCueText(cue, text);
				return edited === cue ? captions : captions.map(value => value.id === id ? edited : value);
			});
		},
		[setAutoCaptions],
	);

	const cancelEdit = useCallback(
		() => videoPlaybackRef.current?.cancelCaptionEdit(),
		[videoPlaybackRef],
	);
	const handleCaptionRetime = useCallback(
		(id: string, span: CaptionRetimeSpan) => {
			cancelEdit();
			setAutoCaptions((captions) => retimeCue(captions, id, span));
		},
		[cancelEdit, setAutoCaptions],
	);
	const handleCaptionDelete = useCallback(
		(id: string) => {
			cancelEdit();
			setSelectedCaptionId((current) => (current === id ? null : current));
			setAutoCaptions((captions) => deleteCue(captions, id));
		},
		[cancelEdit, setAutoCaptions, setSelectedCaptionId],
	);

	const handleCaptionAdded = useCallback(
		(span: Span) => {
			const clip = findClipAtTimelineTime(span.start, clipRegions);
			if (!clip) return;
			cancelEdit();
			const newCue = createCaptionCue(captionSpanToSource(clip, span));
			if (autoCaptions[0]?.timeBasis === "timeline") {
				newCue.timeBasis = "timeline";
				newCue.startMs = span.start;
				newCue.endMs = span.end;
			}
			setAutoCaptions((captions) => addCue(captions, newCue));
			setSelectedCaptionId(newCue.id);
			setActiveEffectSection("captionList");
			setSelectedZoomId(null);
			setSelectedClipId(null);
			setSelectedAnnotationId(null);
			setSelectedAudioId(null);
			handleSeek(span.start / 1000, { pause: true });
		},
		[
			cancelEdit,
			handleSeek,
			clipRegions,
			autoCaptions,
			setActiveEffectSection,
			setAutoCaptions,
			setSelectedAnnotationId,
			setSelectedAudioId,
			setSelectedCaptionId,
			setSelectedClipId,
			setSelectedZoomId,
		],
	);

	const handleClearAutoCaptions = useCallback(() => {
		setAutoCaptions([]);
		setAutoCaptionSettings((current) => ({ ...current, enabled: false }));
	}, [setAutoCaptionSettings, setAutoCaptions]);

	return {
		handleSelectCaption,
		handleCaptionTextEdit,
		handleCaptionRetime,
		handleCaptionDelete,
		handleCaptionAdded,
		handleClearAutoCaptions,
	};
}
