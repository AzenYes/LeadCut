import { Keyboard, PauseIcon } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import type { KeystrokeCaptureMode } from "../../../../services/leadcut-mcp/src/keystrokeSidecar";
import { HudButton, HudTooltip } from "../HudTooltip";
import styles from "../LaunchWindow.module.css";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import { DropdownItem, HudPopover } from "./PopoverScaffold";

const POPOVER_ID = "keystroke-capture";
const modeKeys = { off: "keyModeOff", shortcuts: "keyModeShortcuts", all: "keyModeAll" } as const;
type CaptureStatus = KeystrokeCaptureMode | "paused" | "unavailable";

function CaptureIcon({ status }: { status: CaptureStatus }) {
	return (
		<span aria-hidden="true" className="pointer-events-none relative inline-flex shrink-0">
			<Keyboard weight={status === "all" ? "fill" : "regular"} className="size-5" />
			{(status === "off" || status === "unavailable") && (
				<span className="absolute left-0 top-1/2 h-0.5 w-full -rotate-45 rounded-full bg-current" />
			)}
			{status === "paused" && <PauseIcon weight="fill" className="absolute -right-1 -bottom-1 size-3 rounded-sm bg-background" />}
		</span>
	);
}

export function KeystrokeCapturePopover({ mode, shortcut, onModeChange }: {
	mode: KeystrokeCaptureMode;
	shortcut: string;
	onModeChange: (mode: KeystrokeCaptureMode) => void;
}) {
	const t = useScopedT("launch");
	const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
	const modeLabel = t(`recording.${modeKeys[mode]}`);
	return (
		<HudPopover
			open={isOpen(POPOVER_ID)}
			onOpenChange={next => next ? requestOpen(POPOVER_ID) : requestClose(POPOVER_ID)}
			trigger={
				<HudButton variant="ghost" size="icon" iconSize="lg" data-key-capture={mode}
					className={mode === "off" ? "text-muted-foreground" : "text-accent"}
					aria-label={t("recording.keyCapture")}
					tooltip={t("recording.keyCaptureTip", undefined, { mode: modeLabel, shortcut })}>
					<CaptureIcon status={mode} />
				</HudButton>
			}
		>
			<div className={styles.ddLabel}>{t("recording.keyCapture")}</div>
			{(["off", "shortcuts", "all"] as const).map(option => (
				<DropdownItem key={option} icon={<CaptureIcon status={option} />} selected={mode === option} onClick={() => {
					onModeChange(option);
					requestClose(POPOVER_ID);
				}}>{t(`recording.${modeKeys[option]}`)}</DropdownItem>
			))}
		</HudPopover>
	);
}

export function KeystrokeCaptureIndicator({ status, shortcut }: { status: CaptureStatus; shortcut: string }) {
	const t = useScopedT("launch");
	const label = status === "paused" ? t("recording.keyCapturePaused")
		: status === "unavailable" ? t("recording.keyCaptureUnavailable")
			: t(`recording.${modeKeys[status]}`);
	return (
		<HudTooltip label={t("recording.keyCaptureTip", undefined, { mode: label, shortcut })}>
			<span role="img" data-key-capture={status} aria-label={label}
				className={`flex items-center px-1 ${status === "paused" ? "text-warning" : "text-muted-foreground"}`}>
				<CaptureIcon status={status} />
			</span>
		</HudTooltip>
	);
}
