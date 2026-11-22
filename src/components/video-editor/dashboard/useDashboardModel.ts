import { useUiText } from "@/i18n/useUiText";
import { useRawLibrary } from "./useRawLibrary";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";
import type { DashboardProps } from "./types";
import { useDashboardMetadata } from "./useDashboardMetadata";
import { useProjectFolders } from "./useProjectFolders";
export function useDashboardModel({
	entries,
	onOpenChange,
	onOpenProject,
	onRenameProject,
	onDeleteProjects,
	open,
}: DashboardProps) {
	const uiText = useUiText();
	const { metadata, update } = useDashboardMetadata();
	const [selecting, setSelecting] = useState(false);
	const [selected, setSelected] = useState<string[]>([]);
	const toggleSelected = (path: string) =>
		setSelected((prev) =>
			prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path],
		);
	const { folders, save } = useProjectFolders();
	const assignFolder = (path: string, id: string) =>
		save(
			folders.map((f) => ({
				...f,
				paths:
					f.id === id
						? f.paths.includes(path)
							? f.paths.filter((p) => p !== path)
							: [...f.paths, path]
						: id === "none"
							? f.paths.filter((p) => p !== path)
							: f.paths,
			})),
		);
	const [query, setQuery] = useState("");
	const [period, setPeriod] = useState("all");
	const [sort, setSort] = useState("recent");
	const [section, changeSection] = useState("projects");
	const [library, setLibrary] = useState("projects");
	useEffect(() => {
		if (!open) return;
		changeSection("projects");
		setLibrary("projects");
		setQuery("");
		setSelecting(false);
		setSelected([]);
	}, [open]);
	const raw = useRawLibrary(open && library === "raw");
	const [rawPreview, setRawPreview] = useState<ProjectLibraryEntry | null>(null);
	const isRaw = library === "raw";
	const setSection = (next: string) => {
		if (next === "projects" || next === "raw") setLibrary(next);
		changeSection(next);
		setQuery("");
		setSelecting(false);
		setSelected([]);
	};
	const libraryEntries = isRaw ? raw.entries : entries;
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const [pendingDelete, setPendingDelete] = useState<{ entries: ProjectLibraryEntry[]; raw: boolean } | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	useEffect(() => { if (!open) { setPendingDelete(null); setDeleteError(null); } }, [open]);
	const visible = useMemo(
		() =>
			libraryEntries
				.filter((entry) => {
					const cutoff =
						period === "week"
							? Date.now() - 7 * 86400000
							: period === "month"
								? Date.now() - 30 * 86400000
								: 0;
					const folder = folders.find((f) => f.id === section);
					return (
						entry.updatedAt >= cutoff &&
						entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
						(!folder || folder.paths.includes(entry.path))
					);
				})
				.sort((a, b) =>
					sort === "name"
						? a.name.localeCompare(b.name)
						: sort === "created"
							? (b.createdAt ?? b.updatedAt) - (a.createdAt ?? a.updatedAt)
							: b.updatedAt - a.updatedAt,
				),
		[libraryEntries, query, period, sort, folders, section],
	);
	const run = async (action: () => Promise<void>) => {
		if (busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		try {
			await action();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : uiText("couldNotCompleteAction"));
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	};
	const deleteEntries = (paths: string[]) => {
		if (busyRef.current) return;
		const requested = libraryEntries.filter((entry) => paths.includes(entry.path));
		if (!requested.length) return;
		setDeleteError(null);
		setPendingDelete({ entries: requested, raw: isRaw });
	};
	const cancelDelete = () => { if (!busyRef.current) { setPendingDelete(null); setDeleteError(null); } };
	const confirmDelete = () => run(async () => {
		if (!pendingDelete) return;
		try {
			const paths = pendingDelete.entries.map((entry) => entry.path);
			const deleted = await (pendingDelete.raw ? raw.remove : onDeleteProjects)(paths);
			save(folders.map((folder) => ({ ...folder, paths: folder.paths.filter((path) => !deleted.includes(path)) })));
			setSelected((current) => current.filter((path) => !deleted.includes(path)));
			if (selected.every((path) => deleted.includes(path))) setSelecting(false);
			if (deleted.length) toast.success(uiText(pendingDelete.raw ? "deleteRawSuccess" : "deleteProjectSuccess", { count: deleted.length }));
			const failed = pendingDelete.entries.filter((entry) => !deleted.includes(entry.path));
			setPendingDelete(failed.length ? { ...pendingDelete, entries: failed } : null);
			setDeleteError(failed.length ? uiText("deletePartialFailure", { count: failed.length }) : null);
		} catch (error) {
			setDeleteError(error instanceof Error ? error.message : String(error));
		}
	});

	const openEntry = (entry: ProjectLibraryEntry) =>
		entry.rawSource
			? setRawPreview(entry)
			: entry.isCurrent
				? onOpenChange(false)
				: void run(async () => {
						await onOpenProject(entry.path);
					});
	const navClass = (active: boolean) =>
		`h-10 w-full justify-start gap-3 px-3 text-[13px] ${active ? "bg-default/50 font-medium" : "text-muted-foreground"}`;

	return {
		isRaw,
		rawPreview,
		setRawPreview,
		rawLoading: raw.loading,
		rawError: raw.error,
		refreshRaw: raw.refresh,
		onRenameProject: isRaw ? raw.rename : onRenameProject,
		onDeleteProjects: isRaw ? raw.remove : onDeleteProjects,
		metadata,
		update,
		selecting,
		setSelecting,
		selected,
		setSelected,
		deleteEntries,
		pendingDelete,
		deleteError,
		cancelDelete,
		confirmDelete,
		toggleSelected,
		assignFolder,
		query,
		hasActiveFilters:
			Boolean(query.trim()) || period !== "all" || folders.some((f) => f.id === section),
		setQuery,
		period,
		setPeriod,
		sort,
		setSort,
		section,
		setSection,
		busy,
		folders,
		save,
		visible,
		run,
		openEntry,
		navClass,
	};
}
export type DashboardModel = ReturnType<typeof useDashboardModel>;
