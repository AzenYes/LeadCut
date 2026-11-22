import { KEYSTROKE_CAPTURE_MODE_SETTING_KEY, OPEN_DASHBOARD_STORAGE_KEY } from "@/lib/storageKeys";
import { DEFAULT_RECORDING_SHORTCUTS } from "@/lib/recordingShortcuts";
import { formatBinding } from "@/lib/shortcuts";
import { DEFAULT_KEYSTROKE_CAPTURE_MODE, isKeystrokeCaptureMode, type KeystrokeCaptureMode } from "../../../services/leadcut-mcp/src/keystrokeSidecar";
import {
	ArrowClockwiseIcon,
	CaretUpIcon,
	House,
	DotsThreeVerticalIcon,
	MicrophoneIcon,
	MicrophoneSlashIcon,
	MinusIcon,
	MonitorIcon,
	SpeakerHighIcon,
	SpeakerXIcon,
	TimerIcon,
	VideoCameraIcon,
	VideoCameraSlashIcon,
	XIcon,
} from "@/components/ui/icons";
import { Tooltip } from "@heroui/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Separator } from "@/components/ui/separator";
import { useScopedT } from "../../contexts/I18nContext";
import { useScreenRecorder } from "../../hooks/useScreenRecorder";
import { toast } from "../ui/toast";
import type { LiveAnnotationStatus } from "../live-annotation/liveAnnotationModel";
import { HudInteractionContext } from "./contexts/HudInteractionContext";
import {
	canToggleFloatingWebcamPreview,
	WEBCAM_PREVIEW_RESIZE_HANDLES,
} from "./floatingWebcamPreview";
import { useHudBarDrag } from "./hooks/useHudBarDrag";
import { useLaunchHudInteractionState } from "./hooks/useLaunchHudInteractionState";
import { useLaunchWindowActions } from "./hooks/useLaunchWindowActions";
import { useLaunchWindowSystemState } from "./hooks/useLaunchWindowSystemState";
import { useRecordingTimer } from "./hooks/useRecordingTimer";
import { useWebcamPreviewOverlay } from "./hooks/useWebcamPreviewOverlay";
import { HudButton, HudTooltip } from "./HudTooltip";
import styles from "./LaunchWindow.module.css";
import { MarqueeText } from "./MarqueeText";
import { CountdownPopover } from "./popovers/CountdownPopover";
import { KeystrokeCaptureIndicator, KeystrokeCapturePopover } from "./popovers/KeystrokeCapturePopover";
import {
	LaunchPopoverCoordinatorProvider,
	useLaunchPopoverCoordinator,
} from "./popovers/LaunchPopoverCoordinator";
import { MicPopover } from "./popovers/MicPopover";
import { SourcePopover } from "./popovers/SourcePopover";
import { WebcamPopover } from "./popovers/WebcamPopover";
import { RecordingControls } from "./RecordingControls";

type RecordingDiskStatus = NonNullable<Awaited<ReturnType<Window["electronAPI"]["getRecordingDiskStatus"]>>>;

export function LaunchWindow() {
	return (
		<LaunchPopoverCoordinatorProvider>
			<LaunchWindowContent />
		</LaunchPopoverCoordinatorProvider>
	);
}

function LaunchWindowContent() {
	const t = useScopedT("launch");
	const { openId, requestOpen } = useLaunchPopoverCoordinator();

	const {
		recording,
		paused,
		initialElapsedMs,
		markerCount,
		webcamInterrupted,
		finalizing,
		countdownActive,
		toggleRecording,
		pauseRecording,
		resumeRecording,
		cancelRecording,
		microphoneEnabled,
		setMicrophoneEnabled,
		microphoneDeviceId,
		microphone,
		systemAudioEnabled,
		setSystemAudioEnabled,
		webcamEnabled,
		setWebcamEnabled,
		webcamDeviceId,
		webcam,
		countdownDelay,
		setCountdownDelay,
		preparePermissions,
	} = useScreenRecorder(openId === "mic" || openId === "webcam" ? openId : undefined);

	const { elapsed, formatTime } = useRecordingTimer(recording, paused, initialElapsedMs);
	const hudContentRef = useRef<HTMLDivElement>(null);
	const hudBarRef = useRef<HTMLDivElement>(null);

	const { selectedSource, hasSelectedSource, handleSourceSelect, syncSelectedSource } =
		useLaunchWindowActions();
	const [idleDiskStatus, setIdleDiskStatus] = useState<RecordingDiskStatus | null>(null);
	const [diskAlert, setDiskAlert] = useState<RecordingDiskStatus | null>(null);
	const [keyCaptureMode, setKeyCaptureMode] = useState<KeystrokeCaptureMode>(() => {
		const saved = window.electronAPI?.getAppSetting(KEYSTROKE_CAPTURE_MODE_SETTING_KEY);
		return isKeystrokeCaptureMode(saved) ? saved : DEFAULT_KEYSTROKE_CAPTURE_MODE;
	});
	const [keyCapturePaused, setKeyCapturePaused] = useState(false);
	const [keyCaptureUnavailable, setKeyCaptureUnavailable] = useState(false);
	const [keyCaptureShortcut, setKeyCaptureShortcut] = useState(DEFAULT_RECORDING_SHORTCUTS.toggleKeystrokeCapture);
	useEffect(() => window.electronAPI?.onRecordingKeystrokeCaptureUnavailable?.(() => {
		setKeyCaptureUnavailable(true);
		toast.warning(t("recording.keyCaptureUnavailable"));
	}), [t]);
	useEffect(() => window.electronAPI?.onRecordingKeystrokeCaptureChanged?.((paused) => {
		setKeyCapturePaused(paused);
		toast.info(t(paused ? "recording.keyCapturePaused" : "recording.keyCaptureResumed"));
	}), [t]);
	useEffect(() => {
		if (!recording) {
			setKeyCapturePaused(false);
			setKeyCaptureUnavailable(false);
		}
	}, [recording]);

	useEffect(() => {
		return window.electronAPI?.onRecordingDiskLow?.((status) => {
			setDiskAlert(status.level === "ok" ? null : status);
		});
	}, []);

	useEffect(() => {
		if (recording) {
			setDiskAlert(null);
			return;
		}
		let active = true;
		const refresh = async () => {
			const status = await window.electronAPI?.getRecordingDiskStatus?.().catch(() => null);
			if (active) setIdleDiskStatus(status ?? null);
		};
		void refresh();
		const timer = window.setInterval(refresh, 60_000);
		return () => {
			active = false;
			window.clearInterval(timer);
		};
	}, [recording]);

	const showWebcamControls = webcamEnabled && !recording;
	const { hudOverlayMousePassthroughSupported, platform } =
		useLaunchWindowSystemState(preparePermissions);
	useEffect(() => {
		if (platform !== "win32") return;
		let active = true;
		void window.electronAPI?.getRecordingShortcuts?.().then(({ config }) => {
			if (active) setKeyCaptureShortcut(config.toggleKeystrokeCapture);
		}).catch(() => undefined);
		return () => { active = false; };
	}, [platform]);
	const [annotationStatus, setAnnotationStatus] = useState<LiveAnnotationStatus>({ supported: false, active: false });
	useEffect(() => {
		const api = window.electronAPI;
		let mounted = true;
		const remove = api?.onLiveAnnotationStateChanged?.(status => { if (mounted) setAnnotationStatus(status); });
		void api?.getLiveAnnotationState?.().then(status => { if (mounted) setAnnotationStatus(status); }).catch(() => undefined);
		return () => { mounted = false; remove?.(); };
	}, []);

	const {
		showFloatingWebcamPreview,
		setShowFloatingWebcamPreview,
		showRecordingWebcamPreview,
		webcamPreviewOffset,
		webcamPreviewSize,
		recordingWebcamPreviewContainerRef,
		isWebcamPreviewDraggingRef,
		webcamPreviewDragStartRef,
		handleWebcamPreviewPointerDown,
		handleWebcamPreviewPointerMove,
		handleWebcamPreviewPointerUp,
		handleWebcamPreviewResizePointerDown,
		handleWebcamPreviewResizePointerMove,
		handleWebcamPreviewResizePointerUp,
		setWebcamPreviewNode,
		setRecordingWebcamPreviewNode,
	} = useWebcamPreviewOverlay({
		webcamEnabled,
		previewSuppressed: recording && webcamInterrupted,
		webcamDeviceId,
		showWebcamControls,
		webcamPopoverOpen: openId === "webcam",
		hudOverlayMousePassthroughSupported,
	});

	useEffect(() => {
		window.electronAPI?.hudOverlaySetWebcamPreviewVisible?.(showRecordingWebcamPreview);
	}, [showRecordingWebcamPreview]);

	useEffect(() => {
		return () => {
			window.electronAPI?.hudOverlaySetWebcamPreviewVisible?.(false);
		};
	}, []);

	const persistentHudPlacement = platform !== "linux" && hudOverlayMousePassthroughSupported === true;
	const {
		recordingHudOffset,
		isHudDragging,
		hudBarTransformRef,
		isHudDraggingRef,
		handleHudBarPointerDown,
		handleHudBarPointerMove,
		handleHudBarPointerUp,
	} = useHudBarDrag({
		hudContentRef,
		hudBarRef,
		recordingWebcamPreviewContainerRef,
		persistentPlacement: persistentHudPlacement,
	});

	const { handleHudMouseEnter, handleHudMouseLeave, beginInteractiveHudAction } =
		useLaunchHudInteractionState({
			openId,
			isHudDraggingRef,
			isWebcamPreviewDraggingRef,
			webcamPreviewDragStartRef,
		});

	useEffect(() => {
		let mounted = true;

		void window.electronAPI.getSelectedSource().then((source) => {
			if (mounted) syncSelectedSource(source);
		});

		const cleanup = window.electronAPI.onSelectedSourceChanged((source) => {
			if (mounted) syncSelectedSource(source);
		});

		return () => {
			mounted = false;
			cleanup?.();
		};
	}, [syncSelectedSource]);

	const hudStateTransition = {
		duration: 0.24,
		ease: [0.22, 1, 0.36, 1] as const,
	};

	const openHome = () => {
		localStorage.setItem(OPEN_DASHBOARD_STORAGE_KEY, String(Date.now()));
		void window.electronAPI.showProjectDashboard();
	};
	const homeButton = (
		<HudButton
			variant="ghost"
			size="icon"
			iconSize="lg"
			tooltip={t("recording.home")}
			onClick={openHome}
		>
			<House weight="fill" className="size-5" />
		</HudButton>
	);

	const keyCaptureShortcutLabel = formatBinding(keyCaptureShortcut, false);
	const recordingControls = (
		<RecordingControls
			onHome={openHome}
			paused={paused}
			microphoneEnabled={microphoneEnabled}
			microphoneDeviceId={microphoneDeviceId}
			webcamInterrupted={webcamInterrupted}
			elapsed={elapsed}
			markerCount={markerCount}
			annotation={platform === "win32" ? { ...annotationStatus, onToggle: () => void window.electronAPI?.toggleLiveAnnotation?.() } : undefined}
			keystrokeStatus={platform === "win32" && <KeystrokeCaptureIndicator
				status={keyCaptureUnavailable ? "unavailable" : keyCapturePaused ? "paused" : keyCaptureMode}
				shortcut={keyCaptureShortcutLabel}
			/>}
			onPauseResume={paused ? resumeRecording : pauseRecording}
			onStopRecording={toggleRecording}
			onHideHud={() => window.electronAPI?.hudOverlayHide?.()}
			onCancelRecording={cancelRecording}
			formatTime={formatTime}
		/>
	);

	const idleControls = (
		<>
			{platform !== "linux" && (
				<>
					<SourcePopover
						selectedSource={selectedSource}
						onSourceSelect={handleSourceSelect}
						onOpen={beginInteractiveHudAction}
						trigger={
							<HudButton
								variant="ghost"
								size="lg"
								className={` ${styles.electronNoDrag} group gap-2 px-3 min-w-0 max-w-[180px] shrink-0  ${openId === "sources" ? "border-[var(--launch-border-strong)] bg-[var(--launch-hover)]" : ""} `}
								aria-label={selectedSource}
								tooltip={t("recording.selectSource")}
							>
								<MonitorIcon
									weight={openId === "sources" ? "fill" : "regular"}
									size={18}
									className="size-5 shrink-0"
								/>
								<div className="flex-1 min-w-0 overflow-hidden">
									<MarqueeText text={selectedSource} />
								</div>
								<CaretUpIcon
									size={10}
									className={`text-[#6b6b78] ml-0.5 shrink-0 transition-transform duration-200 ${
										openId === "sources" ? "" : "rotate-180"
									}`}
								/>
							</HudButton>
						}
					/>

					<Separator orientation="vertical" className="mx-[5px] h-6 self-center" />
				</>
			)}

			<HudButton
				variant="ghost"
				size="icon"
				iconSize="lg"
				tooltip={
					systemAudioEnabled
						? t("recording.disableSystemAudio")
						: t("recording.enableSystemAudio")
				}
				aria-pressed={systemAudioEnabled}
				className={systemAudioEnabled ? "text-accent" : ""}
				onClick={() => setSystemAudioEnabled(!systemAudioEnabled)}
			>
				{systemAudioEnabled ? (
					<SpeakerHighIcon weight="fill" className="size-5" />
				) : (
					<SpeakerXIcon className="size-5" />
				)}
			</HudButton>

			<MicPopover
				disabled={recording}
				systemAudioEnabled={systemAudioEnabled}
				onToggleSystemAudio={() => setSystemAudioEnabled(!systemAudioEnabled)}
				microphoneEnabled={microphoneEnabled}
				onDisableMicrophone={() => setMicrophoneEnabled(false)}
				devices={microphone.devices}
				selectedDeviceId={microphone.selectedDeviceId}
				missingDeviceLabel={microphone.missingDevice ? microphone.missingLabel ?? null : undefined}
				onSelectDevice={(deviceId) => {
					microphone.selectDevice(deviceId);
					if (!microphoneEnabled) setMicrophoneEnabled(true);
				}}
				trigger={
					<HudButton
						variant="ghost"
						size="icon"
						iconSize="lg"
						tooltip={t("recording.microphone")}
						aria-label={
							microphoneEnabled
								? t("recording.disableMicrophone")
								: t("recording.enableMicrophone")
						}
						className={microphoneEnabled ? "text-accent" : ""}
					>
						{microphoneEnabled ? (
							<MicrophoneIcon
								weight={microphoneEnabled ? "fill" : "regular"}
								className="size-5"
								size={18}
							/>
						) : (
							<MicrophoneSlashIcon className="size-5" />
						)}
					</HudButton>
				}
			/>

			<WebcamPopover
				disabled={recording}
				webcamEnabled={webcamEnabled}
				onDisableWebcam={() => setWebcamEnabled(false)}
				canToggleFloatingPreview={canToggleFloatingWebcamPreview(
					hudOverlayMousePassthroughSupported,
				)}
				showFloatingWebcamPreview={showFloatingWebcamPreview}
				onToggleFloatingPreview={() => setShowFloatingWebcamPreview((current) => !current)}
				showWebcamControls={showWebcamControls}
				setWebcamPreviewNode={setWebcamPreviewNode}
				videoDevices={webcam.devices}
				selectedVideoDeviceId={webcam.selectedDeviceId}
				missingDeviceLabel={webcam.missingDevice ? webcam.missingLabel ?? null : undefined}
				onSelectVideoDevice={(deviceId) => {
					webcam.selectDevice(deviceId);
					if (!webcamEnabled) setWebcamEnabled(true);
				}}
				trigger={
					<HudButton
						variant="ghost"
						size="icon"
						iconSize="lg"
						tooltip={t("recording.webcam")}
						aria-label={
							webcamEnabled
								? t("recording.disableWebcam")
								: t("recording.enableWebcam")
						}
						className={webcamEnabled ? "text-accent" : ""}
					>
						{webcamEnabled ? (
							<VideoCameraIcon
								weight={webcamEnabled ? "fill" : "regular"}
								className="size-5"
								size={18}
							/>
						) : (
							<VideoCameraSlashIcon className="size-5" />
						)}
					</HudButton>
				}
			/>

			{platform === "win32" && <KeystrokeCapturePopover mode={keyCaptureMode} shortcut={keyCaptureShortcutLabel}
				onModeChange={mode => {
					if (window.electronAPI?.setAppSetting(KEYSTROKE_CAPTURE_MODE_SETTING_KEY, mode)) setKeyCaptureMode(mode);
				}}
			/>}
			<CountdownPopover
				countdownDelay={countdownDelay}
				onSelectDelay={setCountdownDelay}
				trigger={
					<HudButton
						variant="ghost"
						size="icon"
						iconSize="lg"
						tooltip={t("recording.countdownDelay")}
						className={countdownDelay > 0 ? "text-accent" : ""}
					>
						<TimerIcon
							weight={openId === "countdown" ? "fill" : "regular"}
							className="size-5"
						/>
					</HudButton>
				}
			/>

			<HudButton
				type="button"
				variant="destructive"
				size="icon"
				className={styles.electronNoDrag}
				onClick={
					hasSelectedSource || platform === "linux"
						? toggleRecording
						: () => {
								beginInteractiveHudAction();
								requestOpen("sources");
							}
				}
				disabled={countdownActive}
				tooltip={t("recording.record")}
			>
				<div className={styles.recDot} />
			</HudButton>

			<Separator orientation="vertical" className="mx-[5px] h-6 self-center" />

			{homeButton}

			<HudButton
				variant="ghost"
				size="icon"
				iconSize="lg"
				onClick={() => window.electronAPI?.hudOverlayHide?.()}
				tooltip={t("recording.hideHud")}
			>
				<MinusIcon className="size-5" />
			</HudButton>
		</>
	);

	const finalizingControls = (
		<div className={styles.finalizingState}>
			<ArrowClockwiseIcon size={15} className={styles.finalizingSpin} />
			<div className={styles.finalizingCopy}>
				<span>{t("recording.preparing", "Preparing recording")}</span>
				<small>{t("recording.preparingSubtitle", "Opening the editor in a moment")}</small>
			</div>
		</div>
	);

	const hudMode = finalizing ? "finalizing" : recording ? "recording" : "idle";
	let diskNotice: string | undefined;
	let diskWarning = false;
	if (diskAlert?.level === "stop") {
		diskWarning = true;
		diskNotice = t("recording.diskStopped");
	} else if (recording && diskAlert?.level === "low") {
		diskWarning = true;
		diskNotice = t("recording.diskLow");
	} else if (hudMode === "idle" && idleDiskStatus && idleDiskStatus.level !== "ok") {
		diskWarning = true;
		diskNotice = t("recording.diskLowIdle");
	}
	const useNativeHudBarDrag =
		platform === "linux" || hudOverlayMousePassthroughSupported === false;
	const shouldAnimateHudLayout = !recording && !showRecordingWebcamPreview && !isHudDragging;

	return (
		<HudInteractionContext.Provider
			value={{ onMouseEnter: handleHudMouseEnter, onMouseLeave: handleHudMouseLeave }}
		>
			<div
				className="w-full flex justify-center bg-transparent overflow-visible items-end pb-5 pointer-events-none"
				style={{ height: "100vh" }}
			>
				<div
					ref={hudContentRef}
					className="flex items-center overflow-visible flex-col-reverse pointer-events-none"
				>
					<div className="flex flex-col items-center pointer-events-none p-2">
						<div
							ref={hudBarTransformRef}
							style={{
								transform: `translate3d(${recordingHudOffset.x}px, ${recordingHudOffset.y}px, 0)`,
							}}
						>
							<motion.div
								ref={hudBarRef}
								layout={shouldAnimateHudLayout && !persistentHudPlacement}
								transition={hudStateTransition}
								className={`${styles.bar} launch-theme mb-2 pointer-events-auto`}
								onMouseEnter={handleHudMouseEnter}
								onMouseLeave={handleHudMouseLeave}
							>
								<HudTooltip label={t("recording.dragHud")}>
									<Tooltip.Trigger
										role="presentation"
										tabIndex={-1}
										// Fallback windows need native dragging; JS only translates the bar within the window.
										className={`flex items-center px-0.5 cursor-grab active:cursor-grabbing ${
											useNativeHudBarDrag ? styles.electronDrag : ""
										}`}
										onPointerDown={handleHudBarPointerDown}
										onPointerMove={handleHudBarPointerMove}
										onPointerUp={handleHudBarPointerUp}
										onPointerCancel={handleHudBarPointerUp}
										onLostPointerCapture={handleHudBarPointerUp}
										data-testid="hud-drag-handle"
									>
										<DotsThreeVerticalIcon weight="fill" size={18} className="text-[#6b6b78]" />
									</Tooltip.Trigger>
								</HudTooltip>

								<div className={styles.barStateViewport}>
									<AnimatePresence initial={false} mode="wait">
										<motion.div
											key={hudMode}
											layout={shouldAnimateHudLayout}
											className={styles.barState}
											initial={{
												opacity: 0,
												y: 10,
												scale: 0.985,
												filter: "blur(8px)",
											}}
											animate={{
												opacity: 1,
												y: 0,
												scale: 1,
												filter: "blur(0px)",
											}}
											exit={{
												opacity: 0,
												y: -10,
												scale: 0.985,
												filter: "blur(6px)",
											}}
											transition={hudStateTransition}
										>
											{finalizing
												? finalizingControls
												: recording
													? recordingControls
													: idleControls}
										</motion.div>
									</AnimatePresence>
								</div>
								{hudMode === "idle" && (
									<Separator orientation="vertical" className="mx-[5px] h-6 self-center" />
								)}
								{diskNotice && (
									<span role="status" className={`text-xs whitespace-nowrap ${diskWarning ? "text-warning" : "text-muted-foreground"}`}>
										{diskNotice}
									</span>
								)}
								{hudMode === "idle" && (
									<HudButton
										variant="ghost"
										size="icon"
										className={`${styles.electronNoDrag} shrink-0 hover:bg-danger/10 hover:text-danger`}
										disabled={countdownActive}
										onClick={() => window.electronAPI?.hudOverlayQuitApp?.()}
										tooltip={t("recording.closeApp")}
									>
										<XIcon className="size-5" />
									</HudButton>
								)}
							</motion.div>
						</div>
						{showRecordingWebcamPreview && (
							<div
								ref={recordingWebcamPreviewContainerRef}
								className={`${styles.recordingWebcamPreview} ${styles.electronNoDrag} pointer-events-auto`}
								data-hud-interactive
								title={t("recording.webcam")}
								style={{
									transform: `translate(${webcamPreviewOffset.x}px, ${webcamPreviewOffset.y}px)`,
									width: webcamPreviewSize.width,
									height: webcamPreviewSize.height,
								}}
								onMouseEnter={handleHudMouseEnter}
								onMouseLeave={handleHudMouseLeave}
								onPointerDown={handleWebcamPreviewPointerDown}
								onPointerMove={handleWebcamPreviewPointerMove}
								onPointerUp={handleWebcamPreviewPointerUp}
								onPointerCancel={handleWebcamPreviewPointerUp}
							>
								<video
									ref={setRecordingWebcamPreviewNode}
									className={styles.recordingWebcamPreviewVideo}
									muted
									playsInline
									style={{ transform: "scaleX(-1)" }}
								/>
								{WEBCAM_PREVIEW_RESIZE_HANDLES.map((handle) => (
									<div
										key={handle}
										data-resize-handle={handle}
										className={styles.recordingWebcamPreviewResizeHandle}
										onPointerDown={handleWebcamPreviewResizePointerDown}
										onPointerMove={handleWebcamPreviewResizePointerMove}
										onPointerUp={handleWebcamPreviewResizePointerUp}
										onPointerCancel={handleWebcamPreviewResizePointerUp}
									/>
								))}
							</div>
						)}
					</div>
				</div>
			</div>
		</HudInteractionContext.Provider>
	);
}
