import { ONBOARDING_SEEN_STORAGE_KEY } from "@/lib/storageKeys";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverArrow, PopoverContent } from "@/components/ui/popover";
import { useI18n } from "@/contexts/I18nContext";

const editorSteps = [
	{ target: "split", label: "editor.toolbar.splitClip", description: "splitHint", side: "top" },
	{ target: "zoom", label: "timeline.zoom.addZoom", description: "zoomHint", side: "top" },
	{ target: "captions", label: "settings.sections.captions", description: "captionsHint", side: "right" },
	{ target: "export", label: "editor.actions.exportVideo", description: "exportHint", side: "bottom" },
] as const;

export function OnboardingController({
	requestNonce,
	ready,
	canGuide,
}: {
	requestNonce: number;
	ready: boolean;
	canGuide: boolean;
}) {
	const { t } = useI18n();
	const [seen, setSeen] = useState(() => loadAppSetting<true | "intro">(ONBOARDING_SEEN_STORAGE_KEY));
	const [tour, setTour] = useState<"intro" | "editor" | null>(null);
	const [stepIndex, setStepIndex] = useState(0);
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);
	const handledRequest = useRef(0);
	const step = editorSteps[stepIndex];
	const guided = tour === "editor";
	const anchorRef = useMemo(() => ({ current: anchor }), [anchor]);

	useEffect(() => {
		if (!ready || tour === "editor" || seen === true) return;
		if (canGuide) setTour("editor");
		else if (!seen && !tour) setTour("intro");
	}, [canGuide, ready, seen, tour]);

	useEffect(() => {
		if (!ready || handledRequest.current === requestNonce) return;
		handledRequest.current = requestNonce;
		setStepIndex(0);
		setTour(canGuide ? "editor" : "intro");
	}, [canGuide, ready, requestNonce]);

	useLayoutEffect(() => {
		const element = guided && canGuide
			? document.querySelector<HTMLElement>(`[data-onboarding-target="${step.target}"]`)
			: null;
		const visible = element?.getClientRects().length ? element : null;
		setAnchor(visible);
		if (!visible) return;
		visible.dataset.onboardingActive = "";
		return () => { delete visible.dataset.onboardingActive; };
	}, [canGuide, guided, step.target]);

	const close = () => {
		if (!tour) return;
		const nextSeen = guided || seen === true ? true : "intro";
		saveAppSetting(ONBOARDING_SEEN_STORAGE_KEY, nextSeen);
		setSeen(nextSeen);
		setTour(null);
		setStepIndex(0);
	};

	if (!tour) return null;
	const title = t("editor.localOnboarding.title");
	const onOpenChange = (open: boolean) => { if (!open) close(); };
	const guideContent = (
		<div className="space-y-3">
			<div className="text-xs tabular-nums text-muted-foreground">
				{t("editor.localOnboarding.stepCount", undefined, { current: stepIndex + 1, total: editorSteps.length })}
			</div>
			<h2 className="text-sm font-semibold" data-onboarding-step={step.target}>{t(step.label)}</h2>
			<p className="text-sm text-muted-foreground">{t(`editor.localOnboarding.${step.description}`)}</p>
			<div className="flex flex-wrap items-center justify-end gap-2">
				<Button size="sm" variant="ghost" className="mr-auto" onClick={close}>
					{t("editor.localOnboarding.skip")}
				</Button>
				{stepIndex > 0 && <Button size="sm" variant="ghost" onClick={() => setStepIndex(stepIndex - 1)}>
					{t("editor.localOnboarding.previous")}
				</Button>}
				{stepIndex < editorSteps.length - 1 ? (
					<Button size="sm" onClick={() => setStepIndex(stepIndex + 1)}>{t("editor.localOnboarding.next")}</Button>
				) : (
					<Button size="sm" onClick={close}>{t("common.actions.done")}</Button>
				)}
			</div>
		</div>
	);

	if (guided && anchor) {
		return (
			<Popover open onOpenChange={onOpenChange} modal={false}>
				<PopoverContent triggerRef={anchorRef} aria-label={title} side={step.side} className="w-[320px]">
					<PopoverArrow />
					{guideContent}
				</PopoverContent>
			</Popover>
		);
	}

	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent aria-label={title}>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{t("editor.localOnboarding.description")}</DialogDescription>
				</DialogHeader>
				{guided ? guideContent : <>
					<p className="py-2 text-sm">{t("editor.localOnboarding.record")}</p>
					<DialogFooter><Button onClick={close}>{t("editor.localOnboarding.start")}</Button></DialogFooter>
				</>}
			</DialogContent>
		</Dialog>
	);
}
