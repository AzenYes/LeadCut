import { needsCutRedo, type ChangeLogEntry } from "./changeLog";
import type { AgentEdit } from "./project/agentEditReview";

export interface CutReviewProject {
	name: string;
	path: string | null;
	id: string | null;
	sourcePath: string | null;
}

export function buildCutReviewHandoff(project: CutReviewProject, entries: readonly ChangeLogEntry[], language: string, agentEdits: readonly AgentEdit[] = []) {
	const cuts = entries.filter(needsCutRedo).map(entry => ({
		cutId: entry.id,
		batchId: entry.batchId,
		rangeIndex: entry.rangeIndex,
		afterClipId: entry.afterClipId ?? null,
		sequenceTimeMs: entry.timelineMs,
		sourceStartMs: entry.sourceStartMs,
		sourceEndMs: entry.sourceEndMs,
		removedDurationMs: entry.durationMs,
		speed: entry.speed,
		originalReason: entry.reason ?? null,
		confidence: entry.confidence ?? null,
		reviewNote: entry.redo?.note ?? "",
		markedAt: entry.redo?.markedAt ?? null,
	}));
	const chinese = language.startsWith("zh");
	const edits = agentEdits.filter(edit => edit.note?.trim()).map(({ id, field, target, status, note }) => ({ id, field, itemId: target?.id, status, reviewNote: note?.trim() }));
	const heading = chinese ? "LeadCut 变更复核交接单" : "LeadCut change review handoff";
	const instruction = chinese
		? "以 project.path 定位工程。按 cutId 核对剪切记录，按 field 核对其他变更。itemId 指向具体字幕或缩放区间。请阅读 reviewNote。时间单位为毫秒。sequenceTimeMs 是导出时的成片切口位置，sourceStartMs 和 sourceEndMs 是原素材截去的区间。使用 LeadCut MCP 写回前，请保存工程并使用编辑器的交接功能释放锁。"
		: "Locate the project at project.path. Identify cuts by cutId and other edits by field. When present, itemId identifies a specific caption or zoom region. Read reviewNote for each change. Times are in milliseconds. sequenceTimeMs is the seam at export time. sourceStartMs and sourceEndMs identify the removed source range. Save and hand off the project in the editor before writing through LeadCut MCP.";
	const data = JSON.stringify({ version: 1, project, cuts, ...(edits.length ? { edits } : {}) }, null, 2).replace(/`/g, "\\u0060");
	return [`# ${heading}`, "", instruction, "", "```json", data, "```", ""].join("\n");
}
