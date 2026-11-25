import { useInspectorLayout } from "./useInspectorLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useUiText } from "@/i18n/useUiText";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import { ADVANCED_SECTIONS_STORAGE_KEY } from "@/lib/storageKeys";
import { Camera, ClosedCaptioning, Cursor, Gear, FrameCorners, BookmarkSimple, Check, File, TextT, CaretDown, Keyboard, X } from "@/components/ui/icons";
import {
	ToggleButtonGroup,
	ToggleButton,
	Tooltip,
	Card,
	Switch,
	Label,
} from "@heroui/react";
import type { ComponentProps, ReactNode } from "react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { useI18n } from "@/contexts/I18nContext";
import ExtensionManager from "../ExtensionManager";
import type { SettingsPanel } from "../SettingsPanel";
import type { EditorEffectSection } from "../types";

const DeferredSettingsPanel = lazy(async () => ({ default: (await import("../SettingsPanel")).SettingsPanel }));

export function EditorSettingsPanel(props: ComponentProps<typeof SettingsPanel>) {
	return (
		<Suspense fallback={<Skeleton className="mx-4 my-3 h-36" />}>
			<DeferredSettingsPanel {...props} />
		</Suspense>
	);
}

function loadAdvancedSections(): Partial<Record<string, boolean>> {
	const current = loadAppSetting<unknown>(ADVANCED_SECTIONS_STORAGE_KEY);
	return current && typeof current === "object" && !Array.isArray(current)
		? Object.fromEntries(Object.entries(current).filter(([, value]) => typeof value === "boolean"))
		: {};
}

type Props = {
	readOnly?: boolean;
	deferPanels?: boolean;
	panelContent?: ReactNode;
	panelKey?: string;
	t: ReturnType<typeof useI18n>["t"];
	activeSection: EditorEffectSection;
	setActiveSection: (section: EditorEffectSection) => void;
	settingsPanelProps: ComponentProps<typeof SettingsPanel>;
	selectedCaptionId: string | null;
};

export function EditorSidebar({
	t,
	activeSection,
	setActiveSection,
	settingsPanelProps,
	selectedCaptionId,
	panelContent,
	panelKey,
	readOnly,
	deferPanels,
}: Props) {
	const text = useUiText();
	const layout = useInspectorLayout(panelKey === "captionList");
	const showSelectedTool = !panelContent || panelKey === "chapters" || panelKey === "keystrokes" || panelKey === "captionList" || panelKey === "review";
	const asideRef = useRef<HTMLElement>(null);
	const toggleRef = useRef<HTMLButtonElement>(null);
	const [inspectorRequested, setInspectorRequested] = useState(false);
	const loadPanels = !deferPanels || inspectorRequested;
	useEffect(() => {
		if (!deferPanels) setInspectorRequested(true);
	}, [deferPanels]);
	const closePanel = () => { layout.setOpen(false); toggleRef.current?.focus(); };
	const selectionKey = [panelKey, settingsPanelProps.selectedAnnotationId, settingsPanelProps.selectedClipId, selectedCaptionId].join(":");
	const previousSelection = useRef(selectionKey);
	useEffect(() => {
		if (previousSelection.current !== selectionKey) {
			previousSelection.current = selectionKey;
			layout.setOpen(true);
		}
	}, [selectionKey, layout]);
	const [advancedSections, setAdvancedSections] = useState(loadAdvancedSections);
	const advanced = advancedSections[activeSection] ?? false;
	const hasAdvanced =
		!settingsPanelProps.selectedAnnotationId &&
		["scene", "frame", "crop", "cursor", "webcam", "captions", "settings", "zoom"].includes(
			activeSection,
		);
	const sections = useMemo(
		() => [
			{
				id: "scene" as const,
				label: t("settings.sections.scene", "Scene"),
				icon: FrameCorners,
			},
			{ id: "cursor" as const, label: t("settings.sections.cursor", "Cursor"), icon: Cursor },
			{ id: "chapters" as const, label: t("editor.chapters.title", "Chapters"), icon: BookmarkSimple },
			{ id: "keystrokes" as const, label: t("editor.keystrokes.title", "Keystroke display"), icon: Keyboard },
			{ id: "webcam" as const, label: t("settings.sections.webcam", "Webcam"), icon: Camera },
			{
				id: "captions" as const,
				label: t("settings.sections.captions", "Captions"),
				icon: ClosedCaptioning,
			},
			{ id: "captionList" as const, label: t("common.interface.captionOverviewTitle"), icon: File },
			{ id: "review" as const, label: t("common.interface.reviewTitle"), icon: Check },
			{
				id: "settings" as const,
				label: t("settings.general.motion", "Motion"),
				icon: Gear,
			},
		],
		[t],
	);
	return (
		<div className="editor-sidebar relative flex min-h-0 shrink-0 pb-3 pr-2" data-compact={layout.compact} data-expanded={layout.open} inert={readOnly}>
			
			<nav
				aria-label={t("settings.sections.title", "Editor tools")}
				className={`flex shrink-0 flex-col items-center gap-2 py-2.5 overflow-y-auto ${layout.preferences.labels && !layout.compact ? "w-28" : "w-16"}`}
			>
				<Button ref={toggleRef} variant="ghost" size="icon" aria-label={text(layout.open ? "inspectorCollapse" : "inspectorExpand")}
					aria-expanded={layout.open} aria-controls="editor-inspector" onClick={() => {
						if (!layout.open) setInspectorRequested(true);
						layout.setOpen(!layout.open);
					}}>
					<CaretDown className={`size-4 ${layout.open ? "rotate-90" : "-rotate-90"}`} />
				</Button>
				<ToggleButtonGroup
					orientation="vertical"
					isDetached
					className="w-full items-center gap-2"
					selectionMode="single"
					disallowEmptySelection
					selectedKeys={showSelectedTool ? [activeSection] : []}
					onSelectionChange={(keys) => {
						const key = Array.from(keys)[0];
						if (key) setActiveSection(key as EditorEffectSection);
					}}
				>
					{sections.map((section) => (
						<Tooltip key={section.id}>
							<ToggleButton
								id={section.id}
								variant="ghost"
								isIconOnly={!layout.preferences.labels || layout.compact}
								onPress={() => { setInspectorRequested(true); layout.setOpen(true); }}
								data-onboarding-target={section.id === "captions" ? "captions" : undefined}
								className={`data-[onboarding-active]:ring-2 data-[onboarding-active]:ring-accent ${layout.preferences.labels && !layout.compact ? "w-24 justify-start gap-2" : ""}`}
								aria-label={section.label}
							>
								<section.icon
									weight={
										showSelectedTool && activeSection === section.id
											? "fill"
											: "regular"
									}
									className="size-5"
								/>
								{layout.preferences.labels && !layout.compact && <span className="text-xs">{section.label}</span>}
							</ToggleButton>
							<Tooltip.Content placement="right">{section.label}</Tooltip.Content>
						</Tooltip>
					))}
				</ToggleButtonGroup>
				<Button variant="ghost" size="icon" className="mt-auto shrink-0" aria-label={text("inspectorLabels")}
					title={text("inspectorLabels")} aria-pressed={layout.preferences.labels} disabled={layout.compact}
					onClick={() => layout.update({ labels: !layout.preferences.labels })}><TextT className="size-4" /></Button>
			</nav>
			<aside id="editor-inspector" ref={asideRef} hidden={!layout.open}
				aria-label={text("inspectorPanel")}
				onKeyDown={(event) => { if (event.key === "Escape" && layout.compact) { event.stopPropagation(); closePanel(); } }}
				style={{ width: layout.preferences.width, display: layout.open ? undefined : "none" }}
				className={`editor-inspector [--text-sm:0.8125rem] [--text-base:0.8125rem] flex min-h-0 flex-col ${layout.compact ? "absolute left-16 top-0 bottom-3 z-40 max-w-[calc(100vw-88px)] shadow-xl" : "relative"}`}
			>
				<Card className="min-h-0 flex-1 gap-0 overflow-hidden p-0">
					{layout.compact && <div className="flex justify-end border-b border-separator px-2 py-1">
						<Button variant="ghost" size="icon" aria-label={text("inspectorCollapse")} onClick={closePanel}><X className="size-4" /></Button>
					</div>}
					{panelContent ?? (
						<>
							<header className="flex min-h-14 shrink-0 items-center justify-between gap-3 px-5 py-3">
								<div className="min-w-0">
									<Card.Title className="text-[14px]">
									{settingsPanelProps.selectedAnnotationId
										? t("timeline.annotation.label", "Annotation")
										: (sections.find((section) => section.id === activeSection)
												?.label ??
											t(
												`settings.sections.${activeSection}`,
												activeSection.charAt(0).toUpperCase() +
													activeSection.slice(1),
											))}
									</Card.Title>
									<p className="mt-0.5 text-xs text-muted-foreground">
										{t(settingsPanelProps.selectedAnnotationId || ["zoom", "clip", "audio"].includes(activeSection)
											? "common.interface.settingsScopeSelectedItem"
											: "common.interface.settingsScopeProject")}
									</p>
								</div>
								{hasAdvanced && (
									<Switch
										size="sm"
										isSelected={advanced}
									onChange={(value) => {
										const next = { ...advancedSections, [activeSection]: value };
										setAdvancedSections(next);
										saveAppSetting(ADVANCED_SECTIONS_STORAGE_KEY, next);
									}}
										aria-label={t(
											"settings.sections.advancedSettings",
											"Advanced settings",
										)}
									>
										<Switch.Content>
											<Label className="text-xs">
												{t("settings.sections.advanced", "Advanced")}
											</Label>
											<Switch.Control>
												<Switch.Thumb />
											</Switch.Control>
										</Switch.Content>
									</Switch>
								)}
							</header>
							{!loadPanels ? <Skeleton className="mx-4 my-3 h-36" /> : activeSection === "extensions" ? (
								<ExtensionManager />
							) : (
								<EditorSettingsPanel {...settingsPanelProps} advanced={advanced} />
							)}
						</>
					)}
				</Card>
				{!layout.compact && <button type="button" role="separator" aria-label={text("inspectorWidth")}
					aria-orientation="vertical" aria-valuemin={layout.minWidth} aria-valuemax={layout.maxWidth} aria-valuenow={layout.preferences.width}
					className="absolute -right-2 top-0 bottom-0 w-2 cursor-col-resize touch-none hover:bg-accent/20 focus-visible:bg-accent/30 focus-visible:outline-none"
					onPointerDown={(event) => { if (event.button === 0) { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); } }}
					onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId) && asideRef.current) layout.setWidth(event.clientX - asideRef.current.getBoundingClientRect().left); }}
					onPointerUp={(event) => { event.currentTarget.releasePointerCapture(event.pointerId); layout.commitWidth(); }}
					onPointerCancel={() => layout.commitWidth()}
					onKeyDown={(event) => {
						if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
							event.preventDefault(); event.stopPropagation();
							const width = event.key === "Home" ? layout.minWidth : event.key === "End" ? layout.maxWidth : layout.preferences.width + (event.key === "ArrowRight" ? 10 : -10);
							layout.updateWidth(width);
						}
					}} />}
			</aside>
		</div>
	);
}
