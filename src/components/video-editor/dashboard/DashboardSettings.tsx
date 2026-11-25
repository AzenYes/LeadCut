import { useUiText } from "@/i18n/useUiText";
import { SettingsSections, SettingsCategory } from "../SettingsSections";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { SettingsRow } from "../SettingsRow";
import { Switch } from "@/components/ui/switch";
import { supportsHudCaptureProtection } from "@/lib/hudCaptureProtection";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { moveProjectFolderReferences } from "./useProjectFolders";
export const DashboardSettingsContext = createContext<ReactNode>(null);
export function DashboardSettings({ onImportFile, legacyCount, refreshProjects }: {
	onImportFile: () => Promise<void>;
	legacyCount: number;
	refreshProjects?: () => Promise<void>;
}) {
	const uiText = useUiText();
	const t = useScopedT("settings");
	const { t: translate } = useI18n();
	const upstreamUrl = t("about.upstreamLink");
	const settingsContent = useContext(DashboardSettingsContext);
	const [directory, setDirectory] = useState("");
	const [recordings, setRecordings] = useState("");
	const [hideHud, setHideHud] = useState(true);
	const [captureSupported, setCaptureSupported] = useState(false);
	const [busy, setBusy] = useState(false);
	const [confirmConversion, setConfirmConversion] = useState(false);
	const [configuredAgent, setConfiguredAgent] = useState<"codex" | "claude" | null>(null);
	const run = async (action: () => Promise<void>) => {
		setBusy(true);
		try {
			await action();
		} catch (error) {
			toast.error(String(error));
		} finally {
			setBusy(false);
		}
	};
	const convertProjects = () => run(async () => {
		const result = await window.electronAPI.convertLegacyProjectFiles();
		setConfirmConversion(false);
		for (const { from, to } of result.converted) {
			try {
				moveProjectFolderReferences(from, to);
			} catch {
				toast.warning(uiText("projectRenamedButLibraryPreferencesCouldNotBeUpdated"));
			}
		}
		await refreshProjects?.();
		const summary = uiText("legacyProjectConversionSummary", { value0: result.converted.length, value1: result.errors.length });
		if (result.errors.length) {
			toast.error(summary, {
				description: <ul>{result.errors.map(error => <li key={error.path}>{error.path} · {error.message}</li>)}</ul>,
			});
		} else {
			toast.success(summary);
		}
	});
	const connectAgent = (agent: "codex" | "claude") => run(async () => {
		const result = await window.electronAPI.configureLeadCutAgent(agent);
		if (!result.success) {
			toast.error(uiText("leadcutAgentSetupFailed"));
			return;
		}
		setConfiguredAgent(agent);
		toast.success(uiText("leadcutAgentSetupComplete"));
	});
	useEffect(() => {
		let active = true;
		void Promise.all([
			window.electronAPI.getRecordingsDirectory(),
			window.electronAPI.getHudOverlayCaptureProtection(),
			window.electronAPI.getPlatform(),
		])
			.then(([directory, protection, platform]) => {
				if (!active) return;
				if (directory.success) setRecordings(directory.path);
				if (protection.success) setHideHud(protection.enabled);
				setCaptureSupported(supportsHudCaptureProtection(platform));
			})
			.catch((error) => toast.error(String(error)));
		return () => {
			active = false;
		};
	}, []);
	return (
		<section aria-label={uiText("dashboardSettings")} className="dashboard-settings max-w-2xl py-10">
			<h1 className="text-lg font-semibold">{translate("common.interface.applicationSettings")}</h1>
			<p className="mt-1 mb-8 text-sm text-muted-foreground">{translate("common.interface.settingsScopeApplication")}</p>
			<SettingsSections categories={["general", "motion", "recording", "files", "advanced"]}>
				<SettingsCategory category={["general", "motion", "advanced"]}>
					{settingsContent}
				</SettingsCategory>
				{Boolean(window.electronAPI.configureLeadCutAgent) && (
					<SettingsCategory category="advanced">
						<SettingsRow title={uiText("leadcutAgentSetup")} description={configuredAgent ? uiText("leadcutAgentSetupComplete") : undefined}>
							<div className="flex gap-2">
								<Button variant="secondary" size="sm" disabled={busy} onClick={() => void connectAgent("codex")}>Codex</Button>
								<Button variant="secondary" size="sm" disabled={busy} onClick={() => void connectAgent("claude")}>Claude Code</Button>
							</div>
						</SettingsRow>
					</SettingsCategory>
				)}
				<SettingsCategory category="files">
					<SettingsRow title={uiText("openVideoOrProject")}>
						<Button
							variant="secondary"
							size="sm"
							disabled={busy}
							onClick={() => void run(onImportFile)}
						>
							{uiText("openFile")}</Button>
					</SettingsRow>
				</SettingsCategory>
				<SettingsCategory category="recording">
					<SettingsRow
						title={uiText("recordingsFolder")}
						description={
							<span className="block truncate" title={recordings}>
								{recordings}
							</span>
						}
					>
						<Button
							variant="secondary"
							size="sm"
							disabled={busy}
							onClick={() =>
								void run(async () => {
									const result =
										await window.electronAPI.chooseRecordingsDirectory();
									if (result.canceled) return;
									if (!result.success || !result.path)
										throw Error(uiText("couldNotChangeRecordingsFolder"));
									setRecordings(result.path);
								})
							}
						>
							{uiText("changeFolder")}</Button>
					</SettingsRow>
					{captureSupported && (
						<SettingsRow
							title={uiText("hideHUDFromRecordings")}
							description="Only while recording. The idle HUD stays visible in captures."
						>
							<Switch
								aria-label={uiText("hideHUDFromRecordings")}
								checked={hideHud}
								disabled={busy}
								onCheckedChange={(enabled) =>
									void run(async () => {
										const result =
											await window.electronAPI.setHudOverlayCaptureProtection(
												enabled,
											);
										if (!result.success)
											throw Error(uiText("couldNotUpdateCaptureProtection"));
										setHideHud(result.enabled);
									})
								}
							/>
						</SettingsRow>
					)}
				</SettingsCategory>
				<SettingsCategory category="advanced">
					{import.meta.env.DEV && (
						<SettingsRow title={uiText("previewUpdateUI")}>
							<Button
								variant="secondary"
								size="sm"
								disabled={busy}
								onClick={() =>
									void run(async () => {
										await window.electronAPI.previewUpdateToast();
									})
								}
							>
								{uiText("preview")}</Button>
						</SettingsRow>
					)}
				</SettingsCategory>
				<SettingsCategory category="files">
					{legacyCount > 0 && (
						<SettingsRow title={uiText("legacyProjectFiles")}>
							<Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirmConversion(true)}>
								{uiText("convertAllLegacyProjects")}
							</Button>
						</SettingsRow>
					)}
					<SettingsRow
						title={uiText("projectsFolder")}
						description={directory || uiText("namedProjectsSaveAutomatically")}
					>
						<Button
							variant="secondary"
							size="sm"
							onClick={async () => {
								try {
									const result = await window.electronAPI.getProjectsDirectory();
									if (!result.success || !result.path)
										throw Error(uiText("couldNotOpenProjectsFolder"));
									setDirectory(result.path);
									await window.electronAPI.revealInFolder(result.path);
								} catch (e) {
									toast.error(String(e));
								}
							}}
						>
							{uiText("showFolder")}</Button>
					</SettingsRow>
					<p className="text-xs text-muted-foreground">
						{uiText("namedProjectsSaveAutomaticallyPreviewsRefreshWhenYouReturnToProjects")}</p>
				</SettingsCategory>
			</SettingsSections>
			<section aria-labelledby="dashboard-about-heading" className="mt-10 space-y-2 border-t border-foreground/10 pt-6 text-sm">
				<h2 id="dashboard-about-heading" className="font-semibold">{t("about.heading")}</h2>
				<p className="text-muted-foreground">{t("about.description")}</p>
				<a
					href={upstreamUrl}
					className="break-all text-accent underline underline-offset-4"
					onClick={(event) => {
						event.preventDefault();
						void run(async () => {
							const result = await window.electronAPI.openExternalUrl(upstreamUrl);
							if (!result.success) throw Error(result.error ?? uiText("couldNotOpenLink"));
						});
					}}
				>
					{upstreamUrl}
				</a>
			</section>
			<Dialog open={confirmConversion} onOpenChange={open => { if (!busy) setConfirmConversion(open); }}>
				<DialogContent className="max-w-lg">
					<DialogHeader><DialogTitle>{uiText("convertAllLegacyProjects")}</DialogTitle></DialogHeader>
					<DialogDescription>{uiText("convertLegacyProjectsConfirm", { value0: legacyCount })}</DialogDescription>
					<DialogFooter>
						<Button autoFocus variant="secondary" disabled={busy} onClick={() => setConfirmConversion(false)}>{uiText("cancel")}</Button>
						<Button disabled={busy} onClick={() => void convertProjects()}>{uiText("convertLegacyProjectsAction")}</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}
