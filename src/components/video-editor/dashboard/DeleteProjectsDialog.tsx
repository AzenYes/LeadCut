import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useUiText } from "@/i18n/useUiText";
import type { DashboardModel } from "./useDashboardModel";

export function DeleteProjectsDialog({ model }: { model: DashboardModel }) {
	const text = useUiText();
	const pending = model.pendingDelete;
	return <Dialog open={!!pending} onOpenChange={(open) => { if (!open) model.cancelDelete(); }}>
		<DialogContent aria-label={text("deleteConfirmTitle")} className="max-w-lg">
			<DialogHeader><DialogTitle>{text("deleteConfirmTitle")}</DialogTitle></DialogHeader>
			<DialogDescription>{text(pending?.raw ? "deleteRawScope" : "deleteProjectScope", { count: pending?.entries.length ?? 0 })}</DialogDescription>
			<ul className="max-h-48 overflow-y-auto space-y-2 text-sm" aria-label={text("deleteSelectedItems")}>
				{pending?.entries.map((entry) => <li key={entry.path} className="break-words" title={entry.path}>{entry.name}</li>)}
			</ul>
			{pending?.entries.some((entry) => entry.isCurrent) && <p className="text-sm text-warning">{text("deleteCurrentWarning")}</p>}
			{model.deleteError && <p role="alert" className="text-sm text-danger whitespace-pre-wrap break-words">{model.deleteError}</p>}
			<DialogFooter>
				<Button autoFocus variant="secondary" disabled={model.busy} onClick={model.cancelDelete}>{text("cancel")}</Button>
				<Button variant="destructive" disabled={model.busy} onClick={() => void model.confirmDelete()}>{text(model.busy ? "deleteWorking" : pending?.raw ? "deleteConfirmRemove" : "deleteConfirmAction")}</Button>
			</DialogFooter>
		</DialogContent>
	</Dialog>;
}
