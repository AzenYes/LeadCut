import { ONBOARDING_SEEN_STORAGE_KEY } from "@/lib/storageKeys";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useI18n } from "@/contexts/I18nContext";


export function OnboardingController({
	requestNonce,
	ready,
}: {
	requestNonce: number;
	ready: boolean;
}) {
	const { t } = useI18n();
	const [open, setOpen] = useState(false);
	const checked = useRef(false);
	useEffect(() => {
		if (requestNonce > 0) setOpen(true);
	}, [requestNonce]);
	const close = useCallback(() => {
		saveAppSetting(ONBOARDING_SEEN_STORAGE_KEY, true);
		setOpen(false);
	}, []);

	useEffect(() => {
		if (!ready || checked.current) return;
		checked.current = true;
		if (!loadAppSetting<boolean>(ONBOARDING_SEEN_STORAGE_KEY)) setOpen(true);
	}, [ready]);

	return (
		<Dialog
			open={open}
			onOpenChange={(value) => {
				if (!value) close();
			}}
		>
			<DialogContent aria-label={t("editor.localOnboarding.title", "Welcome to LeadCut")}>
				<DialogHeader>
					<DialogTitle>{t("editor.localOnboarding.title", "Welcome to LeadCut")}</DialogTitle>
					<DialogDescription>{t("editor.localOnboarding.description", "Record, edit, and save your videos on this computer.")}</DialogDescription>
				</DialogHeader>
				<ol className="list-decimal space-y-4 pl-5 py-4 text-sm">
					<li>{t("editor.localOnboarding.record", "Record your screen, or open a video or an existing project.")}</li>
					<li>{t("editor.localOnboarding.edit", "Trim clips, adjust zoom and backgrounds, and generate or import subtitles.")}</li>
					<li>{t("editor.localOnboarding.save", "Save your editable project and export MP4 or GIF files to your computer.")}</li>
				</ol>
				<DialogFooter><Button onClick={close}>{t("editor.localOnboarding.start", "Get started")}</Button></DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
