import { Button } from "@/components/ui/button";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import type { ExportPreflightIssue } from "../export/exportPreflight";
import type { useExportPreflight } from "../export/useExportPreflight";

export function ExportPreflightPanel({ issues, preflight, onCancel }: {
	issues: ExportPreflightIssue[];
	preflight: ReturnType<typeof useExportPreflight>;
	onCancel: () => void;
}) {
	const t = useScopedT("settings");
	const { locale } = useI18n();
	const chapters = issues.find(issue => issue.kind === "chapters");
	const captionFont = issues.find(issue => issue.kind === "captionFont");
	const keystrokeFont = issues.find(issue => issue.kind === "keystrokeFont");
	const disk = issues.filter(issue => issue.kind === "diskSpace");
	const size = (bytes: number) => (bytes / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 1 });
	return (
		<section aria-label={t("export.preflight.title", "Export checks")} className="space-y-4 px-5 pb-5 text-sm">
			{chapters && (
				<div className="space-y-2">
					<p>{chapters.status === "draft"
						? t("export.preflight.chapterDraft", "Chapters need confirmation before export.")
						: t("export.preflight.chapterStale", "The timeline has changed since you confirmed the chapters.")}</p>
					<p className="text-xs text-muted-foreground">{t("export.preflight.chapterUndo", "Turning off chapters saves a project change you can undo.")}</p>
					<div className="flex flex-wrap gap-2">
						<Button variant="outline" onClick={() => { onCancel(); preflight.reviewChapters(); }}>{t("export.preflight.review", "Review chapters")}</Button>
						<Button onClick={() => preflight.resolve("chapters")}>{t("export.preflight.disableChapters", "Turn off chapters and export")}</Button>
					</div>
				</div>
			)}
			{captionFont && (
				<div className="space-y-2">
					<p>{t("export.preflight.fontMissing", "{{font}} is unavailable. Captions will use {{fallback}}.", {
						font: captionFont.fontName, fallback: captionFont.fallbackName,
					})}</p>
					<Button onClick={() => preflight.resolve("captionFont")}>{t("export.preflight.continue", "Export anyway")}</Button>
				</div>
			)}
			{keystrokeFont && (
				<div className="space-y-2">
					<p>{t("export.preflight.keystrokeFontMissing", "{{font}} is unavailable. Keystrokes will use {{fallback}}.", {
						font: keystrokeFont.fontName, fallback: keystrokeFont.fallbackName,
					})}</p>
					<Button onClick={() => preflight.resolve("keystrokeFont")}>{t("export.preflight.continue", "Export anyway")}</Button>
				</div>
			)}
			{disk.length > 0 && (
				<div className="space-y-2">
					{disk.map(issue => <p key={issue.location}>{issue.location === "target"
						? t("export.preflight.targetSpace", "Export folder has {{free}} MB free. Allow {{needed}} MB.", { free: size(issue.freeBytes), needed: size(issue.neededBytes) })
						: t("export.preflight.tempSpace", "Temporary folder has {{free}} MB free. Allow {{needed}} MB.", { free: size(issue.freeBytes), needed: size(issue.neededBytes) })}</p>)}
					<div className="flex flex-wrap gap-2">
						<Button variant="outline" disabled={preflight.isChecking} onClick={preflight.chooseAnotherDestination}>{t("export.preflight.changeFolder", "Choose another location")}</Button>
						<Button disabled={preflight.isChecking} onClick={() => preflight.resolve("diskSpace")}>{t("export.preflight.continue", "Export anyway")}</Button>
					</div>
				</div>
			)}
			<Button variant="ghost" onClick={onCancel}>{t("export.preflight.cancel", "Cancel")}</Button>
		</section>
	);
}
