import type { Page } from "@playwright/test";
import { DEFAULT_RECORDING_SHORTCUTS, type RecordingShortcutsConfig } from "../../src/lib/recordingShortcuts";

export async function installDesktopBridge(page: Page, videoFixture = "preview.mp4") {
	await page.addInitScript(({ videoFixture, recordingShortcuts }) => {
		const success = async () => ({ success: true });
		const subscribe = () => () => undefined;
		let recordingShortcutConfig = recordingShortcuts;
		const source = {
			id: "screen:1:0",
			name: "Built-in Display",
			thumbnail: "",
			display_id: "1",
		};
		Object.assign(window, {
			electronAPI: {
				getAppSetting: (key: string) => key === "leadcut.onboarding.v1.seen" ? true : null,
				getPreviewDisplayBounds: () => [{ x: 0, y: 0, width: screen.width, height: screen.height }],
				writeAppLog: () => undefined,
				exportDiagnosticsBundle: async () => ({ success: false, canceled: true }),
				finishRecordingStartup: async () => undefined,
				showProjectDashboard: async () => {
					document.documentElement.dataset.dashboardOpened = "true";
				},
				chooseRecordingsDirectory: async () => ({
					success: true,
					path: "/new-recordings",
					canceled: false,
				}),
				setHudOverlayCaptureProtection: async (enabled: boolean) => {
					document.documentElement.dataset.hideHud = String(enabled);
					return { success: true, enabled };
				},
				previewUpdateToast: async () => ({ success: true }),
				setRecordingsRemoved: async () => ({ success: true, value: null }),
				getRecordingThumbnail: async () => ({ success: false, error: "Unavailable" }),
				setAppSetting: () => true,
				getExperimentalUpdatesEnabled: async () => false,
				getScreenRecordingPermissionStatus: async () => ({
					success: true,
					status: "granted",
				}),
				getAccessibilityPermissionStatus: async () => ({ success: true, trusted: true }),
				getPlatform: async () => "darwin",
				getWindowChrome: async () => ({ trafficLightsVisible: true }),
				onWindowChromeChanged: (
					callback: (chrome: { trafficLightsVisible: boolean }) => void,
				) => {
					const listener = (event: Event) => callback((event as CustomEvent).detail);
					window.addEventListener("test-window-chrome", listener);
					return () => window.removeEventListener("test-window-chrome", listener);
				},
				getAppVersion: async () => "1.4.0",
				openExternalUrl: async (url: string) => {
					document.documentElement.dataset.externalUrl = url;
					return { success: true };
				},
				getProjectPreview: async () => ({ success: false, error: "Preview unavailable" }),
				loadCurrentProjectFile: async () => ({ success: false }),
				listProjectVersions: async () => ({ success: true, versions: [] }),
				readProjectVersion: async () => ({ success: false }),
				restoreProjectVersion: async () => ({ success: false }),
				deleteProjectVersion: success,
				pruneProjectVersions: async () => ({ success: true, deleted: 0 }),
				releaseCurrentProject: async () => ({ success: true, path: null }),
				convertLegacyProjectFiles: async () => ({ converted: [], errors: [] }),
				createProjectFile: async () => {
					document.documentElement.dataset.projectCreates = String(
						Number(document.documentElement.dataset.projectCreates || 0) + 1,
					);
					return {
						success: true,
						path: "/projects/Untitled Project.leadcut",
						projectId: "test-project",
						revision: "test-project-revision",
					};
				},
				saveProjectFile: async (
					_data: unknown,
					_name: string,
					projectPath: string,
					thumbnail?: string,
					_expectedRevision?: string,
				) => {
					document.documentElement.dataset.projectSaves = String(
						Number(document.documentElement.dataset.projectSaves || 0) + 1,
					);
					if (thumbnail)
						document.documentElement.dataset.savedThumbnail = thumbnail.slice(0, 22);
					return { success: true, path: projectPath, projectId: "test-project", revision: "test-project-revision" };
				},
				showRecordingHud: async () => {
					document.documentElement.dataset.hudOpened = "true";
				},
				trashProjectFiles: async (paths: string[]) => ({
					success: true,
					deleted: paths,
					errors: [],
				}),
				getCurrentRecordingSession: async () => ({ success: true, session: null }),
				getInterruptedRecording: async () => null,
				recoverInterruptedRecording: async () => ({ success: false }),
				discardInterruptedRecording: async () => ({ success: false }),
				getCurrentVideoPath: async () => ({
					success: true,
					path: `${location.origin}/tests/ui/fixtures/${videoFixture}`,
				}),
				getCursorTelemetry: async () => ({ success: true, samples: [] }),
				getVideoAudioFallbackPaths: async () => ({ success: true, paths: [] }),
				getWhisperSmallModelStatus: async () => ({ success: true, exists: false }),
				listProjectFiles: async () => ({ success: true, projects: [], entries: [] }),
				setCurrentVideoPath: success,
				finishRecordingImport: success,
				setCurrentRecordingSession: success,
				setHasUnsavedChanges: success,
				onProjectThumbnailReady: subscribe,
				onMenuSaveProject: subscribe,
				onMenuSaveProjectAs: subscribe,
				onMenuLoadProject: subscribe,
				onProjectFileChanged: subscribe,
				onRequestSaveBeforeClose: subscribe,
				onRecordingSessionChanged: subscribe,
				onWhisperSmallModelDownloadProgress: subscribe,
				getSelectedSource: async () => source,
				getSources: async () => [source],
				selectSource: success,
				onSelectedSourceChanged: subscribe,
				getRecordingsDirectory: async () => ({ success: true, path: "/recordings" }),
				getHudOverlayMousePassthroughSupported: async () => ({
					success: true,
					supported: true,
				}),
				getHudOverlayCaptureProtection: async () => ({
					success: true,
					enabled: false,
					supported: true,
				}),
				getRecordingAudioLabConfig: async () => ({ success: true, enabled: false }),
				getCountdownDelay: async () => ({ success: true, delay: 3 }),
				setCountdownDelay: success,
				getRecordingPreferences: async () => ({
					success: true,
					microphoneEnabled: false,
					webcamEnabled: false,
					systemAudioEnabled: true,
				}),
				setRecordingPreferences: success,
				chooseExportPath: async (fileName: string) => ({ success: true, path: `/exports/${fileName}` }),
				onStopRecordingFromTray: subscribe,
				onRecordingShortcut: subscribe,
				onRecordingKeystrokeCaptureUnavailable: subscribe,
				getRecordingState: async () => null,
				addRecordingMarker: async () => ({ success: false }),
				getRecordingMarkers: async () => ({ success: true, markers: [] }),
				onRecordingMarkerAdded: subscribe,
				setRecordingPaused: () => undefined,
				getRecordingShortcuts: async () => ({ config: recordingShortcutConfig, failed: [] }),
				setRecordingShortcuts: async (config: RecordingShortcutsConfig) => {
					recordingShortcutConfig = config;
					return { success: true, failed: [] };
				},
				setRecordingShortcutCapture: () => undefined,
				getRecordingDiskStatus: async () => null,
				onRecordingDiskLow: subscribe,
				generateWaveformPeaks: async () => ({ success: true, noAudio: true }),
				onWaveformPeaksProgress: subscribe,
				onRecordingStateChanged: subscribe,
				onRecordingInterrupted: subscribe,
				hudOverlayRendererReady: success,
				hudOverlaySetIgnoreMouse: success,
				getHudOverlayPlacement: async () => null,
				hudOverlaySetPlacement: async () => true,
				hudOverlayFollowCursorDisplay: () => undefined,
				onHudOverlayDisplayChanged: subscribe,
				hudOverlaySetWebcamPreviewVisible: success,
				getEditorMode: async () => false,
				onEditorModeChanged: subscribe,
				getActiveCountdown: async () => ({ success: true, seconds: 3 }),
				onCountdownTick: subscribe,
				cancelCountdown: async () => {
					document.documentElement.dataset.countdownCancelled = "true";
					return { success: true };
				},
				getCurrentUpdateToastPayload: async () => ({
					version: "1.4.1",
					detail: "A new version of Recordly is available.",
					phase: "available",
					delayMs: 60000,
					isPreview: true,
				}),
				onUpdateToastStateChanged: subscribe,
				dismissUpdateToast: async () => {
					document.documentElement.dataset.updateDismissed = "true";
					return { success: true };
				},
				...window.electronAPI,
			},
		});
	}, { videoFixture, recordingShortcuts: DEFAULT_RECORDING_SHORTCUTS });
}

/** Overrides can run before or after bridge defaults; Playwright does not order init scripts. */
export async function installDesktopBridgeOverrides<T = undefined>(
	page: Page,
	setup: (arg: T) => void,
	arg?: T,
) {
	await page.addInitScript({
		content: `window.electronAPI ??= {}; (${setup.toString()})(${JSON.stringify(arg) ?? "undefined"});`,
	});
}
