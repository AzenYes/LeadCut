import { getUiLocale } from "@/i18n/uiText";
import { useUiText } from "@/i18n/useUiText";
import { useRef, useState } from "react";
import { Dropdown } from "@heroui/react";
import { Button } from "@/components/ui/button";
import { Check, DotsThree, FolderSimple, Plus } from "@/components/ui/icons";
import { ProjectFolderChips } from "./ProjectFolderChips";
import { RawThumbnail } from "./RawRecordings";
import { ProjectThumbnail } from "./ProjectThumbnail";
import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";
import type { DashboardProps } from "./types";
import type { DashboardModel } from "./useDashboardModel";

type Props = Pick<DashboardProps & DashboardModel,
	"busy" | "selecting" | "selected" | "toggleSelected" | "openEntry" | "run" |
	"onRenameProject" | "folders" | "save" | "assignFolder"> & {
	entry: ProjectLibraryEntry;
	onDelete?: () => void;
};

export function ProjectCard({ entry, busy, selecting, selected, toggleSelected, openEntry,
	run, onRenameProject, folders, save, assignFolder, onDelete }: Props) {
	const uiText = useUiText();
	const [hovering, setHovering] = useState(false);
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(entry.name);
	const renaming = useRef(false);
	const assignedFolders = folders.filter(folder => folder.paths.includes(entry.path));
	const rename = () => {
		if (renaming.current) return;
		renaming.current = true;
		void run(async () => {
			if (!name.trim() || name.trim() === entry.name) { setEditing(false); return; }
			const target = await onRenameProject(entry.path, name.trim());
			save(folders.map(folder => ({ ...folder, paths: folder.paths.map(item => item === entry.path ? target : item) })));
			setEditing(false);
		}).finally(() => { renaming.current = false; });
	};
	return (
		<li className="group min-w-0">
			<Button variant="ghost" disabled={busy} aria-label={entry.name}
				onPointerEnter={event => { if (event.pointerType !== "touch") setHovering(true); }}
				onPointerLeave={() => setHovering(false)} onFocus={() => setHovering(true)} onBlur={() => setHovering(false)}
				onClick={() => selecting ? toggleSelected(entry.path) : openEntry(entry)}
				aria-pressed={selecting ? selected.includes(entry.path) : undefined}
				className="relative block h-auto w-full min-w-0 rounded-xl p-0">
				{entry.rawSource ? <RawThumbnail entry={entry.rawSource} active={hovering && !selecting && !busy} /> :
					<ProjectThumbnail key={`${entry.thumbnailPath}-${entry.updatedAt}`} revision={entry.updatedAt}
						path={entry.thumbnailPath} projectPath={entry.path} previewActive={hovering && !selecting && !busy} />}
				{selecting && <span className={`absolute right-2 top-2 flex size-5 items-center justify-center rounded-md ${selected.includes(entry.path) ? "bg-accent text-white" : "bg-background/90"}`}>
					{selected.includes(entry.path) && <Check className="size-3.5" />}
				</span>}
			</Button>
			<div className="relative flex items-start justify-between gap-4 pt-5">
				<div data-project-caption className="h-12 min-w-0 flex-1">
					{editing ? <form onSubmit={event => { event.preventDefault(); rename(); }}>
						<input autoFocus onFocus={event => event.currentTarget.select()}
							aria-label={entry.rawSource ? uiText("rawFileName") : uiText("projectName")}
							className="inline-project-name h-5 w-full pr-8 text-[12px] font-medium"
							value={name} disabled={busy} maxLength={120} onChange={event => setName(event.target.value)}
							onBlur={rename} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setEditing(false); } }} />
					</form> : <p title={entry.name} className="truncate pr-8 text-[12px] font-medium leading-5">{entry.name}</p>}
					<div className="mt-1 flex h-6 min-w-0 items-center gap-2">
						<p className="shrink-0 text-[11px] text-muted-foreground">{new Date(entry.updatedAt).toLocaleDateString(getUiLocale(), {month:"short",day:"numeric"})}</p>
						<ProjectFolderChips folders={assignedFolders} name={entry.name} onRemove={id => assignFolder(entry.path,id)} />
						<Dropdown>
							<Button variant="ghost" size="sm" aria-label={uiText("addFolderToValue", { value0: entry.name })}
								className="h-6 min-w-0 shrink-0 gap-1.5 rounded-full px-2.5 text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100">
								<Plus className="size-3" />{uiText("addFolder")}</Button>
							<Dropdown.Popover><Dropdown.Menu aria-label={uiText("assignProjectFolder")}>
								{folders.map(folder => <Dropdown.Item key={folder.id} id={folder.id} textValue={folder.name} onAction={() => assignFolder(entry.path,folder.id)}>
									<FolderSimple weight="fill" style={{color:folder.color}} />{folder.name}
									{folder.paths.includes(entry.path) && <Check className="size-3" />}
								</Dropdown.Item>)}
								{assignedFolders.length > 0 && <Dropdown.Item id="remove" onAction={() => assignFolder(entry.path,"none")}>{uiText("removeFromAllFolders")}</Dropdown.Item>}
								{!folders.length && <Dropdown.Item id="empty" isDisabled>{uiText("createAFolderInTheSidebar")}</Dropdown.Item>}
							</Dropdown.Menu></Dropdown.Popover>
						</Dropdown>
					</div>
				</div>
				<Dropdown>
					<Button variant="ghost" size="icon" aria-label={uiText("optionsForValue", { value0: entry.name })} className="absolute right-0 top-5 size-6 min-w-6 text-muted-foreground">
						<DotsThree weight="bold" className="size-5" />
					</Button>
					<Dropdown.Popover><Dropdown.Menu aria-label={uiText("projectOptions")}>
						<Dropdown.Item id="open" onAction={() => openEntry(entry)}>{entry.rawSource ? uiText("previewFile") : uiText("openProject")}</Dropdown.Item>
						<Dropdown.Item id="rename" onAction={() => { setName(entry.name); requestAnimationFrame(() => requestAnimationFrame(() => setEditing(true))); }}>{uiText("rename")}</Dropdown.Item>
						<Dropdown.Item id="reveal" aria-label={entry.rawSource ? uiText("showValueInFolder", { value0: entry.name }) : undefined}
							onAction={() => void run(async () => { await window.electronAPI.revealInFolder(entry.path); })}>{uiText("showInFolder")}</Dropdown.Item>
						{onDelete && <Dropdown.Item id="delete" variant="danger" className="text-danger" isDisabled={busy} onAction={onDelete}>
							{entry.rawSource ? uiText("removeFromLibrary") : uiText("deleteProject")}
						</Dropdown.Item>}
					</Dropdown.Menu></Dropdown.Popover>
				</Dropdown>
			</div>
		</li>
	);
}
