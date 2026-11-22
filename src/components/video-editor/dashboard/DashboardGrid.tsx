import { useUiText } from "@/i18n/useUiText";
import { LibrarySkeleton } from "./LibrarySkeleton";
import { RecordNewButton } from "./RecordNewButton";
import { RawPreview } from "./RawRecordings";
import { ImageSquare } from "@/components/ui/icons";

import { Button } from "@/components/ui/button";

import { DashboardSettings } from "./DashboardSettings";

import { ProjectCard } from "./ProjectCard";
import type { DashboardProps } from "./types";

import type { DashboardModel } from "./useDashboardModel";

export function DashboardGrid({
	entries,
	onImportFile,
	loading,
	isRaw,
	rawPreview,
	setRawPreview,
	rawLoading,
	rawError,
	refreshRaw,
	error,
	onRetry,
	section,
	visible,
	busy,
	selecting,
	toggleSelected,
	onRenameProject,
	folders,
	save,
	assignFolder,
	selected,
	openEntry,
	query,
	hasActiveFilters,
	setQuery,
	run,
	deleteEntries,
}: Pick<
	DashboardProps & DashboardModel,
	| "entries"
	| "loading"
	| "onImportFile"
	| "isRaw"
	| "rawPreview"
	| "setRawPreview"
	| "rawLoading"
	| "rawError"
	| "refreshRaw"
	| "error"
	| "onRetry"
	| "section"
	| "visible"
	| "busy"
	| "selecting"
	| "toggleSelected"
	| "onRenameProject"
	| "folders"
	| "save"
	| "assignFolder"
	| "selected"
	| "openEntry"
	| "query"
	| "hasActiveFilters"
	| "setQuery"
	| "deleteEntries"
	| "run"
>) {
	const uiText = useUiText();
	return (
		<>
			<main className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-7 pb-10 lg:px-10">
				{error && (
					<div role="alert" className="mb-4 flex items-center gap-3 text-sm text-danger">
						<span>{uiText("failedToLoadProjectLibrary")}: {error}</span>
						<Button variant="secondary" size="sm" disabled={loading} onClick={() => void onRetry?.()}>{uiText("retry")}</Button>
					</div>
				)}
				{section === "settings" ? (
					<DashboardSettings
						onImportFile={onImportFile}
						legacyCount={entries.filter(entry => entry.isLegacyFormat).length}
						refreshProjects={onRetry}
					/>
				) : (isRaw ? rawLoading : loading) ? (
					<LibrarySkeleton />
				) : visible.length ? (
					<ul
						aria-label={isRaw ? uiText("rawFiles") : uiText("yourProjects")}
						className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-x-7 gap-y-10 lg:gap-x-9"
					>
						{visible.map((entry) => (
							<ProjectCard
								key={entry.path}
								onDelete={() => void deleteEntries([entry.path])}
								{...{
									entry,
									busy,
									selecting,
									selected,
									toggleSelected,
									openEntry,
									run,
									onRenameProject,
									folders,
									save,
									assignFolder,
								}}
							/>
						))}
					</ul>
				) : error && !isRaw ? null : (
					<div className="flex h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
						{!isRaw && !hasActiveFilters ? (
							<span aria-hidden="true" className="text-4xl">
								🦗
							</span>
						) : (
							<ImageSquare weight="fill" className="size-8 opacity-30" />
						)}
						<p>
							{isRaw
								? rawLoading
									? uiText("loadingRecordings")
									: rawError ||
										(hasActiveFilters
											? uiText("noMatchingRawFiles")
											: uiText("noRawRecordingsYet"))
								: hasActiveFilters
									? uiText("noMatchingProjects")
									: uiText("itSLookingEmptyInHere")}
						</p>
						{!isRaw && !hasActiveFilters && (
							<RecordNewButton busy={busy} run={run} first className="mt-2" />
						)}
						{isRaw && rawError && (
							<Button onClick={() => void refreshRaw()}>{uiText("retry")}</Button>
						)}
						{query && (
							<Button variant="ghost" size="sm" onClick={() => setQuery("")}>
								{uiText("clearSearch")}</Button>
						)}
					</div>
				)}
				<RawPreview entry={rawPreview} onClose={() => setRawPreview(null)} />
			</main>
		</>
	);
}
