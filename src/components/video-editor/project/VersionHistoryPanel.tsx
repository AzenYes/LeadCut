import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/contexts/I18nContext";
import type { ProjectVersionEntry } from "@/types/projectVersion";
import type { useProjectVersionHistory } from "./useProjectVersionHistory";

const sourceLabel: Record<ProjectVersionEntry["source"], string> = {
	agent: "versionHistoryAgent",
	app: "versionHistoryApp",
	"before-restore": "versionHistoryBeforeRestore",
};

function formatDuration(ms: number) {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const tail = String(seconds % 60).padStart(2, "0");
	if (minutes < 60) return `${minutes}:${tail}`;
	return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${tail}`;
}

type Props = { history: ReturnType<typeof useProjectVersionHistory> };

export function VersionHistoryPanel({ history }: Props) {
	const { locale, t } = useI18n();
	if (!history.open) return null;
	const text = (key: string, vars?: Record<string, string>) => t(`common.interface.${key}`, undefined, vars);
	const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" });
	return (
		<Dialog open onOpenChange={open => { if (!open) history.close(); }}>
			<DialogContent className="max-w-2xl">
				<DialogHeader><DialogTitle>{text("versionHistoryTitle")}</DialogTitle></DialogHeader>
				{history.error && <p role="alert" className="text-sm text-destructive">{history.error}</p>}
				{!history.versions.length && !history.error && (
					<p role="status" className="text-sm text-muted-foreground">
						{history.busy ? text("versionHistoryLoading") : text("versionHistoryEmpty")}
					</p>
				)}
				<ul className="max-h-[55vh] divide-y divide-separator overflow-y-auto" aria-label={text("versionHistoryTitle")}>
					{history.versions.map(version => (
						<li key={version.path} className="flex flex-wrap items-center justify-between gap-3 py-3">
							<div className="grid gap-1 text-sm">
								<time dateTime={new Date(version.createdAt).toISOString()}>{date.format(version.createdAt)}</time>
								<div className="flex gap-3 text-xs text-muted-foreground">
									<span>{text(sourceLabel[version.source])}</span>
									<span>{text("versionHistoryDuration", { duration: formatDuration(version.durationMs) })}</span>
								</div>
							</div>
							<div className="flex gap-1">
								<Button size="sm" variant="ghost" disabled={history.busy} onClick={() => void history.preview(version)}>{text("versionHistoryPreview")}</Button>
								<Button size="sm" variant="secondary" disabled={history.busy} onClick={() => void history.restore(version)}>{text("versionHistoryRestore")}</Button>
								<Button size="sm" variant="ghost" disabled={history.busy} onClick={() => void history.remove(version)}>{text("versionHistoryDelete")}</Button>
							</div>
						</li>
					))}
				</ul>
			</DialogContent>
		</Dialog>
	);
}

export function VersionPreviewBanner({ history }: Props) {
	const { t } = useI18n();
	const version = history.selected;
	if (!version) return null;
	return (
		<div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-separator bg-accent/10 px-4 py-1.5">
			<span role="status" className="mr-auto text-sm font-medium">{t("common.interface.versionHistoryPreviewBanner")}</span>
			<Button size="sm" variant="secondary" disabled={history.busy} onClick={() => void history.restore(version)}>
				{t("common.interface.versionHistoryRestoreSelected")}
			</Button>
			<Button size="sm" variant="ghost" disabled={history.busy} onClick={() => void history.returnToCurrent()}>
				{t("common.interface.versionHistoryReturn")}
			</Button>
		</div>
	);
}
