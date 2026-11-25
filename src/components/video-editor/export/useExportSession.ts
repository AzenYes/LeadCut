import { useCallback, useRef, useState } from "react";
import type { ExportProgress } from "@/lib/exporter";
import { createObservableValue } from "@/lib/observableValue";
import { resolveSavingExportProgress } from "../exportProgressState";
import type { PendingExportSave } from "./exportPersistence";
import type { ExportPreflightIssue } from "./exportPreflight";
import type { ExportPreview, PreparedExportPreview } from "./pausedExportPreview";

export type CancelableExporter = { cancel(): void };

export function useExportSession() {
	const [isExporting, setIsExporting] = useState(false);
	const [progress] = useState(() => createObservableValue<ExportProgress | null>(null));
	const [preview] = useState(() => createObservableValue<ExportPreview | null>(null));
	const preparedPreviewRef = useRef<Promise<PreparedExportPreview | null> | null>(null);
	const [exportError, setExportError] = useState<string | null>(null);
	const [preflightIssues, setPreflightIssues] = useState<ExportPreflightIssue[]>([]);
	const [showExportDropdown, setShowExportDropdown] = useState(false);
	const [exportedFilePath, setExportedFilePath] = useState<string>();
	const [hasPendingExportSave, setHasPendingExportSave] = useState(false);
	const exporterRef = useRef<CancelableExporter | null>(null);
	const exportRunIdRef = useRef(0);
	const cancelledExportRunIdRef = useRef<number | null>(null);
	const pendingExportSaveRef = useRef<PendingExportSave | null>(null);

	const clearPendingExportSave = useCallback(() => {
		const pendingSave = pendingExportSaveRef.current;
		pendingExportSaveRef.current = null;
		setHasPendingExportSave(false);
		if (pendingSave?.tempFilePath && typeof window !== "undefined") {
			void window.electronAPI.discardExportedTemp?.(pendingSave.tempFilePath);
		}
	}, []);

	const markExportAsSaving = useCallback(() => {
		progress.set(resolveSavingExportProgress(progress.get()));
	}, [progress]);

	return {
		isExporting,
		setIsExporting,
		progress,
		preview,
		preparedPreviewRef,
		setExportProgress: progress.set,
		exportError,
		setExportError,
		preflightIssues,
		setPreflightIssues,
		showExportDropdown,
		setShowExportDropdown,
		exportedFilePath,
		setExportedFilePath,
		hasPendingExportSave,
		setHasPendingExportSave,
		exporterRef,
		exportRunIdRef,
		cancelledExportRunIdRef,
		pendingExportSaveRef,
		clearPendingExportSave,
		markExportAsSaving,
	};
}
