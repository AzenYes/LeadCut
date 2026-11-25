import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { useI18n } from "@/contexts/I18nContext";
import { MAX_CUT_REDO_NOTE_LENGTH, needsCutRedo, type ChangeLogEntry } from "./changeLog";
import { buildCutReviewHandoff, type CutReviewProject } from "./cutReviewHandoff";
import { changeConfidencePriority, type useChangeReview } from "./hooks/useChangeReview";
import type { useEditorProjectController } from "./project/useEditorProjectController";
import type { AgentEdit } from "./project/agentEditReview";
import { formatTimelineTimecode } from "./timeline/core/time";

const confidenceLabels = { low: "ConfidenceLow", medium: "ConfidenceMedium", high: "ConfidenceHigh", unknown: "ConfidenceUnknown" };
const reviewLabels = { pending: "StatusPending", accepted: "StatusAccepted", restored: "StatusRestored" };
const agentPageSize = 24;

function getEditItemSummary(edit: AgentEdit) {
	if (!edit.target) return undefined;
	if (edit.field === "autoCaptions") return (edit.after[0] ?? edit.before[0])?.text;
	if (edit.field === "zoomRegions") {
		const zoom = edit.after[0] ?? edit.before[0];
		if (zoom) return `${formatTimelineTimecode(zoom.startMs)}–${formatTimelineTimecode(zoom.endMs)}`;
	}
}

export function ChangeReviewPanel({ review, project, focused, canFocus, onToggleFocus, recentAgentCutIds, agentEdits }: {
	review: ReturnType<typeof useChangeReview>;
	project: CutReviewProject;
	focused: boolean;
	canFocus: boolean;
	onToggleFocus: (entry: ChangeLogEntry) => void;
	recentAgentCutIds: ReadonlySet<string>;
	agentEdits: ReturnType<typeof useEditorProjectController>["agentEdits"];
}) {
	const { t, locale } = useI18n();
	const text = (key: string, variables?: Record<string, number>) => t(`common.interface.review${key}`, undefined, variables);
	const [sortBy, setSortBy] = useState<"confidence" | "time">("confidence");
	const [redoDraft, setRedoDraft] = useState<{ id: string; note: string } | null>(null);
	const [editDraft, setEditDraft] = useState<{ id: string; note: string } | null>(null);
	const [agentPage, setAgentPage] = useState<{ firstId: string; index: number }>();
	const [exporting, setExporting] = useState(false);
	const listRef = useRef<HTMLUListElement>(null);
	const entries = useMemo(() => sortBy === "confidence"
		? [...review.entries].sort((a, b) => (a.confidence ? changeConfidencePriority[a.confidence] : 3) -
			(b.confidence ? changeConfidencePriority[b.confidence] : 3))
		: review.entries,
	[review.entries, sortBy]);
	const reviewed = entries.reduce((count, entry) => count + (entry.review === "accepted" || entry.review === "restored" ? 1 : 0), 0);
	const redoCount = entries.filter(needsCutRedo).length;
	const editNoteCount = agentEdits.entries.filter(edit => edit.note?.trim()).length;
	const firstAgentEdit = agentEdits.entries[0]?.id;
	const agentPageCount = Math.ceil(agentEdits.entries.length / agentPageSize);
	const agentPageIndex = agentPage && agentPage.firstId === firstAgentEdit
		? Math.min(agentPage.index, agentPageCount - 1) : 0;
	const activeEdit = editDraft && agentEdits.entries.find(edit => edit.id === editDraft.id);
	const redoEntry = redoDraft && entries.find(entry => entry.id === redoDraft.id);
	useEffect(() => {
		if (recentAgentCutIds.size) listRef.current?.querySelector('[data-review-latest="true"]')?.scrollIntoView({ block: "nearest" });
	}, [recentAgentCutIds]);

	async function exportHandoff() {
		setExporting(true);
		try {
			const result = await window.electronAPI.saveCutReviewHandoff(buildCutReviewHandoff(project, review.entries, locale, agentEdits.entries), project.name);
			if (result.success) toast.success(text("HandoffSaved"));
			else if (!result.canceled) toast.error(text("HandoffFailed"));
		} catch {
			toast.error(text("HandoffFailed"));
		} finally {
			setExporting(false);
		}
	}
	return (
		<section aria-label={text("Title")} className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-3">
			<header className="flex items-center justify-between gap-2">
				<h2 className="text-sm font-semibold">{text("Title")}</h2>
				{entries.length > 0 && <span className="text-xs tabular-nums text-muted-foreground">{text("Progress", { reviewed, total: entries.length })}</span>}
			</header>
			{agentEdits.entries.length > 0 && (
				<section className="max-h-60 shrink-0 overflow-y-auto" aria-label={text("OtherEdits")}>
					<h3 className="text-xs font-semibold">{text("OtherEdits")}</h3>
					<ul className="divide-y divide-separator">
						{agentEdits.entries.slice(agentPageIndex * agentPageSize, (agentPageIndex + 1) * agentPageSize).map(edit => (
							<li key={edit.id} data-agent-edit={edit.field} data-agent-edit-item={edit.target?.id} className="py-2 text-xs">
								<div className="flex items-center justify-between gap-2">
									<span>{text(`Field_${edit.field}`)}</span>
									<span className="text-muted-foreground">{text(reviewLabels[edit.status])}</span>
								</div>
								{edit.target && <p className="line-clamp-2 break-words text-muted-foreground">{getEditItemSummary(edit)}</p>}
								{edit.note && <p className="whitespace-pre-wrap break-words py-1 text-muted-foreground">{edit.note}</p>}
								<div className="flex flex-wrap gap-1">
									<Button variant="ghost" size="sm" disabled={edit.status !== "pending"} onClick={() => agentEdits.accept(edit)}>{text("AcceptEdit")}</Button>
									<Button variant="secondary" size="sm" disabled={!agentEdits.canRestore(edit)} onClick={() => agentEdits.restore(edit)}>{text("RestoreEdit")}</Button>
									<Button variant="ghost" size="sm" onClick={() => setEditDraft({ id: edit.id, note: edit.note ?? "" })}>{text("NoteForAgent")}</Button>
								</div>
							</li>
						))}
					</ul>
					{firstAgentEdit && agentPageCount > 1 && (
						<div className="sticky bottom-0 flex items-center justify-between gap-2 bg-background py-1">
							<Button variant="ghost" size="sm" disabled={agentPageIndex === 0}
								onClick={() => setAgentPage({ firstId: firstAgentEdit, index: agentPageIndex - 1 })}>{text("Previous")}</Button>
							<span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">{agentPageIndex + 1} / {agentPageCount}</span>
							<Button variant="ghost" size="sm" disabled={agentPageIndex === agentPageCount - 1}
								onClick={() => setAgentPage({ firstId: firstAgentEdit, index: agentPageIndex + 1 })}>{text("Next")}</Button>
						</div>
					)}
				</section>
			)}
			{entries.length === 0 ? (agentEdits.entries.length === 0 && <p className="py-1 text-xs text-muted-foreground">{text("Empty")}</p>) : (
				<>
					<div className="flex flex-wrap items-center gap-1.5">
						<Button variant="ghost" size="sm" onClick={() => review.goToEntry(-1)}>{text("Previous")}</Button>
						<Button variant="ghost" size="sm" onClick={() => review.goToEntry(1)}>{text("Next")}</Button>
						<select aria-label={text("Sort")} value={sortBy}
							onChange={event => setSortBy(event.target.value === "time" ? "time" : "confidence")}
							className="ml-auto rounded bg-foreground/5 px-1 py-1 text-xs">
							<option value="confidence">{text("SortConfidence")}</option>
							<option value="time">{text("SortTime")}</option>
						</select>
					</div>
					<ul ref={listRef} aria-label={text("Changes")} className="min-h-0 flex-1 divide-y divide-separator overflow-y-auto">
						{entries.map(entry => {
							const state = entry.review ?? "pending";
							const confidence = entry.confidence ?? "unknown";
							const selected = entry.id === review.selected;
							const redo = needsCutRedo(entry);
							const recent = recentAgentCutIds.has(entry.id);
							return (
								<li key={entry.id} data-review-entry={entry.id} data-selected={selected} data-review-latest={recent || undefined}
									className={`px-1 py-2.5 ${selected || recent ? "bg-accent/10" : ""} ${state === "restored" ? "opacity-60" : ""}`}>
									<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums">
										<Button size="sm" variant="ghost" className="h-7 px-1 font-mono" onClick={() => review.select(entry)}>
											{formatTimelineTimecode(entry.timelineMs)}
										</Button>
										<span className="font-mono text-muted-foreground">−{formatTimelineTimecode(entry.durationMs)}</span>
										<span>{text(confidenceLabels[confidence])}</span>
										{recent && <span className="text-accent">{text("ThisRound")}</span>}
										<span className={redo ? "ml-auto text-warning" : "ml-auto text-muted-foreground"}>
											{text(redo ? "StatusRedo" : reviewLabels[state])}
										</span>
									</div>
									{entry.reason && <p className="whitespace-pre-wrap break-words px-1 py-1 text-xs">{entry.reason}</p>}
									{redo && entry.redo?.note && <p className="whitespace-pre-wrap break-words px-1 py-1 text-xs text-muted-foreground">{entry.redo.note}</p>}
									<div className="flex flex-wrap gap-1">
										<Button variant="ghost" size="sm" disabled={state === "restored"} onClick={() => review.audition(entry)}>
											{selected && review.auditioning ? text("Auditioning") : text("Audition")}
										</Button>
										<Button variant="ghost" size="sm" disabled={state !== "pending"} onClick={() => review.accept(entry)}>{text("Accept")}</Button>
										<Button variant="secondary" size="sm" disabled={state === "restored" || entry.durationMs <= 0}
											onClick={() => review.restore(entry)}>{text("Restore")}</Button>
										<Button variant="ghost" size="sm" disabled={state === "restored"}
											onClick={() => setRedoDraft({ id: entry.id, note: entry.redo?.note ?? "" })}>
											{text(redo ? "EditRedo" : "MarkRedo")}
										</Button>
										<Button variant="ghost" size="sm" disabled={!canFocus} onClick={() => onToggleFocus(entry)}>
											{text(focused && selected ? "ReturnToFull" : "FocusCut")}
										</Button>
									</div>
								</li>
							);
						})}
					</ul>
				</>
			)}
			{(redoCount + editNoteCount) > 0 && <Button variant="outline" size="sm" className="self-start" disabled={exporting} onClick={() => void exportHandoff()}>
				{text("ExportHandoff", { count: redoCount + editNoteCount })}
			</Button>}
			{editDraft && activeEdit && (
				<Dialog open onOpenChange={open => { if (!open) setEditDraft(null); }}>
					<DialogContent>
						<DialogHeader><DialogTitle>{text("NoteForAgent")}</DialogTitle></DialogHeader>
						<DialogDescription>{text(`Field_${activeEdit.field}`)}</DialogDescription>
						<textarea aria-label={text("NoteForAgent")} rows={4} maxLength={MAX_CUT_REDO_NOTE_LENGTH} value={editDraft.note}
							className="rounded border border-separator bg-background p-2 text-sm"
							onChange={event => setEditDraft({ ...editDraft, note: event.target.value })} />
						<DialogFooter>
							<Button onClick={() => {
								agentEdits.saveNote(activeEdit, editDraft.note.trim());
								setEditDraft(null);
							}}>{text("SaveNote")}</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
			{redoDraft && redoEntry && (
				<Dialog open onOpenChange={open => { if (!open) setRedoDraft(null); }}>
					<DialogContent>
						<DialogHeader><DialogTitle>{text("RedoTitle")}</DialogTitle></DialogHeader>
						<DialogDescription>{formatTimelineTimecode(redoEntry.timelineMs)}</DialogDescription>
						<label className="grid gap-2 text-sm">
							{text("RedoNote")}
							<textarea rows={4} maxLength={MAX_CUT_REDO_NOTE_LENGTH} value={redoDraft.note}
								className="rounded border border-separator bg-background p-2"
								onChange={event => setRedoDraft({ ...redoDraft, note: event.target.value })} />
						</label>
						<DialogFooter>
							{needsCutRedo(redoEntry) && <Button variant="ghost" onClick={() => {
								review.setRedo(redoEntry, null);
								setRedoDraft(null);
							}}>{text("ClearRedo")}</Button>}
							<Button onClick={() => {
								review.setRedo(redoEntry, redoDraft.note);
								setRedoDraft(null);
							}}>{text("SaveRedo")}</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</section>
	);
}
