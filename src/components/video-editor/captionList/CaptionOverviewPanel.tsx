import { Tooltip } from "@heroui/react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type Dispatch, type KeyboardEvent, type MouseEvent, type ReactNode, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowCounterClockwise, ArrowsMerge, DotsThree, MagnifyingGlass, Play, Scissors, Trash } from "@/components/ui/icons";
import { toast } from "@/components/ui/toast";
import { useI18n } from "@/contexts/I18nContext";
import { useUiText } from "@/i18n/useUiText";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import { CAPTION_PAUSE_ON_TYPING_STORAGE_KEY, CAPTION_SKIP_RIPPLE_CONFIRM_STORAGE_KEY } from "@/lib/storageKeys";
import { editCaptionCueText, normalizeCaptionEditText } from "../captionEditing";
import { captionTextOffsetAtTime, deleteCue, joinCaptionText, mergeProjectedCaptionCues, splitCueAtTextOffset, type CaptionRetimeSpan } from "../captionOps";
import { retimeCaptionFragment } from "../captionTimeline";
import type { CaptionIssueKind } from "../captionQuality";
import { getCaptionWordCutRange, mergeEditRanges, type EditRange } from "../sequenceEdits";
import { formatTimelineTimecode, parseTimelineTimecode } from "../timeline/core/time";
import type { AutoCaptionSettings, CaptionCue, ClipRegion } from "../types";
import type { PlaybackClock } from "../videoPlayback/playbackClock";
import { captionRowOffsets, captionWindowRange, findActiveRowIndex, formatCaptionTime, groupCaptionRows, type CaptionFragment, type CaptionTranscriptRow } from "./captionListModel";
import { captionTextMatcher, findCaptionTextMatches, replaceInCaptions, type CaptionTextMatch } from "./captionSearch";
import { CaptionQualityControls, CaptionQualityRuleSettings } from "./CaptionQualityControls";
import { CaptionRippleDeleteDialog } from "./CaptionRippleDeleteDialog";
import { useCaptionQuality } from "./useCaptionQuality";

type Row = CaptionTranscriptRow;
type Edit = { id: string; field: "text" | "start" | "end"; draft: string; original: string; offset?: number };
type Selection = { anchor: string; focus: string };
export type CaptionPanelMemory = {
	scrollTop: number;
	query: string;
	searchOpen?: boolean;
	onlyIssues: boolean;
	issueSnapshot?: ReadonlySet<string>;
	following: boolean;
	selection: Selection | null;
};
type PendingCut = { ranges: EditRange[]; count: number; words: boolean };
type Props = {
	emptyActions?: ReactNode;
	rows: CaptionFragment[];
	appearance: AutoCaptionSettings;
	durationMs: number;
	cues: CaptionCue[];
	clips: ClipRegion[];
	getPlayheadTime: () => number;
	playbackClock: PlaybackClock;
	isPlaying: boolean;
	selectedCueId: string | null;
	onSelect: (id: string | null, timelineTimeMs?: number, options?: { seek?: boolean }) => void;
	onPlayFrom: (seconds: number) => void;
	onPlayRange: (start: number, end: number) => void;
	onTogglePlay: () => void;
	onPause: () => void;
	onTextEdit: (id: string, text: string) => void;
	onRetime: (id: string, span: CaptionRetimeSpan) => void;
	setCues: Dispatch<SetStateAction<CaptionCue[]>>;
	onRippleDelete: (ranges: EditRange[], reason: string) => boolean;
	memory: CaptionPanelMemory;
};

const timeClass = "text-left font-mono text-[11px] tabular-nums text-muted-foreground";
const inputClass = "min-w-0 w-full rounded border border-accent bg-background px-1 py-1 text-xs text-foreground";
const rowKey = (index: number) => `caption-overview-row-${index}`;

function textOffsetAtClick(event: MouseEvent<HTMLButtonElement>) {
	const element = event.currentTarget;
	const range = element.ownerDocument.caretRangeFromPoint?.(event.clientX, event.clientY);
	if (!range || !element.contains(range.startContainer)) return element.textContent?.length ?? 0;
	const prefix = element.ownerDocument.createRange();
	prefix.selectNodeContents(element);
	prefix.setEnd(range.startContainer, range.startOffset);
	return prefix.toString().length;
}

function isAtOuterTextLine(input: HTMLTextAreaElement, direction: "previous" | "next") {
	const offset = input.selectionStart;
	if (offset !== input.selectionEnd) return false;
	if (direction === "previous" && offset === 0 || direction === "next" && offset === input.value.length) return true;
	const doc = input.ownerDocument;
	const mirror = doc.createElement("div");
	const style = doc.defaultView?.getComputedStyle(input);
	if (!style) return false;
	Object.assign(mirror.style, {
		position: "fixed", visibility: "hidden", top: "0", left: "0",
		boxSizing: "border-box", width: style.width, padding: style.padding, border: style.border,
		font: style.font, letterSpacing: style.letterSpacing, whiteSpace: "pre-wrap", overflowWrap: "break-word",
	});
	const content = doc.createTextNode(`${input.value}\u200b`);
	mirror.append(content);
	doc.body.append(mirror);
	const lineAt = (position: number) => {
		const range = doc.createRange();
		range.setStart(content, position);
		range.setEnd(content, position + 1);
		return range.getBoundingClientRect().top;
	};
	const outerOffset = direction === "previous" ? 0 : input.value.length;
	const sameLine = Math.abs(lineAt(offset) - lineAt(outerOffset)) < 1;
	mirror.remove();
	return sameLine;
}

type RowAction = "split" | "merge" | "delete" | "start" | "end" | "ripple";

function CaptionRowActionButton({ icon: Icon, label, onClick }: {
	icon: typeof Play;
	label: string;
	onClick: () => void;
}) {
	return (
		<Tooltip delay={350} closeDelay={0}>
			<Button size="icon" variant="ghost" className="size-8 min-w-8 shrink-0" aria-label={label} onClick={onClick}>
				<Icon aria-hidden="true" />
			</Button>
			<Tooltip.Content placement="top" className="pointer-events-none">{label}</Tooltip.Content>
		</Tooltip>
	);
}

const NO_MATCHES: CaptionTextMatch[] = [];
function highlightMatches(value: string, matches: CaptionTextMatch[], activeMatch: number | undefined) {
	let offset = 0;
	const parts = matches.map(match => {
		const prefix = value.slice(offset, match.index);
		offset = match.index + match.length;
		return <span key={match.index}>{prefix}<mark data-caption-search-match
			className={activeMatch === match.index ? "rounded bg-accent text-accent-foreground" : "rounded bg-warning/30 text-inherit"}>
			{value.slice(match.index, offset)}
		</mark></span>;
	});
	return <>{parts}{value.slice(offset)}</>;
}

const CaptionOverviewRow = memo(function CaptionOverviewRow({
	row, index, active, selected, edit, select, beginEdit, changeDraft, commit, cancel, issues, wraps, deleteWords,
	compositionChanged,
	onPlayback, onTextKey, onAction, multiSelected, actionRow, resolved, matches, activeMatch,
}: {
	row: Row;
	index: number;
	active: boolean;
	selected: boolean;
	edit: Edit | null;
	select: (index: number, extend: boolean) => void;
	beginEdit: (index: number, field: Edit["field"], offset?: number) => void;
	changeDraft: (value: string) => void;
	commit: (edit: Edit) => void;
	cancel: () => void;
	issues?: CaptionIssueKind[];
	wraps: boolean;
	deleteWords: (row: Row, start: number, end: number) => boolean;
	compositionChanged: (active: boolean) => void;
	onPlayback: (row: Row, mode: "from" | "range" | "toggle") => void;
	onTextKey: (event: KeyboardEvent<HTMLTextAreaElement>, edit: Edit, row: Row) => boolean;
	onAction: (row: Row, action: RowAction) => void;
	multiSelected: boolean;
	actionRow: boolean;
	resolved: boolean;
	matches: CaptionTextMatch[];
	activeMatch?: number;
}) {
	const { t } = useI18n();
	const uiText = useUiText();
	const issueDescription = issues?.map(issue =>
		uiText(issue === "tooWide" && wraps ? "captionQualityTooWideWrap" : `captionQuality_${issue}`),
	).join(" · ");
	const textarea = useRef<HTMLTextAreaElement>(null);
	const rowActionsLabel = t("common.interface.captionOverviewRowOptions");
	const editingText = edit?.field === "text";
	const startingOffset = edit?.offset;
	useLayoutEffect(() => {
		if (!editingText || !textarea.current) return;
		const input = textarea.current;
		input.focus({ preventScroll: true });
		const offset = Math.min(input.value.length, startingOffset ?? input.value.length);
		input.setSelectionRange(offset, offset);
	}, [editingText, startingOffset]);
	const handleEdit = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>, value: Edit) => {
		if (event.nativeEvent.isComposing) return;
		if (value.field === "text" && ((event.key === "Tab" && !event.shiftKey) ||
			(event.key === "Enter" && (event.ctrlKey || event.metaKey)))) {
			event.preventDefault();
			event.stopPropagation();
			onPlayback(row, event.key === "Tab" ? "range" : "toggle");
			return;
		}
		if (
			event.key === "Delete" && event.shiftKey && value.field === "text" && value.draft === row.text &&
			deleteWords(row, event.currentTarget.selectionStart ?? 0, event.currentTarget.selectionEnd ?? 0)
		) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (value.field === "text" && onTextKey(event as KeyboardEvent<HTMLTextAreaElement>, value, row)) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (event.key !== "Enter" && event.key !== "Escape") return;
		event.preventDefault();
		event.stopPropagation();
		if (event.key === "Escape") {
			if (value.field === "text") commit(value);
			cancel();
		}
		else if (value.field === "text") return;
		else commit(value);
	};
	const timeField = (field: "start" | "end", timeMs: number) => {
		const label = t(`common.interface.captionOverviewTime${field === "start" ? "Start" : "End"}`);
		if (row.fragments.length > 1) return <span>{formatCaptionTime(timeMs)}</span>;
		return edit?.field === field
			? <input type="text" aria-label={label} autoFocus placeholder="1:02.500"
				value={edit.draft} onChange={event => changeDraft(event.target.value)}
				onKeyDown={event => handleEdit(event, edit)} onBlur={() => commit(edit)} onClick={event => event.stopPropagation()} className={inputClass} />
			: <button type="button" tabIndex={selected ? 0 : -1} className={`${timeClass} rounded hover:bg-foreground/10`}
				aria-label={`${label} ${formatTimelineTimecode(timeMs)}`}
				onClick={event => select(index, event.shiftKey)}
				onDoubleClick={event => { event.stopPropagation(); beginEdit(index, field); }}>{formatCaptionTime(timeMs)}</button>;
	};
	return (
		<div
			role="row"
			id={rowKey(index)}
			aria-rowindex={index + 1}
			aria-selected={selected}
			data-active={active || undefined}
			data-caption-overview-row={index + 1}
			data-caption-id={row.id}
			data-start-ms={row.startMs}
			data-end-ms={row.endMs}
			data-issue={issues?.join(" ")}
			className={`border-b border-separator/60 px-2 py-1.5 [content-visibility:auto] [contain-intrinsic-size:auto_64px]
				${selected ? "bg-accent/15" : ""} ${active ? "border-l-2 border-l-accent bg-accent/10" : ""}`}
		>
			<div role="gridcell" className="min-w-0">
				<div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
					<button type="button" tabIndex={-1} aria-label={t("common.interface.captionOverviewPlayFrom")}
						title={t("common.interface.captionOverviewPlayFrom")} className="rounded px-1 text-xs text-accent hover:bg-foreground/10"
						onClick={() => onPlayback(row, "from")}>▶</button>
					<button type="button" tabIndex={-1} onClick={event => select(index, event.shiftKey)}
						className="rounded px-1 text-xs tabular-nums text-muted-foreground hover:bg-foreground/10">
						{row.number}
					</button>
					<div className={`flex items-center gap-1 ${timeClass}`}>
						{timeField("start", row.startMs)}
						<span aria-hidden="true">→</span>
						{timeField("end", row.endMs)}
						<span aria-hidden="true">·</span>
						<span title={formatTimelineTimecode(row.endMs - row.startMs)}>{((row.endMs - row.startMs) / 1000).toFixed(1)}s</span>
					</div>
					{row.fragments.length > 1 && (
						<span title={t("common.interface.captionOverviewAcrossCutsHint")} className="text-[11px] text-muted-foreground">
							{t("common.interface.captionOverviewAcrossCuts")}
						</span>
					)}
					{issueDescription && <span className="ml-auto text-[11px] text-warning">{issueDescription}</span>}
					{resolved && <span className="ml-auto text-[11px] text-muted-foreground">{t("common.interface.captionOverviewResolved")}</span>}
				</div>
				{edit?.field === "text" ? (
					<textarea ref={textarea} rows={1} aria-label={t("common.interface.captionOverviewEditText")}
						value={edit.draft} onChange={event => changeDraft(event.target.value)}
						onCompositionStart={() => compositionChanged(true)} onCompositionEnd={() => compositionChanged(false)}
						onBlur={() => commit(edit)} onKeyDown={event => handleEdit(event, edit)}
						className="block w-full resize-none rounded border border-accent bg-background px-1 py-1 text-sm leading-5 [field-sizing:content]" />
				) : <button type="button" tabIndex={-1} data-caption-text
					className="block w-full whitespace-pre-wrap break-words rounded border border-transparent px-1 py-1 text-left text-sm leading-5 hover:bg-foreground/5"
					onClick={event => event.shiftKey ? select(index, true) : beginEdit(index, "text", textOffsetAtClick(event))}>
					{matches.length ? highlightMatches(row.text, matches, activeMatch) : row.text || " "}
				</button>}
				{actionRow && <div role="group" aria-label={rowActionsLabel} className="mt-0.5 flex flex-wrap items-center gap-1">
					<CaptionRowActionButton icon={Play} label={t("common.interface.captionOverviewPlayFrom")}
						onClick={() => onPlayback(row, "from")} />
					<CaptionRowActionButton icon={ArrowCounterClockwise} label={t("common.interface.captionOverviewRelisten")}
						onClick={() => onPlayback(row, "range")} />
					<CaptionRowActionButton icon={Scissors} label={t("common.interface.captionOverviewSplitPlayhead")}
						onClick={() => onAction(row, "split")} />
					<CaptionRowActionButton icon={ArrowsMerge} label={t(`common.interface.captionOverview${multiSelected ? "Merge" : "MergeNext"}`)}
						onClick={() => onAction(row, "merge")} />
					<CaptionRowActionButton icon={Trash} label={t(`common.interface.captionOverview${multiSelected ? "DeleteSelected" : "Delete"}`)}
						onClick={() => onAction(row, "delete")} />
					<details className="group">
						<Tooltip delay={350} closeDelay={0}>
							<Tooltip.Trigger<"summary"> render={props => <summary {...props} />} aria-label={rowActionsLabel}
								className="flex size-8 cursor-pointer list-none items-center justify-center rounded-lg hover:bg-foreground/10">
								<DotsThree className="size-4" aria-hidden="true" />
							</Tooltip.Trigger>
							<Tooltip.Content placement="top" className="pointer-events-none">{rowActionsLabel}</Tooltip.Content>
						</Tooltip>
						<div className="flex flex-wrap gap-1 rounded border border-separator bg-popover p-1">
							<Button size="sm" variant="ghost" title="Alt+[" aria-label={t("common.interface.captionOverviewStartAtPlayhead")}
								disabled={row.fragments.length > 1} onClick={() => onAction(row, "start")}>{t("common.interface.captionOverviewStartAtPlayhead")}</Button>
							<Button size="sm" variant="ghost" title="Alt+]" aria-label={t("common.interface.captionOverviewEndAtPlayhead")}
								disabled={row.fragments.length > 1} onClick={() => onAction(row, "end")}>{t("common.interface.captionOverviewEndAtPlayhead")}</Button>
							<Button size="sm" variant="ghost" title="Shift+Delete" aria-label={uiText("captionRippleDeleteAction")}
								onClick={() => onAction(row, "ripple")}>{uiText("captionRippleDeleteAction")}</Button>
						</div>
					</details>
				</div>}
			</div>
		</div>
	);
});

export const CaptionOverviewPanel = memo(function CaptionOverviewPanel({
	rows: fragments, appearance, durationMs, cues, clips, getPlayheadTime, playbackClock, isPlaying, selectedCueId, onSelect, onTextEdit, onRetime,
	onPlayFrom, onPlayRange, onTogglePlay, onPause, setCues, onRippleDelete, memory, emptyActions,
}: Props) {
	const { t } = useI18n();
	const uiText = useUiText();
	const text = (key: string, count?: number) => t(`common.interface.captionOverview${key}`, undefined, count === undefined ? undefined : { count });
	const grid = useRef<HTMLDivElement>(null);
	const allRows = useMemo(() => groupCaptionRows(fragments), [fragments]);
	const [scrollTop, setScrollTop] = useState(memory.scrollTop);
	const [viewportHeight, setViewportHeight] = useState(440);
	const measuredRows = useRef(new Map<string, number>());
	const measuredWidth = useRef(0);
	const [measurements, setMeasurements] = useState(0);
	const [following, setFollowing] = useState(memory.following);
	const [pauseOnTyping, setPauseOnTyping] = useState(() => loadAppSetting(CAPTION_PAUSE_ON_TYPING_STORAGE_KEY) !== false);
	const playingRef = useRef(isPlaying);
	playingRef.current = isPlaying;
	const [onlyIssues, setOnlyIssues] = useState(memory.onlyIssues);
	const [issueSnapshot, setIssueSnapshot] = useState<ReadonlySet<string>>(() => memory.issueSnapshot ?? new Set());
	const [skipRippleConfirm, setSkipRippleConfirm] = useState(() => loadAppSetting(CAPTION_SKIP_RIPPLE_CONFIRM_STORAGE_KEY) === true);
	const [pendingCut, setPendingCut] = useState<PendingCut | null>(null);
	const { issues, rules, updateRules } = useCaptionQuality(allRows, appearance);
	const rows = useMemo(() => onlyIssues ? allRows.filter(row => issues.has(row.id) || issueSnapshot.has(row.id)) : allRows,
		[allRows, issues, issueSnapshot, onlyIssues]);
	const filterIssues = (filtered: boolean) => {
		setIssueSnapshot(new Set(filtered ? issues.keys() : []));
		setOnlyIssues(filtered);
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: measurement revisions invalidate the prefix sums.
	const offsets = useMemo(() => captionRowOffsets(rows, measuredRows.current), [rows, measurements]);
	const { start, end } = captionWindowRange(offsets, scrollTop, viewportHeight);
	const [selection, setSelection] = useState<Selection | null>(() => {
		const id = rows.find(row => row.sourceCueId === selectedCueId)?.id;
		return id ? { anchor: id, focus: id } : memory.selection;
	});
	const [edit, setEdit] = useState<Edit | null>(null);
	const editRef = useRef<Edit | null>(null);
	const pendingCaret = useRef<{ id: string; offset: number } | null>(null);
	const [composing, setComposing] = useState(false);
	const hasEditableWords = edit?.field === "text" && rows.some(row =>
		row.id === edit.id && row.text === edit.draft && row.sourceCue.words?.length,
	);
	const [query, setQuery] = useState(memory.query);
	const [searchOpen, setSearchOpen] = useState(memory.searchOpen ?? false);
	const searchField = useRef<HTMLInputElement>(null);
	const focusSearch = useRef(false);
	const [matchIndex, setMatchIndex] = useState(0);
	const [replacement, setReplacement] = useState("");
	const [caseSensitive, setCaseSensitive] = useState(false);
	const [replacementCount, setReplacementCount] = useState<number | null>(null);
	const [pendingReplacementCount, setPendingReplacementCount] = useState(0);
	const indices = useMemo(() => new Map(rows.map((row, index) => [row.id, index])), [rows]);
	const activeIndex = useSyncExternalStore(playbackClock.subscribe,
		() => findActiveRowIndex(fragments, playbackClock.getTime() * 1000));
	const activeFragment = fragments[activeIndex];
	const visibleActiveIndex = activeFragment ? indices.get(activeFragment.sourceCueId) ?? -1 : -1;
	const issueIndices = useMemo(() => rows.flatMap((row, index) => issues.has(row.id) ? [index] : []), [issues, rows]);
	const focus = selection ? indices.get(selection.focus) ?? -1 : -1;
	const anchor = selection ? indices.get(selection.anchor) ?? focus : focus;
	const firstSelected = Math.min(anchor, focus);
	const lastSelected = Math.max(anchor, focus);
	const selectedIds = useMemo(() => firstSelected < 0 ? [] :
		rows.slice(firstSelected, lastSelected + 1).map(row => row.sourceCueId),
	[rows, firstSelected, lastSelected]);
	const scope = useMemo(() => new Set(rows.map(row => row.sourceCueId)), [rows]);
	const rowMatches = useMemo(() => {
		const pattern = captionTextMatcher(query, caseSensitive);
		return pattern && searchOpen ? rows.map(row => findCaptionTextMatches(row.text, pattern)) : [];
	}, [rows, query, caseSensitive, searchOpen]);
	const matches = useMemo(() => rowMatches.flatMap((matches, row) =>
		matches.map(match => ({ row, offset: match.index }))), [rowMatches]);
	const currentMatch = Math.min(matchIndex, Math.max(0, matches.length - 1));
	const activeMatch = matches[currentMatch];
	useLayoutEffect(() => {
		if (searchOpen && focusSearch.current) {
			focusSearch.current = false;
			searchField.current?.focus();
		}
	}, [searchOpen]);
	useLayoutEffect(() => {
		const element = grid.current;
		if (element) element.scrollTop = memory.scrollTop;
	}, [memory]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new row window replaces the observed elements.
	useLayoutEffect(() => {
		const element = grid.current;
		if (!element) return;
		const observer = new ResizeObserver(entries => {
			let changed = false;
			const width = element.clientWidth;
			if (width !== measuredWidth.current) {
				if (measuredWidth.current) measuredRows.current.clear();
				measuredWidth.current = width;
				changed = true;
			}
			for (const entry of entries) {
				if (entry.target === element) {
					setViewportHeight(element.clientHeight);
				} else {
					const row = entry.target as HTMLElement;
					const height = row.getBoundingClientRect().height;
					const id = row.dataset.captionId;
					if (id && height && measuredRows.current.get(id) !== height) {
						measuredRows.current.set(id, height);
						changed = true;
					}
				}
			}
			if (changed) setMeasurements(value => value + 1);
		});
		observer.observe(element);
		element.querySelectorAll("[data-caption-id]").forEach(row => observer.observe(row));
		return () => observer.disconnect();
	}, [start, end, rows]);
	useEffect(() => {
		memory.selection = selection;
		memory.query = query;
		memory.onlyIssues = onlyIssues;
		memory.issueSnapshot = issueSnapshot;
		memory.searchOpen = searchOpen;
		memory.following = following;
	}, [memory, selection, query, onlyIssues, issueSnapshot, searchOpen, following]);

	const reveal = useCallback((index: number, follow = false) => {
		const element = grid.current;
		if (!element || index < 0) return;
		const top = offsets[index];
		const bottom = offsets[index + 1];
		if (follow) element.scrollTop = top - element.clientHeight / 3;
		else if (top < element.scrollTop) element.scrollTop = top;
		else if (bottom > element.scrollTop + element.clientHeight) element.scrollTop = bottom - element.clientHeight;
		setScrollTop(element.scrollTop);
	}, [offsets]);
	useEffect(() => {
		if (following && !edit && isPlaying) reveal(visibleActiveIndex, true);
	}, [visibleActiveIndex, following, edit, isPlaying, reveal]);
	const observedSelection = useRef(memory.selection?.focus ?? null);
	useLayoutEffect(() => {
		if (observedSelection.current === selectedCueId) return;
		observedSelection.current = selectedCueId;
		if (selectedCueId === null) return;
		const index = indices.get(selectedCueId);
		if (index === undefined) return;
		if (selection?.focus !== selectedCueId) setSelection({ anchor: selectedCueId, focus: selectedCueId });
		reveal(index);
	}, [selectedCueId, selection, indices, reveal]);

	const updateEdit = useCallback((value: Edit | null) => {
		editRef.current = value;
		setEdit(value);
	}, []);
	const saveText = useCallback((value: Edit | null) => {
		if (value?.field !== "text" || value.draft === value.original) return;
		const normalized = normalizeCaptionEditText(value.draft);
		if (normalized) onTextEdit(value.id, normalized);
	}, [onTextEdit]);
	const flushDraft = useRef(saveText);
	flushDraft.current = saveText;
	useEffect(() => {
		const flush = () => flushDraft.current(editRef.current);
		window.addEventListener("blur", flush);
		return () => {
			window.removeEventListener("blur", flush);
			flush();
		};
	}, []);
	useEffect(() => {
		if (edit?.field !== "text" || composing) return;
		const timer = window.setTimeout(() => saveText(edit), 1000);
		return () => window.clearTimeout(timer);
	}, [edit, composing, saveText]);

	const select = useCallback((index: number, extend: boolean, focusGrid = true) => {
		const row = rows[index];
		if (!row) return;
		saveText(editRef.current);
		updateEdit(null);
		setSelection(previous => ({ anchor: extend ? previous?.anchor ?? row.id : row.id, focus: row.id }));
		onSelect(row.sourceCueId, row.startMs, { seek: !playingRef.current });
		reveal(index);
		if (focusGrid) grid.current?.focus({ preventScroll: true });
	}, [rows, onSelect, reveal, saveText, updateEdit]);

	const beginEdit = useCallback((index: number, field: Edit["field"], offset?: number) => {
		const row = rows[index];
		if (!row) return;
		select(index, false);
		const draft = field === "text" ? row.text : formatTimelineTimecode(field === "start" ? row.startMs : row.endMs).replace(/^00:0?/, "");
		updateEdit({ id: row.id, field, offset, draft, original: draft });
	}, [rows, select, updateEdit]);

	useLayoutEffect(() => {
		const next = pendingCaret.current;
		const rowIndex = next ? indices.get(next.id) : undefined;
		if (!next || rowIndex === undefined) return;
		pendingCaret.current = null;
		const row = rows[rowIndex];
		setSelection({ anchor: row.id, focus: row.id });
		reveal(rowIndex);
		onSelect(row.id, undefined, { seek: false });
		updateEdit({ id: row.id, field: "text", draft: row.text, original: row.text, offset: next.offset });
	}, [indices, rows, onSelect, reveal, updateEdit]);

	const cancel = useCallback(() => {
		updateEdit(null);
		grid.current?.focus({ preventScroll: true });
	}, [updateEdit]);
	const changeDraft = useCallback((draft: string) => {
		const current = editRef.current;
		if (!current || current.draft === draft) return;
		if (current.field === "text" && pauseOnTyping && playingRef.current) onPause();
		updateEdit({ ...current, draft });
	}, [onPause, pauseOnTyping, updateEdit]);
	const handlePlayback = useCallback((row: Row, mode: "from" | "range" | "toggle") => {
		saveText(editRef.current);
		if (mode === "toggle") { onTogglePlay(); return; }
		setSelection({ anchor: row.id, focus: row.id });
		onSelect(row.sourceCueId, undefined, { seek: false });
		if (mode === "from") onPlayFrom(row.startMs / 1000);
		else onPlayRange(row.startMs / 1000, row.endMs / 1000);
	}, [onPlayFrom, onPlayRange, onSelect, onTogglePlay, saveText]);
	const retime = useCallback((row: Row, field: "start" | "end", amount: number) => {
		const index = row.number - 1;
		const previous = allRows[index - 1], next = allRows[index + 1];
		const lower = Math.max(previous?.endMs ?? 0, row.clip?.startMs ?? 0);
		const upper = Math.min(next?.startMs ?? durationMs, row.clip?.endMs ?? durationMs);
		const minimum = Math.max(1, row.sourceCue.words?.length ?? 0) / (row.clip?.speed ?? 1);
		const start = field === "start" ? Math.max(lower, Math.min(amount, row.endMs - minimum)) : row.startMs;
		const end = field === "end" ? Math.min(upper, Math.max(amount, row.startMs + minimum)) : row.endMs;
		if (row.fragments.length > 1 || start < lower || end > upper || end - start < minimum) return;
		onRetime(row.sourceCueId, retimeCaptionFragment(row.fragments[0], { start, end }));
	}, [allRows, durationMs, onRetime]);

	const commit = useCallback((value: Edit) => {
		const current = editRef.current;
		if (!current || current.id !== value.id || current.field !== value.field) return;
		value = current;
		const index = indices.get(value.id);
		if (index === undefined) return updateEdit(null);
		const row = rows[index];
		if (value.field === "text") saveText(value);
		else if (value.draft !== value.original) {
			const amount = parseTimelineTimecode(value.draft);
			if (amount !== null) retime(row, value.field, amount);
		}
		updateEdit(null);
	}, [indices, rows, saveText, retime, updateEdit]);

	const editCueDraft = useCallback((current: Edit | null) => {
		if (current?.field !== "text" || current.draft === current.original || !current.draft.trim()) return cues;
		return cues.map(cue => cue.id === current.id
			? { ...editCaptionCueText(cue, current.draft), text: current.draft } : cue);
	}, [cues]);

	const splitAt = useCallback((row: Row, offset: number, draft: Edit | null, enterNext: boolean) => {
		const base = editCueDraft(draft);
		const split = splitCueAtTextOffset(base, row.id, offset);
		if (split === base) return;
		const originalIds = new Set(base.map(cue => cue.id));
		const right = split.find(cue => !originalIds.has(cue.id));
		updateEdit(null);
		if (enterNext && right) pendingCaret.current = { id: right.id, offset: 0 };
		setCues(split);
	}, [editCueDraft, setCues, updateEdit]);

	const mergeRows = useCallback((selected: Row[], editing?: Edit) => {
		if (selected.length < 2) return;
		const [first, second] = selected;
		const last = selected[selected.length - 1];
		const acrossCut = clips.some(clip => [clip.startMs, clip.endMs].some(edge => edge > first.startMs && edge < last.endMs));
		if (acrossCut || selected.some((row, index) => row.number !== first.number + index || row.fragments.length > 1)) {
			toast.warning(t("common.interface.captionOverviewCannotMergeAcrossCuts"));
			return;
		}
		const base = editCueDraft(editing ?? null);
		const merged = mergeProjectedCaptionCues(base, selected.map(row => row.id));
		if (base === merged) return;
		const left = base.find(cue => cue.id === first.id)?.text ?? first.text;
		const right = base.find(cue => cue.id === second.id)?.text ?? second.text;
		updateEdit(null);
		if (editing) pendingCaret.current = { id: first.id, offset: joinCaptionText(left, right).length - right.length };
		setSelection({ anchor: first.id, focus: first.id });
		onSelect(first.id, undefined, { seek: false });
		setCues(merged);
	}, [clips, editCueDraft, onSelect, setCues, t, updateEdit]);

	const handleTextKey = useCallback((event: KeyboardEvent<HTMLTextAreaElement>, value: Edit, row: Row) => {
		const input = event.currentTarget;
		const offset = input.selectionStart;
		const collapsed = offset === input.selectionEnd;
		const index = indices.get(row.id) ?? -1;
		const previous = allRows[row.number - 2];
		const next = allRows[row.number];
		if (event.altKey && (event.code === "BracketLeft" || event.code === "BracketRight")) {
			saveText(value);
			retime(row, event.code === "BracketLeft" ? "start" : "end", getPlayheadTime());
			return true;
		}
		if (event.key === "Enter" && !event.altKey) {
			if (offset === value.draft.length && index >= 0 && index + 1 < rows.length) beginEdit(index + 1, "text", 0);
			else if (offset > 0) splitAt(row, offset, value, true);
			return true;
		}
		if (collapsed && !event.shiftKey && event.key === "Backspace" && offset === 0 && previous) {
			mergeRows([previous, row], value);
			return true;
		}
		if (collapsed && !event.shiftKey && event.key === "Delete" && offset === value.draft.length && next) {
			mergeRows([row, next], value);
			return true;
		}
		if (!event.shiftKey && !event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
			const direction = event.key === "ArrowUp" ? "previous" : "next";
			const target = index + (direction === "previous" ? -1 : 1);
			if (index >= 0 && rows[target] && isAtOuterTextLine(input, direction)) {
				beginEdit(target, "text", 0);
				return true;
			}
		}
		return false;
	}, [allRows, beginEdit, getPlayheadTime, indices, mergeRows, retime, rows, saveText, splitAt]);

	function navigateRows(entries: number[], direction: "next" | "previous") {
		const index = direction === "next"
			? entries.find(value => value > focus) ?? entries[0]
			: [...entries].reverse().find(value => value < focus) ?? entries[entries.length - 1];
		if (index !== undefined) select(index, false);
		return index;
	}

	function navigateMatch(direction: "next" | "previous") {
		if (!matches.length) return;
		const next = (currentMatch + matches.length + (direction === "next" ? 1 : -1)) % matches.length;
		setMatchIndex(next);
		select(matches[next].row, false, false);
	}

	function replace(all: boolean) {
		const row = activeMatch ? rows[activeMatch.row] : undefined;
		if (!all && !row) return;
		const result = replaceInCaptions(cues, query, replacement, {
			caseSensitive,
			cueIds: all ? scope : new Set(row ? [row.sourceCueId] : []),
			firstOnly: !all,
			matchOffset: all ? undefined : activeMatch?.offset,
		});
		setReplacementCount(result.count);
		if (result.cues !== cues) setCues(result.cues);
	}

	function openSearch() {
		if (searchOpen) searchField.current?.focus();
		else {
			focusSearch.current = true;
			setSearchOpen(true);
		}
	}

	function handleSearchShortcut(event: KeyboardEvent<HTMLElement>) {
		if (event.nativeEvent.isComposing || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f") return;
		event.preventDefault();
		event.stopPropagation();
		openSearch();
	}

	const removeSelection = useCallback(() => {
		if (!selectedIds.length) return;
		const removing = new Set(selectedIds);
		updateEdit(null);
		setCues(current => removing.size === 1
			? deleteCue(current, selectedIds[0])
			: current.filter(cue => !removing.has(cue.id)));
		onSelect(null);
		setSelection(null);
	}, [onSelect, selectedIds, setCues, updateEdit]);

	const applyCut = useCallback((cut: PendingCut) => {
		if (onRippleDelete(cut.ranges, uiText("captionRippleDeleteReason"))) {
			updateEdit(null);
			setSelection(null);
		}
	}, [onRippleDelete, uiText, updateEdit]);
	const requestCut = useCallback((cut: PendingCut) => {
		if (skipRippleConfirm) {
			applyCut(cut);
			if (cut.words) toast.info(uiText("captionRippleDeleteWordHint"));
		} else setPendingCut(cut);
	}, [applyCut, skipRippleConfirm, uiText]);
	const deleteWords = useCallback((row: Row, start: number, end: number) => {
		const range = getCaptionWordCutRange(row, start, end, durationMs);
		if (!range) {
			if (start >= end || !row.sourceCue.words?.some(word => word.timingUnreliable)) return false;
			toast.warning(uiText("transcriptSelectReliableWords"));
			return true;
		}
		requestCut({ ranges: [range], count: 1, words: true });
		return true;
	}, [durationMs, requestCut, uiText]);
	const deleteCorrespondingMedia = useCallback(() => {
		if (firstSelected < 0) return;
		const selectedRows = rows.slice(firstSelected, lastSelected + 1);
		const ranges = mergeEditRanges(selectedRows.flatMap(row => row.fragments.map(fragment => ({
			startMs: Math.max(0, fragment.startMs),
			endMs: Math.min(durationMs, fragment.endMs),
		}))));
		if (ranges.length) requestCut({ ranges, count: selectedRows.length, words: false });
	}, [durationMs, firstSelected, lastSelected, requestCut, rows]);

	const handleRowAction = useCallback((row: Row, action: RowAction) => {
		if (action === "delete") { removeSelection(); return; }
		if (action === "ripple") { deleteCorrespondingMedia(); return; }
		if (action === "merge") {
			const selected = firstSelected < lastSelected
				? rows.slice(firstSelected, lastSelected + 1) : allRows.slice(row.number - 1, row.number + 1);
			mergeRows(selected, editRef.current ?? undefined);
			return;
		}
		const playhead = getPlayheadTime();
		if (action === "start" || action === "end") {
			retime(row, action, playhead);
			return;
		}
		const fragment = row.fragments.find(item => playhead > item.startMs && playhead < item.endMs);
		if (!fragment) {
			toast.info(t("common.interface.captionOverviewPlayheadOutside"));
			return;
		}
		const { startMs } = retimeCaptionFragment(fragment, { start: playhead, end: fragment.endMs });
		const base = editCueDraft(editRef.current).find(cue => cue.id === row.id) ?? row.sourceCue;
		splitAt(row, captionTextOffsetAtTime(base, startMs), editRef.current, false);
	}, [allRows, deleteCorrespondingMedia, editCueDraft, firstSelected, getPlayheadTime, lastSelected, mergeRows, removeSelection, retime, rows, splitAt, t]);

	function handleGridKeys(event: KeyboardEvent<HTMLDivElement>) {
		if (event.target !== event.currentTarget || event.nativeEvent.isComposing || !rows.length) return;
		const current = focus < 0 ? Math.max(0, visibleActiveIndex) : focus;
		switch (event.key) {
			case "ArrowDown":
			case "ArrowUp":
				select(Math.min(rows.length - 1, Math.max(0, current + (event.key === "ArrowDown" ? 1 : -1))), event.shiftKey);
				break;
			case "Enter": beginEdit(current, "text"); break;
			case " ": onTogglePlay(); break;
			case "Delete":
				if (event.shiftKey) { deleteCorrespondingMedia(); break; }
				removeSelection();
				break;
			case "Backspace": removeSelection(); break;
			default: return;
		}
		event.preventDefault();
		event.stopPropagation();
	}

	return (
		<section aria-label={text("Title")} onKeyDownCapture={handleSearchShortcut} className="flex min-h-0 flex-1 flex-col gap-2 p-2.5">
			<header className="flex items-center justify-between gap-2">
				<h2 className="text-sm font-semibold">{text("Title")}</h2>
				<span className="mr-auto shrink-0 text-xs tabular-nums text-muted-foreground">{text("Count", allRows.length)}</span>
				<Button size="icon" variant="ghost" aria-label={text("Find")} aria-expanded={searchOpen}
					title={`${text("Find")} · Ctrl+F`} onClick={() => searchOpen ? setSearchOpen(false) : openSearch()}>
					<MagnifyingGlass className="size-4" />
				</Button>
				<details className="relative">
					<summary aria-label={text("Options")} className="cursor-pointer list-none rounded px-2 hover:bg-foreground/10">⋯</summary>
					<div className="absolute right-0 z-10 flex w-max max-w-80 flex-col gap-2 rounded border border-separator bg-popover p-2 text-xs shadow-lg">
						<label className="flex items-center gap-2">
							<input type="checkbox" checked={pauseOnTyping} onChange={event => {
								const value = event.currentTarget.checked;
								setPauseOnTyping(value);
								saveAppSetting(CAPTION_PAUSE_ON_TYPING_STORAGE_KEY, value);
							}} />
							{text("PauseOnTyping")}
						</label>
						<CaptionQualityRuleSettings rules={rules} onRulesChange={updateRules} />
						<Button size="sm" variant="ghost" disabled={!allRows.length} onClick={() => {
							void navigator.clipboard.writeText(allRows.map(row => row.text).join("\n"))
								.then(() => toast.success(text("Copied"))).catch(() => toast.error(text("CopyFailed")));
						}}>{text("Copy")}</Button>
					</div>
				</details>
			</header>
			{searchOpen && <div className="flex flex-col gap-1.5">
				<div className="grid grid-cols-2 gap-1.5">
					<input ref={searchField} type="search" aria-label={text("Find")} placeholder={text("Find")} value={query}
						onChange={event => { setQuery(event.target.value); setMatchIndex(0); setReplacementCount(null); }}
						onKeyDown={event => {
							if (event.nativeEvent.isComposing || event.key !== "Enter") return;
							event.preventDefault();
							navigateMatch(event.shiftKey ? "previous" : "next");
						}} className={inputClass} />
					<input type="text" aria-label={text("Replacement")} placeholder={text("Replacement")} value={replacement}
						onChange={event => setReplacement(event.target.value)} className={inputClass} />
				</div>
				<div className="flex flex-wrap items-center gap-1">
					{query && <span role="status" data-testid="caption-match-count" className="text-xs tabular-nums text-muted-foreground">
						{t("common.interface.captionOverviewMatchCount", undefined, { current: matches.length ? currentMatch + 1 : 0, count: matches.length })}
					</span>}
					<Button size="sm" variant="ghost" disabled={!matches.length} onClick={() => navigateMatch("previous")}>{text("Previous")}</Button>
					<Button size="sm" variant="ghost" disabled={!matches.length} onClick={() => navigateMatch("next")}>{text("Next")}</Button>
					<Button size="sm" variant="ghost" disabled={!matches.length} onClick={() => replace(false)}>{text("Replace")}</Button>
					<Button size="sm" variant="ghost" disabled={!matches.length} onClick={() => setPendingReplacementCount(matches.length)}>{text("ReplaceAll")}</Button>
					<label className="ml-1 flex items-center gap-1 text-xs"><input type="checkbox" checked={caseSensitive}
						onChange={event => { setCaseSensitive(event.target.checked); setMatchIndex(0); }} />{text("MatchCase")}</label>
				</div>
			</div>}
			<div className="flex flex-wrap items-center gap-1">
				<CaptionQualityControls count={issues.size} filtered={onlyIssues}
					onFilter={filterIssues} onPrevious={() => navigateRows(issueIndices, "previous")} onNext={() => navigateRows(issueIndices, "next")} />
				{!following && <Button size="sm" variant="ghost" onClick={() => {
					setFollowing(true);
					reveal(visibleActiveIndex, true);
				}}>{text("Resume")}</Button>}
			</div>
			{replacementCount !== null && <p role="status" className="text-xs text-muted-foreground">{text("Replaced", replacementCount)}</p>}
			{hasEditableWords && <p className="text-xs text-muted-foreground">{uiText("captionRippleDeleteWordHint")}</p>}
			{allRows.length === 0 && emptyActions && (
				<div className="flex flex-wrap items-center gap-2">{emptyActions}</div>
			)}
			<div
				ref={grid}
				role="grid"
				data-caption-transcript-grid
				tabIndex={0}
				aria-label={text("Title")}
				aria-rowcount={rows.length}
				aria-colcount={1}
				aria-multiselectable
				aria-activedescendant={focus >= start && focus < end ? rowKey(focus) : undefined}
				onScroll={event => {
					memory.scrollTop = event.currentTarget.scrollTop;
					setScrollTop(memory.scrollTop);
				}}
				onWheel={() => setFollowing(false)}
				onPointerDown={event => { if (event.target === event.currentTarget) setFollowing(false); }}
				onKeyDown={handleGridKeys}
				className="min-h-0 flex-1 overflow-auto rounded border border-separator [overflow-anchor:none] focus-visible:outline-2 focus-visible:outline-accent"
			>
				{!rows.length && <p className="p-3 text-xs text-muted-foreground">{text("Empty")}</p>}
				<div aria-hidden="true" style={{ height: offsets[start] }} />
				{rows.slice(start, end).map((row, visibleIndex) => {
					const index = start + visibleIndex;
					return <CaptionOverviewRow key={row.id} row={row} index={index} active={index === visibleActiveIndex}
						selected={index >= firstSelected && index <= lastSelected} edit={edit?.id === row.id ? edit : null}
						issues={issues.get(row.id)} wraps={appearance.maxRows > 1}
						select={select} beginEdit={beginEdit} changeDraft={changeDraft} commit={commit} cancel={cancel}
						deleteWords={deleteWords} compositionChanged={setComposing} onPlayback={handlePlayback}
						onTextKey={handleTextKey} onAction={handleRowAction} actionRow={index === focus} multiSelected={selectedIds.length > 1}
						resolved={onlyIssues && !issues.has(row.id) && issueSnapshot.has(row.id)}
						matches={rowMatches[index] ?? NO_MATCHES} activeMatch={activeMatch?.row === index ? activeMatch.offset : undefined} />;
				})}
				<div aria-hidden="true" style={{ height: offsets[rows.length] - offsets[end] }} />
			</div>
			{pendingReplacementCount > 0 && <Dialog open onOpenChange={open => { if (!open) setPendingReplacementCount(0); }}>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>{text("ReplaceAll")}</DialogTitle>
						<DialogDescription>{text("ReplaceConfirm", pendingReplacementCount)}</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setPendingReplacementCount(0)}>{uiText("cancel")}</Button>
						<Button onClick={() => { replace(true); setPendingReplacementCount(0); }}>{text("ReplaceAll")}</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>}
			{pendingCut && (
				<CaptionRippleDeleteDialog count={pendingCut.count}
					milliseconds={pendingCut.ranges.reduce((sum, range) => sum + range.endMs - range.startMs, 0)}
					words={pendingCut.words}
					onCancel={() => setPendingCut(null)}
					onConfirm={skip => {
						if (skip) {
							saveAppSetting(CAPTION_SKIP_RIPPLE_CONFIRM_STORAGE_KEY, true);
							setSkipRippleConfirm(true);
						}
						applyCut(pendingCut);
						setPendingCut(null);
					}} />
			)}
		</section>
	);
});
