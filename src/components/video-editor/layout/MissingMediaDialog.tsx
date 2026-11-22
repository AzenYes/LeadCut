import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUiText } from "@/i18n/useUiText";
import type { MediaRelinkMapping, ProjectMediaReference } from "../projectRelink";

export function MissingMediaDialog({ references, onCancel, onConfirm }: {
	references: ProjectMediaReference[];
	onCancel: () => void;
	onConfirm: (mapping: MediaRelinkMapping) => Promise<void>;
}) {
	const uiText = useUiText();
	const [mapping, setMapping] = useState<MediaRelinkMapping>({});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [ambiguous, setAmbiguous] = useState<string[]>([]);
	const [warnSidecars, setWarnSidecars] = useState(false);
	const mainPath = references.find(({ kind }) => kind === "video")?.path;
	const basename = (path: string) => path.split(/[\\/]/).pop() ?? path;
	const mapped = new Map(Object.entries(mapping));
	const mappedPath = (path: string) => mapped.get(path);
	const perform = async (action: () => Promise<void>) => {
		setError(null);
		setBusy(true);
		try {
			await action();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setBusy(false);
		}
	};
	const chooseFile = (reference: ProjectMediaReference) => perform(async () => {
		const file = await window.electronAPI.pickRelinkMedia(reference.kind);
		if (file.canceled) return;
		if (!file.success || !file.path) throw new Error(file.message || uiText("relinkChooseFile"));
		const replacement = file.path;
		setMapping(previous => ({ ...previous, [reference.path]: replacement }));
		if (reference.path === mainPath) setWarnSidecars(false);
	});
	const matchFolder = () => perform(async () => {
		const folder = await window.electronAPI.pickRelinkMediaFolder();
		if (folder.canceled) return;
		if (!folder.success || !folder.path) throw new Error(folder.message || uiText("relinkFindInFolder"));
		const unresolved = references.filter(({ path }) => mappedPath(path) === undefined);
		const result = await window.electronAPI.matchMediaInFolder(folder.path, unresolved.map(({ path }) => basename(path)));
		if (!result.success) throw new Error(result.message || uiText("relinkFindInFolder"));
		setAmbiguous(result.ambiguous ?? []);
		const matches = new Map(Object.entries(result.matches ?? {}));
		const replacements = Object.fromEntries(unresolved.flatMap(({ path }) => {
			const match = matches.get(basename(path));
			return match ? [[path, match]] : [];
		}));
		setMapping(previous => ({ ...previous, ...replacements }));
		if (mainPath && replacements[mainPath]) setWarnSidecars(result.withoutSidecars?.includes(basename(mainPath)) ?? false);
		if (!Object.keys(replacements).length && !result.ambiguous?.length) setError(uiText("relinkNoMatches"));
	});
	const confirm = () => perform(async () => {
		if (references.some(({ path }) => mappedPath(path) === undefined)) {
			throw new Error(uiText("relinkResolveAll"));
		}
		await onConfirm(mapping);
	});

	return (
		<Dialog open onOpenChange={open => { if (!open && !busy) onCancel(); }}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>{uiText("relinkMissingMedia")}</DialogTitle>
					<DialogDescription>{uiText("relinkMissingMediaDescription")}</DialogDescription>
				</DialogHeader>
				<ul className="my-2 max-h-[42vh] space-y-2 overflow-y-auto">
					{references.map((reference, index) => (
						<li key={`${reference.kind}:${reference.refId ?? index}:${reference.path}`} className="rounded-md border border-border p-3" data-testid="missing-media-item">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<span className="text-sm font-medium">{uiText(`relinkMediaKind_${reference.kind}`)}</span>
								<div className="flex gap-2">
									<Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void chooseFile(reference)}>
										{uiText("relinkChooseFile")}
									</Button>
									{reference.path !== mainPath && (
										<Button type="button" variant="ghost" size="sm" disabled={busy} aria-pressed={mappedPath(reference.path) === null}
											onClick={() => setMapping(previous => ({ ...previous, [reference.path]: null }))}>
											{uiText("relinkSkip")}
										</Button>
									)}
								</div>
							</div>
							<div className="mt-1 break-all text-xs text-muted-foreground">{reference.path}</div>
							{mappedPath(reference.path) !== undefined && (
								<div className="mt-1 break-all text-xs text-foreground">
									{mappedPath(reference.path) ?? uiText("relinkWillRemove")}
								</div>
							)}
						</li>
					))}
				</ul>
				{ambiguous.length > 0 && <p className="text-xs text-muted-foreground">{uiText("relinkAmbiguousNames", { value0: ambiguous.join(", ") })}</p>}
				{warnSidecars && <p className="text-xs text-muted-foreground">{uiText("relinkMissingSidecars")}</p>}
				{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
				<DialogFooter>
					<Button type="button" variant="outline" disabled={busy || references.every(({ path }) => mappedPath(path) !== undefined)} onClick={() => void matchFolder()}>{uiText("relinkFindInFolder")}</Button>
					<Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>{uiText("cancel")}</Button>
					<Button type="button" disabled={busy || Boolean(mainPath && !mappedPath(mainPath))} onClick={() => void confirm()}>{uiText("relinkConfirm")}</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
