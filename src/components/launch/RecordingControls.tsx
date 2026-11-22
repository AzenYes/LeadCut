import { useUiText } from "@/i18n/useUiText";
import {
	House,
	MicrophoneIcon,
	MicrophoneSlashIcon,
	MinusIcon,
	PauseIcon,
	PlayIcon,
	Trash,
} from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import { useAudioLevelMeter } from "@/hooks/useAudioLevelMeter";
import { createSilenceDetector } from "@/hooks/audioSilence";
import { AudioLevelMeter } from "@/components/ui/audio-level-meter";
import { toast } from "@/components/ui/toast";
import { Separator } from "@heroui/react";
import { type ReactNode, useEffect, useState } from "react";
import { advanceDiscardConfirmation } from "./discardConfirm";
import { HudButton } from "./HudTooltip";
import styles from "./LaunchWindow.module.css";
import type { LiveAnnotationStatus } from "../live-annotation/liveAnnotationModel";

interface RecordingControlsProps {
	onHome: () => void;
	paused: boolean;
	microphoneEnabled: boolean;
	microphoneDeviceId?: string;
	webcamInterrupted: boolean;
	elapsed: number;
	markerCount: number;
	annotation?: LiveAnnotationStatus & { onToggle: () => void };
	keystrokeStatus?: ReactNode;
	onPauseResume: () => void;
	onStopRecording: () => void;
	onHideHud: () => void;
	onCancelRecording: () => void;
	formatTime: (seconds: number) => string;
}

function RecordingMicrophoneMeter({ active, deviceId }: { active: boolean; deviceId?: string }) {
	const uiText = useUiText();
	const [observe] = useState(() => createSilenceDetector({ threshold: 2 }));
	const { level } = useAudioLevelMeter({
		enabled: active,
		deviceId,
		onSample: (value, timeMs) => {
			if (observe(value, timeMs)) toast.warning(uiText("recordingMicrophoneSilent"), { id: "recording-microphone-silent" });
		},
	});
	useEffect(() => () => toast.dismiss("recording-microphone-silent"), []);
	return <AudioLevelMeter level={level} className="w-14" />;
}

export function RecordingControls({
	onHome,
	paused,
	microphoneEnabled,
	microphoneDeviceId,
	webcamInterrupted,
	elapsed,
	markerCount,
	annotation,
	keystrokeStatus,
	onPauseResume,
	onStopRecording,
	onHideHud,
	onCancelRecording,
	formatTime,
}: RecordingControlsProps) {
	const uiText = useUiText();
	const t = useScopedT("launch");
	const actionClass = `size-9 min-w-9 rounded-full ${styles.electronNoDrag}`;
	const [discardDeadline, setDiscardDeadline] = useState<number | null>(null);
	const discardLabel = t(discardDeadline === null ? "recording.discard" : "recording.discardConfirm");
	useEffect(() => {
		if (discardDeadline === null) return;
		const timer = window.setTimeout(() => setDiscardDeadline(null), discardDeadline - performance.now());
		return () => window.clearTimeout(timer);
	}, [discardDeadline]);
	return (
		<div role="group" aria-label={uiText("recordingControls")} className="flex items-center gap-2">
			<HudButton
				size="icon"
				variant="ghost"
				className={actionClass}
				tooltip={t("recording.home")}
				onPress={onHome}
			>
				<House weight="fill" className="size-4" />
			</HudButton>
			<div
				className="flex items-center gap-3 px-2"
				role="status"
				aria-label={paused ? t("recording.paused") : t("recording.rec")}
			>
				<span
					className={`size-2 rounded-full ${paused ? "bg-warning" : `bg-danger ${styles.recDotBlink}`}`}
				/>
				<span className="min-w-14 text-sm font-medium tabular-nums text-foreground">
					{formatTime(elapsed)}
				</span>
				{paused && (
					<span className="text-xs text-muted-foreground">{t("recording.paused")}</span>
				)}
			</div>
			<span
				key={markerCount}
				data-recording-marker-count={markerCount}
				title={uiText("recordingMarkerCount", { count: markerCount })}
				className={`whitespace-nowrap text-xs tabular-nums text-muted-foreground ${markerCount > 0 ? styles.markerCountFlash : ""}`}
			>
				{uiText("recordingMarkerCount", { count: markerCount })}
			</span>
			{annotation && (
				<HudButton
					size="icon"
					disabled={!annotation.supported}
					aria-pressed={annotation.active}
					variant="ghost"
					className={actionClass}
					aria-label={t("annotation.title", "Screen annotation")}
					tooltip={annotation.supported ? t("annotation.title", "Screen annotation") : t("annotation.windowUnavailable", "Screen annotation is unavailable while recording a window")}
					onPress={annotation.onToggle}
				>
					<span aria-hidden="true" className="text-lg leading-none">✎</span>
				</HudButton>
			)}
			<div className="flex items-center gap-2 px-2" title={t("recording.micToggleDisabledTip")}>
				<span role="img" aria-label={microphoneEnabled ? uiText("microphoneOn") : uiText("microphoneOff")}>
					{microphoneEnabled ? <MicrophoneIcon weight="fill" className="size-4" /> : <MicrophoneSlashIcon className="size-4" />}
				</span>
				{microphoneEnabled && (
					<RecordingMicrophoneMeter
						key={`${microphoneDeviceId ?? "default"}:${paused}`}
						active={!paused}
						deviceId={microphoneDeviceId}
					/>
				)}
			</div>
			{keystrokeStatus}
			{webcamInterrupted && (
				<span
					role="img"
					aria-label={uiText("recordingCameraDisconnected")}
					title={uiText("recordingCameraDisconnected")}
					className="flex size-5 items-center justify-center rounded-full border border-warning text-xs font-bold text-warning"
				>
					!
				</span>
			)}
			<Separator orientation="vertical" className="mx-1 h-5 self-center" />
			<HudButton
				size="icon"
				variant="ghost"
				className={actionClass}
				onPress={onPauseResume}
				tooltip={t(paused ? "recording.resume" : "recording.pause")}
			>
				{paused ? <PlayIcon weight="fill" className="size-4" /> : <PauseIcon weight="fill" className="size-4" />}
			</HudButton>
			<HudButton
				size="icon"
				variant="destructive"
				className={actionClass}
				onPress={onStopRecording}
				tooltip={t("recording.stop")}
			>
				<span className="size-3 rounded-[3px] bg-current" />
			</HudButton>
			<HudButton
				size="icon"
				variant="ghost"
				className={actionClass}
				onPress={onHideHud}
				tooltip={t("recording.hideHud")}
			>
				<MinusIcon className="size-4" />
			</HudButton>
			<HudButton
				size="icon"
				variant={discardDeadline === null ? "ghost" : "destructive"}
				className={actionClass}
				onPress={() => {
					const confirmation = advanceDiscardConfirmation(discardDeadline, performance.now());
					setDiscardDeadline(confirmation.deadlineMs);
					if (confirmation.shouldDiscard) onCancelRecording();
				}}
				tooltip={discardLabel}
			>
				<Trash className="size-4" />
			</HudButton>
		</div>
	);
}
