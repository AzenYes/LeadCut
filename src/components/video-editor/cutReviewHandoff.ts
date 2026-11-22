import { needsCutRedo, type ChangeLogEntry } from "./changeLog";

export interface CutReviewProject {
	name: string;
	path: string | null;
	id: string | null;
	sourcePath: string | null;
}

export function buildCutReviewHandoff(project: CutReviewProject, entries: readonly ChangeLogEntry[], language: string) {
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
	const heading = chinese ? "LeadCut 切口重做交接单" : "LeadCut cut redo handoff";
	const instruction = chinese
		? "以 project.path 定位工程，按 cutId 核对剪切记录，并根据 reviewNote 重做。时间单位为毫秒。sequenceTimeMs 是导出时的成片切口位置，sourceStartMs 和 sourceEndMs 是原素材截去的区间。使用 LeadCut MCP 写回前，请在编辑器中保存并返回首页，释放工程。"
		: "Locate the project at project.path, match each cut by cutId, and redo it using reviewNote. Times are in milliseconds. sequenceTimeMs is the seam at export time. sourceStartMs and sourceEndMs identify the removed source range. Before writing through LeadCut MCP, save the project and return to Home in the editor to release it.";
	const data = JSON.stringify({ version: 1, project, cuts }, null, 2).replace(/`/g, "\\u0060");
	return [`# ${heading}`, "", instruction, "", "```json", data, "```", ""].join("\n");
}
