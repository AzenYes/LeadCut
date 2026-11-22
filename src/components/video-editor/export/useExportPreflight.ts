import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useUiText } from "@/i18n/useUiText";
import { logError } from "@/lib/appLog";
import { estimateMp4OutputBytes, getMp4ExportBitrate } from "@/lib/exporter/exportBitrate";
import type { ExportSettings } from "@/lib/exporter/types";
import { resolveAvailableMp4Quality } from "../exportDimensions";
import type { useTimelineState } from "../state/useTimelineState";
import { checkProjectExport } from "./checkProjectExport";
import { suggestedExportFileName } from "./exportFileName";
import { collectExportPreflightIssues, type ExportPreflightIssue } from "./exportPreflight";
import type { useExportDimensions } from "./useExportDimensions";
import type { useExportSession } from "./useExportSession";
import type { useExportRunner } from "./useExportRunner";

type Input = {
	projectDisplayName: string;
	timeline: ReturnType<typeof useTimelineState>;
	timelineDuration: number;
	outputDimensions: ReturnType<typeof useExportDimensions>["mp4OutputDimensions"];
	session: ReturnType<typeof useExportSession>;
	handleExport: ReturnType<typeof useExportRunner>["handleExport"];
	reviewChapters: () => void;
};

type PendingExport = {
	settings: ExportSettings;
	estimatedBytes: number;
	issues: ExportPreflightIssue[];
	outputPath?: string;
};

export function useExportPreflight({
	projectDisplayName, timeline, timelineDuration, outputDimensions, session, handleExport, reviewChapters,
}: Input) {
	const uiText = useUiText();
	const pending = useRef<PendingExport | null>(null);
	const checking = useRef(false);
	const [isChecking, setIsChecking] = useState(false);
	const noDiskSpace = { targetFreeBytes: null, tempFreeBytes: null };

	function reset() {
		pending.current = null;
		session.setPreflightIssues([]);
	}

	function run(request: PendingExport) {
		reset();
		void handleExport(request.settings, request.outputPath);
	}

	async function check(task: () => Promise<void>) {
		checking.current = true;
		setIsChecking(true);
		try {
			await task();
		} catch (error) {
			const message = String(error instanceof Error ? error.message : error);
			logError("export", message);
			session.setExportError(message);
		} finally {
			checking.current = false;
			setIsChecking(false);
		}
	}

	async function chooseDestination(request: PendingExport) {
		const result = await window.electronAPI.chooseExportPath(
			suggestedExportFileName(projectDisplayName, request.settings.format === "gif" ? "gif" : "mp4"),
		);
		if (pending.current !== request || result.canceled) return;
		if (!result.success || !result.path) throw new Error(result.error || uiText("failedToSaveVideo"));
		const space = await window.electronAPI.getExportDiskSpace?.(result.path).catch(() => null);
		if (pending.current !== request) return;
		request.outputPath = result.path;
		request.issues = collectExportPreflightIssues({
			chapterStatus: "off", captionsEnabled: false, captionFontName: null, availableFonts: [],
			estimatedBytes: request.estimatedBytes,
			...(space ?? noDiskSpace),
		});
		if (request.issues.length) session.setPreflightIssues(request.issues);
		else run(request);
	}

	function start(settings: ExportSettings) {
		if (checking.current) return;
		const source = outputDimensions.source;
		const quality = resolveAvailableMp4Quality(source.width, source.height, settings.quality ?? "source");
		const estimatedBytes = settings.gifConfig
			? settings.gifConfig.width * settings.gifConfig.height * settings.gifConfig.frameRate * timelineDuration
			: estimateMp4OutputBytes(getMp4ExportBitrate({
				...outputDimensions[quality], frameRate: settings.mp4FrameRate ?? 30, quality,
				encodingMode: settings.encodingMode ?? "balanced", manualBitrateMbps: settings.bitrateMbps,
			}), timelineDuration);
		const request: PendingExport = { settings, estimatedBytes, issues: [] };
		pending.current = request;
		void check(async () => {
			const issues = await checkProjectExport(timeline);
			if (pending.current !== request) return;
			request.issues = issues;
			if (request.issues.length) session.setPreflightIssues(request.issues);
			else await chooseDestination(request);
		});
	}

	function resolve(kind: ExportPreflightIssue["kind"]) {
		const request = pending.current;
		if (!request || checking.current) return;
		if (kind === "chapters") {
			flushSync(() => timeline.setChapterProgress({ ...timeline.chapterProgress, enabled: false }));
		}
		request.issues = request.issues.filter(issue => issue.kind !== kind);
		session.setPreflightIssues(request.issues);
		if (request.issues.length) return;
		if (kind === "diskSpace") run(request);
		else void check(() => chooseDestination(request));
	}

	function chooseAnotherDestination() {
		const request = pending.current;
		if (request && !checking.current) void check(() => chooseDestination(request));
	}

	return { isChecking, start, reset, resolve, chooseAnotherDestination, reviewChapters };
}
