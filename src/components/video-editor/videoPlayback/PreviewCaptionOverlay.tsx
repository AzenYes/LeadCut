import { chapterCaptionSettings } from "@/lib/exporter/chapterRenderer";
import { getSquircleSvgPath } from "@/lib/geometry/squircle";
import { uiText } from "@/i18n/uiText";
import type { createObservableValue } from "@/lib/observableValue";
import {
	memo,
	type Ref,
	type RefObject,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { type CaptionEditTarget, normalizeCaptionEditText } from "../captionEditing";
import {
	canWindowCaptionLayout,
	findPreviewCaptionCueIndex,
	getActiveCaptionLayout,
	getPreviewCaptionCues,
	prepareCaptionLayout,
	prepareCaptionTiming,
} from "../captionLayout";
import {
	CAPTION_LINE_HEIGHT,
	type CaptionPosition,
	getCaptionAnchor,
	getCaptionFontStack,
	getCaptionFontWeight,
	getCaptionPadding,
	getCaptionPreviewTextStyle,
	getCaptionScaledFontSize,
	getCaptionScaledRadius,
	getCaptionTextMaxWidth,
	getCaptionWordVisualState,
} from "../captionStyle";
import { getCaptionTimeMs } from "../captionTimeline";
import type { ChapterProgress } from "../chapterProgress";
import { CAPTION_FONT_SIZE_MAX, CAPTION_FONT_SIZE_MIN, type AutoCaptionSettings, type CaptionCue } from "../types";
import { premeasureCaptionWidths } from "./captionWidthPrefetch";
import { useCaptionPositionDrag } from "./useCaptionPositionDrag";

type CaptionEditSession = {
	target: CaptionEditTarget;
	draft: string;
};

export type CaptionFontSizeDraft = Pick<ReturnType<typeof createObservableValue<number | null>>, "get" | "subscribe">;

export type PreviewCaptionOverlayRef = { cancelEdit: () => void };

type Props = {
	ref: Ref<PreviewCaptionOverlayRef>;
	previewFrameRef: RefObject<HTMLDivElement | null>;
	autoCaptions: CaptionCue[];
	settings?: AutoCaptionSettings;
	fontSizeDraft?: CaptionFontSizeDraft;
	chapterProgress?: ChapterProgress;
	currentTime: number;
	timelineTime: number;
	isGap: boolean;
	onPause: () => void;
	onEditAutoCaption?: (target: CaptionEditTarget, text: string) => void;
	onSelectAutoCaption?: (id: string) => void;
	onCaptionPositionChange?: (position: CaptionPosition) => void;
};

const noDraft = { get: () => null, subscribe: () => () => undefined };
const MIN_TEXTS_TO_PREMEASURE = 128;
const MAX_PREMEASURED_TEXT_WIDTHS = 240_000;

export const PreviewCaptionOverlay = memo(function PreviewCaptionOverlay({
	ref,
	previewFrameRef,
	autoCaptions,
	settings,
	fontSizeDraft = noDraft,
	chapterProgress,
	currentTime,
	timelineTime,
	isGap,
	onPause,
	onEditAutoCaption,
	onSelectAutoCaption,
	onCaptionPositionChange,
}: Props) {
	const draftSize = useSyncExternalStore(fontSizeDraft.subscribe, fontSizeDraft.get);
	const autoCaptionSettings = useMemo(() => settings && draftSize !== null && settings.fontSize !== draftSize
		? { ...settings, fontSize: draftSize }
		: settings, [settings, draftSize]);
	const captionBoxRef = useRef<HTMLDivElement | null>(null);
	const captionMeasurementRef = useRef<CanvasRenderingContext2D | null>(null);
	const captionBoxSizeRef = useRef<{ width: number; height: number } | null>(null);
	const captionRadiusRef = useRef(0);
	const captionEditInputRef = useRef<HTMLTextAreaElement | null>(null);
	const captionEditSessionRef = useRef<CaptionEditSession | null>(null);
	const [captionEditSession, setCaptionEditSession] = useState<CaptionEditSession | null>(
		null,
	);
	const captionDrag = useCaptionPositionDrag({
		frameRef: previewFrameRef,
		settings: autoCaptionSettings,
		chapters: chapterProgress,
		editing: Boolean(captionEditSession),
		onCommit: onCaptionPositionChange,
	});
	const [captionFrame, setCaptionFrame] = useState({ width: 640, height: 360 });
	useLayoutEffect(() => {
		const frame = previewFrameRef.current;
		if (!frame) return;
		const updateSize = (width: number, height: number) => {
			if (width <= 0 || height <= 0) return;
			setCaptionFrame(current => current.width === width && current.height === height
				? current
				: { width, height });
		};
		updateSize(frame.clientWidth, frame.clientHeight);
		const observer = new ResizeObserver(([entry]) => {
			updateSize(Math.round(entry.contentRect.width), Math.round(entry.contentRect.height));
		});
		observer.observe(frame);
		return () => observer.disconnect();
	}, []);
	const { width: captionFrameWidth, height: captionFrameHeight } = captionFrame;
	const captionPosition = captionDrag.offset ?? chapterCaptionSettings(
		autoCaptionSettings, chapterProgress, captionFrameWidth, captionFrameHeight,
	);
	const captionAnchor = captionPosition
		? getCaptionAnchor(captionPosition, captionFrameWidth, captionFrameHeight, 0)
		: null;
	const overlayWidth = captionFrameWidth;
	const captionsEnabled = autoCaptionSettings?.enabled ?? false;
	const captionFontSize = autoCaptionSettings?.fontSize ?? 0;
	const captionMaxWidth = autoCaptionSettings?.maxWidth ?? 0;
	const captionMaxRows = autoCaptionSettings?.maxRows ?? 1;
	const captionFontWeight = autoCaptionSettings ? getCaptionFontWeight(autoCaptionSettings) : "";
	const captionFontStack = autoCaptionSettings ? getCaptionFontStack(autoCaptionSettings) : "";
	const previewCaptionFontSize = getCaptionScaledFontSize(captionFontSize, overlayWidth, captionMaxWidth);
	const previewCaptionPadding = getCaptionPadding(previewCaptionFontSize);
	const previewCaptionRadius = getCaptionScaledRadius(autoCaptionSettings?.boxRadius ?? 0, previewCaptionFontSize);
	const previewCaptionTextStyle = autoCaptionSettings
		? getCaptionPreviewTextStyle(autoCaptionSettings, previewCaptionFontSize)
		: undefined;
	const captionTimeMs = getCaptionTimeMs(autoCaptions, Math.round(currentTime * 1000), Math.round(timelineTime * 1000));
	const windowedCaptionLayout = useMemo(() => autoCaptions.length > 3 && canWindowCaptionLayout(autoCaptions), [autoCaptions]);
	const nearbyCaptionIndex = captionsEnabled && captionMaxRows === 1 && windowedCaptionLayout
		? findPreviewCaptionCueIndex(autoCaptions, captionTimeMs) : -1;
	const previewCues = useMemo(() => getPreviewCaptionCues(autoCaptions, nearbyCaptionIndex), [autoCaptions, nearbyCaptionIndex]);
	const captionTiming = useMemo(
		() => captionsEnabled && previewCues.length > 0 ? prepareCaptionTiming(previewCues) : null,
		[captionsEnabled, previewCues],
	);
	const captionWidthCache = useMemo(() => {
		const texts = captionTiming?.measurement.texts;
		if (captionMaxRows <= 1 || !texts || texts.length < MIN_TEXTS_TO_PREMEASURE) return null;
		const sizes = [...new Set(Array.from({ length: CAPTION_FONT_SIZE_MAX - CAPTION_FONT_SIZE_MIN + 1 },
			(_, index) => getCaptionScaledFontSize(index + CAPTION_FONT_SIZE_MIN, overlayWidth, captionMaxWidth)))];
		if (sizes.length * texts.length > MAX_PREMEASURED_TEXT_WIDTHS) return null;
		return {
			texts,
			sizes,
			font: (size: number) => `${captionFontWeight} ${size}px ${captionFontStack}`,
			widths: new Map<number, Float64Array>(),
		};
	}, [captionTiming, captionMaxRows, captionFontWeight, captionFontStack, overlayWidth, captionMaxWidth]);
	useEffect(() => captionWidthCache ? premeasureCaptionWidths(captionWidthCache) : undefined, [captionWidthCache]);
	const captionLayout = useMemo(() => {
		if (!captionTiming || typeof document === "undefined") {
			return null;
		}

		const maxTextWidthPx = getCaptionTextMaxWidth(
			overlayWidth,
			captionMaxWidth,
			previewCaptionFontSize,
		);
		captionMeasurementRef.current ??= document.createElement("canvas").getContext("2d");
		const measurementContext = captionMeasurementRef.current;
		if (!measurementContext) {
			return null;
		}

		measurementContext.font = `${captionFontWeight} ${previewCaptionFontSize}px ${captionFontStack}`;

		return prepareCaptionLayout({
			cues: previewCues,
			settings: { maxRows: captionMaxRows },
			maxWidthPx: maxTextWidthPx,
			measureText: text => measurementContext.measureText(text).width,
			measuredWidths: document.fonts?.status === "loaded"
				? captionWidthCache?.widths.get(previewCaptionFontSize)
				: undefined,
		}, captionTiming);
	}, [captionTiming, previewCaptionFontSize, captionMaxWidth, captionMaxRows, captionFontWeight, captionFontStack, previewCues, overlayWidth, captionWidthCache]);
	const activeCaptionLayout = useMemo(() => autoCaptionSettings
		? getActiveCaptionLayout(captionLayout, {
			cues: previewCues,
			settings: autoCaptionSettings,
			timeMs: captionTimeMs,
		}) : null, [captionLayout, previewCues, autoCaptionSettings, captionTimeMs]);
	const isCaptionEditing = captionEditSession !== null;
	const captionEditDraft = captionEditSession?.draft ?? "";
	const captionEditTargetId = captionEditSession?.target.id ?? null;
	const captionEditTextMetrics = useMemo(() => {
		if (!captionEditSession || !autoCaptionSettings || typeof document === "undefined") {
			return null;
		}

		const fontSize = previewCaptionFontSize;
		const maxTextWidthPx = getCaptionTextMaxWidth(
			overlayWidth,
			autoCaptionSettings.maxWidth,
			fontSize,
		);
		captionMeasurementRef.current ??= document.createElement("canvas").getContext("2d");
		const measurementContext = captionMeasurementRef.current;
		if (!measurementContext) {
			return null;
		}

		measurementContext.font = `${getCaptionFontWeight(autoCaptionSettings)} ${fontSize}px ${getCaptionFontStack(autoCaptionSettings)}`;
		const measuredWidth = Math.max(
			...captionEditSession.draft
				.split(/\r?\n/)
				.map((line) => measurementContext.measureText(line || " ").width),
		);

		return {
			fontSize,
			maxTextWidthPx,
			widthPx: Math.ceil(
				Math.min(maxTextWidthPx, Math.max(fontSize * 2, measuredWidth + 2)),
			),
		};
	}, [autoCaptionSettings, captionEditSession, previewCaptionFontSize, overlayWidth]);
	const captionEditSizeKey = captionEditSession
		? `${captionEditTextMetrics?.widthPx ?? 0}:${captionEditDraft}`
		: "";

	const beginCaptionEdit = useCallback(() => {
		if (!activeCaptionLayout?.editTarget || !onEditAutoCaption) {
			return;
		}

		onPause();
		const nextSession = {
			target: activeCaptionLayout.editTarget,
			draft: activeCaptionLayout.editTarget.text,
		};
		captionEditSessionRef.current = nextSession;
		setCaptionEditSession(nextSession);
	}, [activeCaptionLayout, onEditAutoCaption, onPause]);

	const commitCaptionEdit = useCallback(() => {
		const session = captionEditSessionRef.current;
		if (!session || !onEditAutoCaption) {
			captionEditSessionRef.current = null;
			setCaptionEditSession(null);
			return;
		}

		const normalizedDraft = normalizeCaptionEditText(session.draft);
		captionEditSessionRef.current = null;
		if (!normalizedDraft) {
			setCaptionEditSession(null);
			return;
		}

		if (normalizedDraft !== normalizeCaptionEditText(session.target.text)) {
			onEditAutoCaption(session.target, session.draft);
		}
		setCaptionEditSession(null);
	}, [onEditAutoCaption]);

	const cancelCaptionEdit = useCallback(() => {
		captionEditSessionRef.current = null;
		setCaptionEditSession(null);
	}, []);

	useLayoutEffect(() => {
		if (!captionEditTargetId) {
			return;
		}

		const input = captionEditInputRef.current;
		if (!input) return;
		input.focus();
		const end = input.value.length;
		input.setSelectionRange(end, end);
	}, [captionEditTargetId]);

	useEffect(() => {
		if (!captionEditSizeKey) {
			return;
		}

		const frame = requestAnimationFrame(() => {
			const input = captionEditInputRef.current;
			if (!input) {
				return;
			}

			input.style.height = "auto";
			input.style.height = `${input.scrollHeight}px`;
		});

		return () => cancelAnimationFrame(frame);
	}, [captionEditSizeKey]);

	const updateCaptionClipPath = useCallback(() => {
		const box = captionBoxRef.current;
		const size = captionBoxSizeRef.current;
		if (!box || !size || size.width <= 0 || size.height <= 0) return;
		const path = getSquircleSvgPath({ x: 0, y: 0, ...size, radius: captionRadiusRef.current });
		box.style.clipPath = `path('${path}')`;
	}, []);
	useLayoutEffect(() => {
		captionRadiusRef.current = previewCaptionRadius;
		updateCaptionClipPath();
	}, [previewCaptionRadius, updateCaptionClipPath]);
	const canShowCaption = !isGap || autoCaptions[0]?.timeBasis === "timeline";
	const showCaptionBox = Boolean(canShowCaption &&
		activeCaptionLayout && autoCaptionSettings && captionAnchor);
	useLayoutEffect(() => {
		const box = captionBoxRef.current;
		if (!showCaptionBox || !box) return;
		const observer = new ResizeObserver(([entry]) => {
			const size = entry.borderBoxSize[0];
			captionBoxSizeRef.current = size
				? { width: Math.round(size.inlineSize), height: Math.round(size.blockSize) }
				: { width: box.offsetWidth, height: box.offsetHeight };
			updateCaptionClipPath();
		});
		observer.observe(box, { box: "border-box" });
		return () => {
			observer.disconnect();
			captionBoxSizeRef.current = null;
		};
	}, [showCaptionBox, updateCaptionClipPath]);

	useImperativeHandle(ref, () => ({ cancelEdit: cancelCaptionEdit }), [cancelCaptionEdit]);

	return (
		<>
			{captionDrag.offset && (
				<div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10">
					<div className="absolute inset-y-0 left-1/2 border-l border-dashed border-white/80" />
					<div className="absolute inset-x-0 bottom-[5%] border-t border-dashed border-white/80" />
				</div>
			)}
			{canShowCaption && activeCaptionLayout && autoCaptionSettings && captionAnchor ? (
				<div
					className="absolute inset-x-0 flex justify-center"
					style={{
						zIndex: 2,
						bottom: captionFrameHeight - captionAnchor.centerY,
						transform: `translateX(${captionAnchor.centerX - captionFrameWidth / 2}px)`,
						pointerEvents: "none",
					}}
				>
					<div
						style={{
							maxWidth: `${autoCaptionSettings.maxWidth}%`,
							opacity: activeCaptionLayout.opacity,
							transform: `translateY(${activeCaptionLayout.translateY}px) scale(${activeCaptionLayout.scale})`,
							transformOrigin: "center center",
						}}
					>
						<div
							ref={captionBoxRef}
							className="focus-visible:outline-2 focus-visible:outline-accent"
							role={
								onEditAutoCaption && !isCaptionEditing
									? "button"
									: undefined
							}
							tabIndex={
								onEditAutoCaption && !isCaptionEditing ? 0 : undefined
							}
							aria-label={
								onEditAutoCaption && !isCaptionEditing
									? uiText("editCurrentCaption")
									: undefined
							}
							onClick={(event) => {
								event.stopPropagation();
								const id = activeCaptionLayout.cue.id;
								if (id && !isCaptionEditing && !captionDrag.offset) onSelectAutoCaption?.(id);
							}}
							onDoubleClick={(event) => {
								event.stopPropagation();
								if (!isCaptionEditing) {
									beginCaptionEdit();
								}
							}}
							{...captionDrag.pointerHandlers}
							onKeyDown={(event) => {
								if (!onEditAutoCaption || isCaptionEditing) {
									return;
								}

								if (event.key === "Enter" || event.key === " ") {
									event.preventDefault();
									beginCaptionEdit();
								}
							}}
							style={{
								backgroundColor: `rgba(0, 0, 0, ${autoCaptionSettings.backgroundOpacity})`,
								fontFamily: captionFontStack,
								fontSize: `${previewCaptionFontSize}px`,
								lineHeight: CAPTION_LINE_HEIGHT,
								textAlign: "center",
								fontWeight: captionFontWeight,
								padding: `${previewCaptionPadding.y}px ${previewCaptionPadding.x}px`,
								borderRadius: `${previewCaptionRadius}px`,
								boxSizing: "border-box",
								cursor: onCaptionPositionChange && !isCaptionEditing
									? captionDrag.offset ? "grabbing" : "grab"
									: onEditAutoCaption ? "text" : undefined,
								touchAction: onCaptionPositionChange && !isCaptionEditing ? "none" : undefined,
								pointerEvents: onEditAutoCaption || onCaptionPositionChange ? "auto" : undefined,
							}}
						>
							{captionEditSession ? (
								<textarea
									ref={captionEditInputRef}
									value={captionEditSession.draft}
									onChange={(event) => {
										const draft = event.target.value;
										setCaptionEditSession((session) => {
											const nextSession = session
												? { ...session, draft }
												: session;
											captionEditSessionRef.current = nextSession;
											return nextSession;
										});
									}}
									onBlur={commitCaptionEdit}
									onClick={(event) => event.stopPropagation()}
									onKeyDown={(event) => {
										if (event.key === "Escape") {
											event.preventDefault();
											cancelCaptionEdit();
											return;
										}

										if (event.key === "Enter" && !event.shiftKey) {
											event.preventDefault();
											event.currentTarget.blur();
										}
									}}
									rows={Math.max(
										1,
										activeCaptionLayout.visibleLines.length,
									)}
									aria-label={uiText("editCurrentCaption")}
									style={{
										display: "block",
										width: `${
											captionEditTextMetrics?.widthPx ??
											Math.max(
												48,
												activeCaptionLayout.visibleLines.reduce(
													(width, line) =>
														Math.max(width, line.width),
													0,
												),
											)
										}px`,
										maxWidth: `${
											captionEditTextMetrics?.maxTextWidthPx ??
											getCaptionTextMaxWidth(
											overlayWidth,
												autoCaptionSettings.maxWidth,
											previewCaptionFontSize,
											)
										}px`,
										minHeight: `${
											Math.max(
												1,
												activeCaptionLayout.visibleLines.length,
											) *
											(
												captionEditTextMetrics?.fontSize ??
											previewCaptionFontSize
											) *
											CAPTION_LINE_HEIGHT
										}px`,
										resize: "none",
										border: "0",
										outline: "0",
										padding: "0",
										margin: "0",
										overflow: "hidden",
										background: "transparent",
										color: autoCaptionSettings.textColor,
										font: "inherit",
										lineHeight: "inherit",
										textAlign: "center",
									}}
								/>
							) : (
								activeCaptionLayout.visibleLines.map((line) => (
									<div
										key={`${activeCaptionLayout.blockKey}-${line.words[0]?.cueId}-${line.words[0]?.cueWordIndex}`}
										style={{
											display: "flex",
											justifyContent: "center",
											flexWrap: "nowrap",
											whiteSpace: "nowrap",
										}}
									>
										{line.words.map((word) => {
											const visualState =
												getCaptionWordVisualState(
													activeCaptionLayout.hasWordTimings,
													word.state,
												);

											return (
												<span
															key={`${activeCaptionLayout.blockKey}-${word.cueId}-${word.cueWordIndex}`}
													style={{
														display: "inline-block",
														whiteSpace: "pre",
														color: visualState.isInactive
															? autoCaptionSettings.inactiveTextColor
															: autoCaptionSettings.textColor,
													opacity: visualState.opacity,
													...previewCaptionTextStyle,
													}}
												>
													{`${word.leadingSpace ? " " : ""}${word.text}`}
												</span>
											);
										})}
									</div>
								))
							)}
						</div>
					</div>
				</div>
			) : null}
		</>
	);
});
