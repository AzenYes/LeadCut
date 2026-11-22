import { readAppEnv } from "./envCompat";
import { isHudInEditorMode } from "./hudEditorMode";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import {
	supportsHudCaptureProtection,
	shouldProtectHudCapture,
} from "../src/lib/hudCaptureProtection";
import { USER_DATA_PATH } from "./appPaths";
import { APP_NAME } from "./appIdentity";
import { COUNTDOWN_WINDOW_SIZE, getCountdownWindowPosition } from "./countdownController";
import {
	type HudDisplayChange,
	type HudOverlayPlacements,
	type HudOverlayWorkArea,
	getHudOverlayWindowBounds,
	normalizeHudPlacement,
	resolveHudDisplay,
	resizeHudOverlayFallbackBounds,
	shouldExpandHudOverlayFallback,
} from "./hudOverlayBounds";
import { getHudOverlayTaskbarOptions } from "./hudOverlayWindowOptions";
import { getPackagedRendererBaseUrl } from "./rendererServer";
import { protectsLiveAnnotationWindow, type LiveAnnotationWindowKind } from "./liveAnnotationPolicy";
import { APP_LOG_DIRECTORY, appLog, flushAppLogSync } from "./logger";
import { recentReloads, shouldReload } from "./rendererCrashPolicy";
import { uiText } from "./uiI18n";

const electronWindowsDir = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);

const APP_ROOT = path.join(electronWindowsDir, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const RENDERER_DIST = path.join(APP_ROOT, "dist");
const WINDOW_ICON_FILENAME = "leadcut-512.png";
const WINDOW_ICON_PATH = path.join(
	process.env.VITE_PUBLIC || RENDERER_DIST,
	"app-icons",
	WINDOW_ICON_FILENAME,
);

let hudOverlayWindow: BrowserWindow | null = null;
let hudOverlayHiddenFromCapture = true;
let hudOverlayCaptureProtectionLoaded = false;
let hudOverlayPlacements: HudOverlayPlacements = {};
let hudOverlayDisplayId: number | undefined;
let hudOverlayFallbackExpanded = false;
let hudOverlayIgnoringMouse = true;
let hudOverlaySourceSelectionActive = false;
let hudOverlayMouseReassertTimer: NodeJS.Timeout | null = null;
let hudOverlayRecordingActive = false;
let hudCaptureStarting = false;
let hudOverlayWebcamPreviewVisible = false;
let countdownWindow: BrowserWindow | null = null;
let updateToastWindow: BrowserWindow | null = null;
let hudWasVisibleBeforeUpdateToast = false;
export const hudOverlayEvents = new EventEmitter<{
	recreated: [previous: BrowserWindow, replacement: BrowserWindow];
}>();

const HUD_OVERLAY_SETTINGS_FILE = path.join(USER_DATA_PATH, "hud-overlay-settings.json");
const HUD_EDGE_MARGIN_DIP = 16;
const UPDATE_TOAST_WIDTH = 420;
const UPDATE_TOAST_HEIGHT = 172;

function getEditorWindowQuery(): Record<string, string> {
	const query: Record<string, string> = { windowType: "editor" };
	const devOpenInput = readAppEnv("DEV_OPEN_RECORDING_INPUT");
	const devOpenWebcam = readAppEnv("DEV_OPEN_RECORDING_WEBCAM");
	if (devOpenInput) query.devOpenInput = devOpenInput;
	if (devOpenWebcam) query.devOpenWebcam = devOpenWebcam;
	if (process.env.LEADCUT_EXPORT === "1") {
		query.agentExport = "1";
		for (const [field, variable] of Object.entries({
			agentProject: "LEADCUT_EXPORT_PROJECT",
			agentOutput: "LEADCUT_EXPORT_OUTPUT",
			agentQuality: "LEADCUT_EXPORT_QUALITY",
			agentFps: "LEADCUT_EXPORT_FPS",
		})) {
			const value = process.env[variable];
			if (value) query[field] = value;
		}
		return query;
	}
	if (readAppEnv("SMOKE_EXPORT") !== "1") return query;

	query.smokeExport = "1";
	if (readAppEnv("SMOKE_EXPORT_USE_NATIVE") === "1") query.smokeUseNativeExport = "1";
	const smokeQueryFields = {
		smokeReadyTimeoutMs: "SMOKE_EXPORT_TIMEOUT_MS",
		smokeInput: "SMOKE_EXPORT_INPUT",
		smokeOutput: "SMOKE_EXPORT_OUTPUT",
		smokeEncodingMode: "SMOKE_EXPORT_ENCODING_MODE",
		smokeShadowIntensity: "SMOKE_EXPORT_SHADOW_INTENSITY",
		smokeWebcamInput: "SMOKE_EXPORT_WEBCAM_INPUT",
		smokeWebcamShadow: "SMOKE_EXPORT_WEBCAM_SHADOW",
		smokeWebcamSize: "SMOKE_EXPORT_WEBCAM_SIZE",
		smokePipelineModel: "SMOKE_EXPORT_PIPELINE",
		smokeBackendPreference: "SMOKE_EXPORT_BACKEND",
		smokeRenderBackend: "SMOKE_EXPORT_RENDER_BACKEND",
		smokeMaxEncodeQueue: "SMOKE_EXPORT_MAX_ENCODE_QUEUE",
		smokeMaxDecodeQueue: "SMOKE_EXPORT_MAX_DECODE_QUEUE",
		smokeMaxPendingFrames: "SMOKE_EXPORT_MAX_PENDING_FRAMES",
		smokeProject: "SMOKE_EXPORT_PROJECT",
		smokeQuality: "SMOKE_EXPORT_QUALITY",
		smokeFps: "SMOKE_EXPORT_FPS",
	};
	for (const [field, suffix] of Object.entries(smokeQueryFields)) {
		const value = readAppEnv(suffix);
		if (value) query[field] = value;
	}

	return query;
}

export function isHudOverlayMousePassthroughSupported(): boolean {
	return process.platform !== "linux";
}

function loadHudOverlayCaptureProtectionSetting(): boolean {
	if (hudOverlayCaptureProtectionLoaded) {
		return hudOverlayHiddenFromCapture;
	}

	hudOverlayCaptureProtectionLoaded = true;

	try {
		if (!fs.existsSync(HUD_OVERLAY_SETTINGS_FILE)) {
			return hudOverlayHiddenFromCapture;
		}

		const raw = fs.readFileSync(HUD_OVERLAY_SETTINGS_FILE, "utf-8");
		const parsed = JSON.parse(raw) as { hiddenFromCapture?: unknown; barPlacement?: unknown; webcamPreviewPlacement?: unknown } | null;
		if (typeof parsed?.hiddenFromCapture === "boolean") {
			hudOverlayHiddenFromCapture = parsed.hiddenFromCapture;
		}
		hudOverlayPlacements = {
			barPlacement: normalizeHudPlacement(parsed?.barPlacement),
			webcamPreviewPlacement: normalizeHudPlacement(parsed?.webcamPreviewPlacement),
		};
	} catch {
		// Ignore settings read failures and fall back to defaults.
	}

	return hudOverlayHiddenFromCapture;
}

export function getHudOverlayCaptureProtectionEnabled(): boolean {
	return loadHudOverlayCaptureProtectionSetting();
}

function applyHudOverlayCaptureProtectionToWindow(hud: BrowserWindow, enabled: boolean): void {
	if (!supportsHudCaptureProtection(process.platform)) {
		return;
	}

	try {
		// Keep the idle HUD visible to screenshots and other capture applications.
		hud.setContentProtection(
			shouldProtectHudCapture(enabled, hudOverlayRecordingActive, hudCaptureStarting),
		);
	} catch (error) {
		console.warn("Failed to apply HUD capture protection:", error);
	}
}

export function beginHudCaptureProtection(): void {
	hudCaptureStarting = true;
	reassertHudOverlayCaptureProtection();
}
ipcMain.handle("finish-recording-startup", () => {
	hudCaptureStarting = false;
	reassertHudOverlayCaptureProtection();
});

export function reassertHudOverlayCaptureProtection(): boolean {
	const enabled = loadHudOverlayCaptureProtectionSetting();
	const hud = getHudOverlayWindow();
	if (!hud) {
		return enabled;
	}

	applyHudOverlayCaptureProtectionToWindow(hud, enabled);

	return enabled;
}

function writeHudOverlaySettings(patch: HudOverlayPlacements & { hiddenFromCapture?: boolean }): boolean {
	const temporary = `${HUD_OVERLAY_SETTINGS_FILE}.${randomUUID()}.tmp`;
	try {
		let previous: Record<string, unknown> = {};
		try {
			const parsed: unknown = JSON.parse(fs.readFileSync(HUD_OVERLAY_SETTINGS_FILE, "utf-8"));
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) previous = parsed as Record<string, unknown>;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
		}
		fs.writeFileSync(
			temporary,
			JSON.stringify({ ...previous, hiddenFromCapture: hudOverlayHiddenFromCapture, ...patch }, null, 2),
			{ encoding: "utf-8", flag: "wx" },
		);
		fs.renameSync(temporary, HUD_OVERLAY_SETTINGS_FILE);
		return true;
	} catch (error) {
		appLog("warn", "hud-settings", "Could not save HUD settings.", error);
		return false;
	} finally {
		try { fs.rmSync(temporary, { force: true }); } catch { /* Keep the existing settings. */ }
	}
}

function getScreen() {
	if (!app.isReady()) {
		throw new Error(
			"getScreen() called before app is ready. Ensure all screen access happens after app.whenReady().",
		);
	}
	return nodeRequire("electron").screen as typeof import("electron").screen;
}

function getHudOverlayDisplay() {
	const screen = getScreen();
	const hudWindow = getHudOverlayWindow();
	if (!isHudOverlayMousePassthroughSupported()) {
		return hudWindow ? screen.getDisplayMatching(hudWindow.getBounds()) : screen.getPrimaryDisplay();
	}
	loadHudOverlayCaptureProtectionSetting();
	const placement = hudOverlayDisplayId === undefined ? hudOverlayPlacements.barPlacement : { displayId: hudOverlayDisplayId };
	return resolveHudDisplay(placement, screen.getAllDisplays(), screen.getPrimaryDisplay());
}

function getHudOverlayBounds() {
	const { workArea } = getHudOverlayDisplay();
	const fallbackExpanded = shouldExpandHudOverlayFallback({
		fallbackExpanded: hudOverlayFallbackExpanded,
		recordingActive: hudOverlayRecordingActive,
		webcamPreviewVisible: hudOverlayWebcamPreviewVisible,
	});
	return getHudOverlayWindowBounds(
		workArea,
		isHudOverlayMousePassthroughSupported(),
		fallbackExpanded,
	);
}

function applyHudOverlayBounds() {
	if (!hudOverlayWindow || hudOverlayWindow.isDestroyed()) {
		return;
	}
	hudOverlayWindow.setBounds(getHudOverlayBounds(), false);
	reassertHudOverlayMousePassthrough();
	reassertHudOverlayCaptureProtection();

	positionUpdateToastWindow();
	if (!hudOverlayWindow.isVisible()) {
		return;
	}
	hudOverlayWindow.moveTop();
}

function getUpdateToastBounds() {
	const hudWindow = getHudOverlayWindow();
	if (hudWindow) {
		const hudBounds = hudWindow.getBounds();
		const display = getScreen().getDisplayMatching(hudBounds);
		const { workArea } = display;
		const x = Math.round(workArea.x + (workArea.width - UPDATE_TOAST_WIDTH) / 2);
		const y = Math.round(
			workArea.y + workArea.height - UPDATE_TOAST_HEIGHT - HUD_EDGE_MARGIN_DIP,
		);

		return {
			x,
			y,
			width: UPDATE_TOAST_WIDTH,
			height: UPDATE_TOAST_HEIGHT,
		};
	}

	const primaryDisplay = getScreen().getPrimaryDisplay();
	const { workArea } = primaryDisplay;
	return {
		x: Math.round(workArea.x + (workArea.width - UPDATE_TOAST_WIDTH) / 2),
		y: Math.round(workArea.y + workArea.height - UPDATE_TOAST_HEIGHT - HUD_EDGE_MARGIN_DIP),
		width: UPDATE_TOAST_WIDTH,
		height: UPDATE_TOAST_HEIGHT,
	};
}

function positionUpdateToastWindow() {
	if (!updateToastWindow || updateToastWindow.isDestroyed()) {
		return;
	}

	updateToastWindow.setBounds(getUpdateToastBounds(), false);
	updateToastWindow.moveTop();
}

function setHudOverlayFallbackExpanded(expanded: boolean) {
	if (hudOverlayRecordingActive) {
		hudOverlayFallbackExpanded = false;
		return;
	}

	hudOverlayFallbackExpanded = expanded;
	if (
		!hudOverlayWindow ||
		hudOverlayWindow.isDestroyed() ||
		isHudOverlayMousePassthroughSupported()
	) {
		return;
	}

	const { workArea } = getHudOverlayDisplay();
	const nextBounds = resizeHudOverlayFallbackBounds(
		workArea,
		hudOverlayWindow.getBounds(),
		expanded,
	);
	hudOverlayWindow.setBounds(nextBounds, false);
	positionUpdateToastWindow();
	if (hudOverlayWindow.isVisible()) {
		hudOverlayWindow.moveTop();
	}
}

function setHudOverlayMousePassthrough(ignore: boolean) {
	hudOverlayIgnoringMouse =
		hudOverlaySourceSelectionActive && !hudOverlayRecordingActive ? true : ignore;

	if (hudOverlayMouseReassertTimer) {
		clearTimeout(hudOverlayMouseReassertTimer);
		hudOverlayMouseReassertTimer = null;
	}

	if (!hudOverlayWindow || hudOverlayWindow.isDestroyed()) {
		return;
	}

	if (hudOverlayRecordingActive) {
		hudOverlayFallbackExpanded = false;
		applyHudOverlayBounds();
	}

	if (!isHudOverlayMousePassthroughSupported()) {
		if (process.platform !== "linux") {
			setHudOverlayFallbackExpanded(!ignore);
		}
		hudOverlayWindow.setIgnoreMouseEvents(false);
		return;
	}

	if (ignore) {
		hudOverlayWindow.setIgnoreMouseEvents(true, { forward: true });
		return;
	}

	hudOverlayWindow.setIgnoreMouseEvents(false);
}

ipcMain.on("hud-overlay-set-ignore-mouse", (_event, ignore: boolean) => {
	setHudOverlayMousePassthrough(Boolean(ignore));
});

ipcMain.on("hud-overlay-set-source-selection-active", (_event, active: boolean) => {
	hudOverlaySourceSelectionActive = Boolean(active);
	if (hudOverlaySourceSelectionActive) {
		hudOverlayFallbackExpanded = false;
		applyHudOverlayBounds();
		return;
	}

	setHudOverlayMousePassthrough(hudOverlayIgnoringMouse);
});

// Keep compatibility with existing drag IPC/state.
let hudUserPosition: { x: number; y: number } | null = null;
let hudDragOffset: { x: number; y: number } | null = null;
let hudDragLastCursor: { x: number; y: number } | null = null;
let hudDragFixedSize: { width: number; height: number } | null = null;

ipcMain.on("hud-overlay-drag", (_event, phase: string, screenX: number, screenY: number) => {
	if (!hudOverlayWindow || hudOverlayWindow.isDestroyed()) return;

	// On Linux the compositor (especially Wayland) refuses programmatic window
	// placement, so BrowserWindow.setBounds() with x/y is silently ignored and
	// the HUD appears "stuck".  The renderer marks the drag handle as
	// -webkit-app-region: drag on Linux, letting the OS move the window for us.
	// The resulting position is captured by the win.on("moved", ...) listener
	// below so `hudUserPosition` stays in sync.
	if (process.platform === "linux") {
		return;
	}

	if (phase === "start") {
		const bounds = hudOverlayWindow.getBounds();
		hudDragOffset = { x: screenX - bounds.x, y: screenY - bounds.y };
		hudDragLastCursor = { x: screenX, y: screenY };
		hudDragFixedSize = { width: bounds.width, height: bounds.height };
	} else if (phase === "move" && hudDragOffset) {
		if (
			hudDragLastCursor &&
			hudDragLastCursor.x === screenX &&
			hudDragLastCursor.y === screenY
		) {
			return;
		}

		hudDragLastCursor = { x: screenX, y: screenY };
		const targetX = Math.round(screenX - hudDragOffset.x);
		const targetY = Math.round(screenY - hudDragOffset.y);
		const fixedWidth = hudDragFixedSize?.width ?? hudOverlayWindow.getBounds().width;
		const fixedHeight = hudDragFixedSize?.height ?? hudOverlayWindow.getBounds().height;
		hudOverlayWindow.setBounds(
			{
				x: targetX,
				y: targetY,
				width: fixedWidth,
				height: fixedHeight,
			},
			false,
		);
	} else if (phase === "end") {
		const finalBounds = hudOverlayWindow.getBounds();
		hudUserPosition = { x: finalBounds.x, y: finalBounds.y };

		hudDragOffset = null;
		hudDragLastCursor = null;
		hudDragFixedSize = null;
	}
});

ipcMain.on("hud-overlay-hide", () => {
	if (hudOverlayWindow && !hudOverlayWindow.isDestroyed()) {
		hudOverlayWindow.minimize();
	}
});

ipcMain.handle("get-hud-overlay-capture-protection", () => {
	const enabled = loadHudOverlayCaptureProtectionSetting();

	return {
		success: true,
		enabled,
	};
});

ipcMain.handle("get-hud-overlay-mouse-passthrough-supported", () => {
	return {
		success: true,
		supported: isHudOverlayMousePassthroughSupported(),
	};
});

ipcMain.on("hud-overlay-set-webcam-preview-visible", (_event, visible: boolean) => {
	const nextVisible = Boolean(visible);
	if (hudOverlayWebcamPreviewVisible === nextVisible) {
		return;
	}

	hudOverlayWebcamPreviewVisible = nextVisible;
	if (hudOverlayRecordingActive) {
		applyHudOverlayBounds();
	}
});

ipcMain.handle("set-hud-overlay-capture-protection", (_event, enabled: boolean) => {
	loadHudOverlayCaptureProtectionSetting();
	hudOverlayHiddenFromCapture = Boolean(enabled);
	writeHudOverlaySettings({ hiddenFromCapture: hudOverlayHiddenFromCapture });

	reassertHudOverlayCaptureProtection();

	return {
		success: true,
		enabled: hudOverlayHiddenFromCapture,
	};
});

ipcMain.handle("get-hud-overlay-placement", ({ sender }) => {
	const hud = getHudOverlayWindow();
	if (hud?.webContents !== sender || !isHudOverlayMousePassthroughSupported()) return null;
	loadHudOverlayCaptureProtectionSetting();
	return { displayId: getHudOverlayDisplay().id, ...hudOverlayPlacements };
});

ipcMain.handle("hud-overlay-set-placement", ({ sender }, kind: unknown, value: unknown) => {
	const hud = getHudOverlayWindow();
	if (hud?.webContents !== sender || !isHudOverlayMousePassthroughSupported()) return false;
	if (kind !== "bar" && kind !== "webcam") return false;
	const placement = normalizeHudPlacement(value);
	if (!placement) return false;
	placement.displayId = getHudOverlayDisplay().id;
	const patch = kind === "bar" ? { barPlacement: placement } : { webcamPreviewPlacement: placement };
	hudOverlayPlacements = { ...hudOverlayPlacements, ...patch };
	return writeHudOverlaySettings(patch);
});

ipcMain.on("hud-overlay-follow-cursor-display", ({ sender }) => {
	const hud = getHudOverlayWindow();
	if (!hud || hud.webContents !== sender || !isHudOverlayMousePassthroughSupported()) return;
	const screen = getScreen();
	const cursor = screen.getCursorScreenPoint();
	const display = screen.getDisplayNearestPoint(cursor);
	if (getHudOverlayDisplay().id === display.id) return;
	hudOverlayDisplayId = display.id;
	applyHudOverlayBounds();
	const { workArea } = display;
	const change: HudDisplayChange = {
		displayId: display.id, workArea, cursor: { x: cursor.x - workArea.x, y: cursor.y - workArea.y },
	};
	hud.webContents.send("hud-overlay-display-changed", change);
});

const editorWindows = new Set<BrowserWindow>();
let recordingPreparationActive = false;
function getHudEditorMode() {
	return isHudInEditorMode(
		editorWindows.size,
		recordingPreparationActive,
		hudOverlayRecordingActive,
	);
}
export function setHudRecordingPreparationActive(active: boolean) {
	recordingPreparationActive = active;
	notifyEditorMode();
}
function notifyEditorMode() {
	if (hudOverlayWindow && !hudOverlayWindow.webContents.isDestroyed()) {
		hudOverlayWindow.webContents.send("editor-mode-changed", getHudEditorMode());
	}
}
ipcMain.handle("get-editor-mode", getHudEditorMode);
ipcMain.on("hud-overlay-quit-app", ({ sender }) => {
	if (sender !== getHudOverlayWindow()?.webContents) return;
	if (hudCaptureStarting || hudOverlayRecordingActive) return;
	app.quit();
});

export function createHudOverlayWindow(recovery?: { show: boolean }): BrowserWindow {
	const perfStart = Date.now();
	loadHudOverlayCaptureProtectionSetting();
	hudOverlayFallbackExpanded = false;
	hudOverlayWebcamPreviewVisible = false;
	hudOverlayDisplayId = getHudOverlayDisplay().id;
	const initialBounds = getHudOverlayBounds();
	let hasShownHudWindow = false;

	const win = new BrowserWindow({
		width: initialBounds.width,
		height: initialBounds.height,
		x: initialBounds.x,
		y: initialBounds.y,
		frame: false,
		transparent: true,
		backgroundColor: "#00000000",
		resizable: false,
		alwaysOnTop: true,
		// The HUD is LeadCut's persistent top-level window, so it owns the
		// Windows taskbar entry while auxiliary overlays stay hidden there.
		...getHudOverlayTaskbarOptions(process.platform),
		hasShadow: false,
		show: false,
		webPreferences: {
			preload: path.join(electronWindowsDir, "preload.cjs"),
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: false,
			backgroundThrottling: false,
		},
	});
	// Keep the recording controls and webcam above normal and full-screen apps.
	// Transparent regions remain click-through via setIgnoreMouseEvents().
	win.setAlwaysOnTop(true, "screen-saver");
	if (process.platform === "darwin") {
		win.setVisibleOnAllWorkspaces(true, {
			visibleOnFullScreen: true,
			skipTransformProcessType: true,
		});
	}

	const showHudWindow = () => {
		if (hasShownHudWindow || win.isDestroyed() || recovery?.show === false) {
			return;
		}
		if (
			updateToastWindow &&
			!updateToastWindow.isDestroyed() &&
			updateToastWindow.isVisible()
		) {
			hudWasVisibleBeforeUpdateToast = true;
			return;
		}
		hasShownHudWindow = true;
		// Showing or changing native window state can recreate platform window
		// flags. Reassert capture protection on both sides of the transition.
		applyHudOverlayCaptureProtectionToWindow(win, hudOverlayHiddenFromCapture);
		if (process.platform === "win32") {
			// A focusable window is required for a Windows taskbar entry, but the
			// always-on-top HUD must not steal focus when LeadCut starts.
			win.showInactive();
		} else {
			win.show();
		}
		win.moveTop();
		applyHudOverlayCaptureProtectionToWindow(win, hudOverlayHiddenFromCapture);
		if (process.platform === "win32" && isHudOverlayMousePassthroughSupported()) {
			win.setIgnoreMouseEvents(false);
			setTimeout(() => {
				if (!win.isDestroyed()) {
					setHudOverlayMousePassthrough(hudOverlayIgnoringMouse);
				}
			}, 50);
		}
	};

	applyHudOverlayCaptureProtectionToWindow(win, hudOverlayHiddenFromCapture);
	win.on("show", () => {
		if (!win.isDestroyed()) {
			applyHudOverlayCaptureProtectionToWindow(win, hudOverlayHiddenFromCapture);
		}
	});

	if (isHudOverlayMousePassthroughSupported()) {
		if (hudOverlayRecordingActive) {
			hudOverlayIgnoringMouse = false;
			win.setIgnoreMouseEvents(false);
		} else {
			hudOverlayIgnoringMouse = true;
			win.setIgnoreMouseEvents(true, { forward: true });
		}
	}

	// On Windows 11+, focus changes (e.g. showing a native notification) can break
	// setIgnoreMouseEvents forwarding on a transparent always-on-top window, making
	// it permanently click-through without hover detection.  Re-initialise the
	// pass-through-with-forwarding state whenever the window gains focus by toggling
	// the flag off then back on so the native WS_EX_TRANSPARENT flag is fully reset.
	if (process.platform === "win32" && isHudOverlayMousePassthroughSupported()) {
		win.on("focus", () => {
			if (!win.isDestroyed()) {
				win.setIgnoreMouseEvents(false);
				setTimeout(() => {
					if (!win.isDestroyed()) {
						setHudOverlayMousePassthrough(hudOverlayIgnoringMouse);
					}
				}, 50);
			}
		});
	}

	win.webContents.on("did-finish-load", () => {
		console.log(`[PERF:MAIN] HUD Window: did-finish-load in ${Date.now() - perfStart}ms`);
		// Load the tiny countdown renderer while the user chooses recording options.
		createCountdownWindow(true);
		win?.webContents.send("main-process-message", new Date().toLocaleString());
		// Safety fallback if renderer-ready signal never arrives.
		setTimeout(() => {
			showHudWindow();
		}, 1800);
	});
	win.webContents.on("render-process-gone", (_event, details) => {
		if (details.reason === "clean-exit" || win.isDestroyed() || hudOverlayWindow !== win) return;
		appLog("error", "hud-crash", "Recording controls renderer exited.", details);
		flushAppLogSync();
		const replacement = createHudOverlayWindow({
			show: !hasShownHudWindow || win.isVisible() || hudOverlayRecordingActive,
		});
		hudOverlayEvents.emit("recreated", win, replacement);
		win.destroy();
	});

	// Safety net: on Linux the renderer may fail to fire did-finish-load
	// (for example due to GPU/VAAPI startup issues). Show the window after
	// ready-to-show as a fallback so the HUD still appears.
	win.once("ready-to-show", () => {
		setTimeout(() => {
			if (!win.isDestroyed() && !win.isVisible()) {
				showHudWindow();
			}
		}, 500);
	});

	const handleHudRendererReady = () => {
		if (!win.isDestroyed()) {
			console.log(`[PERF:MAIN] HUD Window: renderer-ready in ${Date.now() - perfStart}ms`);
			showHudWindow();
		}
	};
	ipcMain.on("hud-overlay-renderer-ready", handleHudRendererReady);

	hudOverlayWindow = win;
	// Windows can constrain the constructor size against the primary work area
	// before placing the window on the saved display.
	if (isHudOverlayMousePassthroughSupported()) applyHudOverlayBounds();

	// On Linux the HUD is dragged by the OS via -webkit-app-region (Wayland
	// forbids client-side positioning). Mirror moved bounds into drag state.
	if (process.platform === "linux") {
		win.on("moved", () => {
			if (win.isDestroyed()) return;
			const { x, y } = win.getBounds();
			hudUserPosition = { x, y };
		});
	}

	// Reset the user's saved HUD position when displays change so the bar
	// doesn't end up stranded off-screen after a monitor is disconnected.
	const screen = getScreen();
	const handleDisplayRemoved = () => {
		hudUserPosition = null;
		if (isHudOverlayMousePassthroughSupported()) handleDisplayMetricsChanged();
	};
	const handleDisplayMetricsChanged = () => {
		if (hudUserPosition) {
			const displays = screen.getAllDisplays();
			const onScreen = displays.some(
				(d) =>
					hudUserPosition!.x >= d.workArea.x &&
					hudUserPosition!.x < d.workArea.x + d.workArea.width &&
					hudUserPosition!.y >= d.workArea.y &&
					hudUserPosition!.y < d.workArea.y + d.workArea.height,
			);
			if (!onScreen) {
				hudUserPosition = null;
			}
		}
		if (isHudOverlayMousePassthroughSupported()) {
			const { id, workArea } = getHudOverlayDisplay();
			hudOverlayDisplayId = id;
			applyHudOverlayBounds();
			const change: HudDisplayChange = { displayId: id, workArea };
			if (!win.webContents.isDestroyed()) win.webContents.send("hud-overlay-display-changed", change);
			return;
		}
		applyHudOverlayBounds();
	};
	screen.on("display-removed", handleDisplayRemoved);
	screen.on("display-metrics-changed", handleDisplayMetricsChanged);

	win.on("closed", () => {
		ipcMain.removeListener("hud-overlay-renderer-ready", handleHudRendererReady);
		screen.removeListener("display-removed", handleDisplayRemoved);
		screen.removeListener("display-metrics-changed", handleDisplayMetricsChanged);
		if (hudOverlayWindow === win) {
			hudOverlayWindow = null;
			hudOverlayDisplayId = undefined;
			recordingPreparationActive = false;
			hudCaptureStarting = false;
			hudOverlayRecordingActive = false;
		}
	});

	const query: Record<string, string> = { windowType: "hud-overlay" };
	if (recovery) query.hudRecovered = "1";
	if (VITE_DEV_SERVER_URL) {
		win.loadURL(`${VITE_DEV_SERVER_URL}?${new URLSearchParams(query)}`);
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query,
		});
	}

	return win;
}

export function getHudOverlayWindow(): BrowserWindow | null {
	return hudOverlayWindow && !hudOverlayWindow.isDestroyed() ? hudOverlayWindow : null;
}

/**
 * Re-initialise the HUD overlay's mouse passthrough state.
 *
 * On Windows 11+, any new BrowserWindow appearing (even focusable:false ones
 * like the source highlight overlay) can silently corrupt the
 * WS_EX_TRANSPARENT flag that backs setIgnoreMouseEvents forwarding.  Call
 * this after any operation that creates or destroys a sibling window so that
 * hover detection on the HUD is immediately restored without requiring the
 * user to move their mouse over the bar.
 */
export function reassertHudOverlayMousePassthrough(): void {
	if (process.platform !== "win32" || !isHudOverlayMousePassthroughSupported()) {
		return;
	}

	const hud = getHudOverlayWindow();
	if (!hud) {
		return;
	}

	// Toggle off then back on so the native WS_EX_TRANSPARENT flag is fully
	// re-initialised rather than merely re-asserted in a potentially broken state.
	hud.setIgnoreMouseEvents(false);
	if (hudOverlayMouseReassertTimer) {
		clearTimeout(hudOverlayMouseReassertTimer);
	}
	hudOverlayMouseReassertTimer = setTimeout(() => {
		hudOverlayMouseReassertTimer = null;
		if (!hud.isDestroyed()) {
			setHudOverlayMousePassthrough(hudOverlayIgnoringMouse);
		}
	}, 50);
}

export function setHudOverlayRecordingActive(recording: boolean): void {
	hudCaptureStarting = false;
	hudOverlayRecordingActive = Boolean(recording);
	notifyEditorMode();
	hudOverlayFallbackExpanded = false;
	applyHudOverlayBounds();
	reassertHudOverlayCaptureProtection();
	// Start in passthrough mode. Forwarded pointer movement lets the renderer
	// make the visible HUD controls interactive when the pointer reaches them,
	// while transparent parts never block the recorded application.
	setHudOverlayMousePassthrough(true);
}

export function createUpdateToastWindow(): BrowserWindow {
	const initialBounds = getUpdateToastBounds();

	const win = new BrowserWindow({
		width: initialBounds.width,
		height: initialBounds.height,
		x: initialBounds.x,
		y: initialBounds.y,
		frame: false,
		transparent: true,
		resizable: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		hasShadow: false,
		show: false,
		focusable: true,
		backgroundColor: "#00000000",
		webPreferences: {
			preload: path.join(electronWindowsDir, "preload.cjs"),
			nodeIntegration: false,
			contextIsolation: true,
			backgroundThrottling: false,
		},
	});

	if (process.platform === "darwin") {
		win.setAlwaysOnTop(true, "status");
	}

	win.setVisibleOnAllWorkspaces(true, {
		visibleOnFullScreen: true,
	// Keep LeadCut a foreground application so macOS does not temporarily
		// remove its Dock icon while showing an overlay window.
		skipTransformProcessType: process.platform === "darwin",
	});
	updateToastWindow = win;

	win.on("closed", () => {
		if (updateToastWindow === win) {
			updateToastWindow = null;
		}
		restoreHudAfterUpdateToast();
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=update-toast");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "update-toast" },
		});
	}

	return win;
}

export function getUpdateToastWindow(): BrowserWindow | null {
	return updateToastWindow && !updateToastWindow.isDestroyed() ? updateToastWindow : null;
}

export function showUpdateToastWindow(): BrowserWindow {
	const win = getUpdateToastWindow() ?? createUpdateToastWindow();
	const hud = getHudOverlayWindow();
	if (!win.isVisible()) {
		hudWasVisibleBeforeUpdateToast = Boolean(hud?.isVisible());
	}
	if (hud?.isVisible()) {
		hud.hide();
	}
	positionUpdateToastWindow();
	if (!win.isVisible()) {
		if (process.platform === "win32") {
			win.show();
		} else {
			win.showInactive();
		}
	}
	win.moveTop();

	return win;
}

function restoreHudAfterUpdateToast(): void {
	if (!hudWasVisibleBeforeUpdateToast) {
		return;
	}

	hudWasVisibleBeforeUpdateToast = false;
	const hud = getHudOverlayWindow();
	if (!hud) {
		return;
	}

	if (process.platform === "win32") {
		hud.showInactive();
	} else {
		hud.show();
	}
	hud.moveTop();
	setHudOverlayMousePassthrough(hudOverlayIgnoringMouse);
}

export function hideUpdateToastWindow(): void {
	if (updateToastWindow && !updateToastWindow.isDestroyed()) {
		updateToastWindow.hide();
	}
	restoreHudAfterUpdateToast();
}

function loadPackagedEditorWindow(win: BrowserWindow) {
	const query = getEditorWindowQuery();
	const queryString = new URLSearchParams(query).toString();
	const indexHtmlPath = path.join(RENDERER_DIST, "index.html");
	const packagedRendererBaseUrl = getPackagedRendererBaseUrl();
	const webContents = win.webContents;

	const loadFromFile = () => {
		if (win.isDestroyed()) {
			return;
		}

		console.log("[editor-window] load-file", indexHtmlPath);
		void win.loadFile(indexHtmlPath, { query });
	};

	if (!packagedRendererBaseUrl) {
		loadFromFile();
		return;
	}

	const targetUrl = `${packagedRendererBaseUrl}/?${queryString}`;
	let settled = false;
	let timeoutId: NodeJS.Timeout | null = setTimeout(() => {
		fallbackToFile("load-timeout");
	}, 5000);

	const clearTimeoutIfNeeded = () => {
		if (timeoutId) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
	};

	const detachLoadListeners = () => {
		clearTimeoutIfNeeded();
		if (webContents.isDestroyed()) {
			return;
		}

		webContents.removeListener("did-fail-load", handleDidFailLoad);
		webContents.removeListener("did-finish-load", handleDidFinishLoad);
	};

	const fallbackToFile = (reason: string, details?: Record<string, unknown>) => {
		if (settled || win.isDestroyed()) {
			return;
		}

		settled = true;
		detachLoadListeners();
		console.warn("[editor-window] packaged renderer URL failed, falling back to file", {
			reason,
			targetUrl,
			...details,
		});
		loadFromFile();
	};

	const handleDidFailLoad = (
		_event: Electron.Event,
		errorCode: number,
		errorDescription: string,
		validatedURL: string,
		isMainFrame: boolean,
	) => {
		if (!isMainFrame || validatedURL !== targetUrl) {
			return;
		}

		fallbackToFile("did-fail-load", {
			errorCode,
			errorDescription,
			validatedURL,
		});
	};

	const handleDidFinishLoad = async () => {
		if (settled || webContents.getURL() !== targetUrl) return;
		clearTimeoutIfNeeded();
		timeoutId = setTimeout(() => fallbackToFile("editor-preload-check-timeout"), 750);
		const bridgeReady = await webContents.mainFrame.executeJavaScript(
			"typeof window.electronAPI?.onWindowChromeChanged === 'function'",
		).catch(() => false);
		if (settled || win.isDestroyed() || webContents.getURL() !== targetUrl) return;
		if (!bridgeReady) {
			fallbackToFile("missing-editor-preload");
			return;
		}
		settled = true;
		detachLoadListeners();
	};

	webContents.on("did-fail-load", handleDidFailLoad);
	webContents.on("did-finish-load", handleDidFinishLoad);
	win.once("closed", clearTimeoutIfNeeded);

	console.log("[editor-window] load-url", targetUrl);
	void win.loadURL(targetUrl).catch((error) => {
		fallbackToFile("load-url-rejected", {
			error: error instanceof Error ? error.message : String(error),
		});
	});
}

export function createEditorWindow(onRendererCrash: () => Promise<boolean>): BrowserWindow {
	const perfStart = Date.now();
	console.log("[PERF:MAIN] createEditorWindow: STARTED");
	const isMac = process.platform === "darwin";
	const { workArea, workAreaSize } = getScreen().getPrimaryDisplay();
	const initialWidth = isMac ? Math.round(workAreaSize.width * 0.85) : workArea.width;
	const initialHeight = isMac ? Math.round(workAreaSize.height * 0.85) : workArea.height;

	const win = new BrowserWindow({
		width: initialWidth,
		height: initialHeight,
		...(!isMac && {
			x: workArea.x,
			y: workArea.y,
		}),
		minWidth: 800,
		minHeight: 600,
		...(process.platform !== "darwin" && {
			icon: WINDOW_ICON_PATH,
		}),
		...(isMac && {
			titleBarStyle: "hiddenInset",
			trafficLightPosition: { x: 16, y: 20 },
		}),
		autoHideMenuBar: !isMac,
		transparent: false,
		resizable: true,
		alwaysOnTop: false,
		skipTaskbar: false,
		title: APP_NAME,
		show: false,
		backgroundColor: "#000000",
		webPreferences: {
			preload: path.join(electronWindowsDir, "preload.cjs"),
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: false,
			backgroundThrottling: false,
		},
	});

	recordingPreparationActive = false;
	editorWindows.add(win);
	notifyEditorMode();
	win.once("closed", () => {
		editorWindows.delete(win);
		notifyEditorMode();
	});

	const publishWindowChrome = () => {
		if (!win.isDestroyed())
			win.webContents.send("window-chrome-changed", {
				trafficLightsVisible: isMac && !win.isFullScreen() && !win.isSimpleFullScreen(),
			});
	};
	win.on("enter-full-screen", publishWindowChrome);
	win.on("leave-full-screen", publishWindowChrome);
	win.on("resize", publishWindowChrome);
	win.webContents.on("did-finish-load", publishWindowChrome);

	win.once("ready-to-show", () => {
		console.log(`[PERF:MAIN] Editor Window: ready-to-show in ${Date.now() - perfStart}ms`);
		win.show();
	});

	win.webContents.on("did-finish-load", () => {
		console.log(`[PERF:MAIN] Editor Window: did-finish-load in ${Date.now() - perfStart}ms`);
		createCountdownWindow(true);
		win?.webContents.send("main-process-message", new Date().toLocaleString());
		// Fallback for Linux/Wayland where `ready-to-show` may not fire reliably.
		if (!win.isDestroyed() && !win.isVisible()) {
			console.log("[editor-window] forcing show after did-finish-load");
			win.show();
		}
	});

	win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
		console.error("[editor-window] did-fail-load", {
			errorCode,
			errorDescription,
			validatedURL,
		});
	});

	let reloads: number[] = [];
	let recovering = false;
	let notifyAfterReload = false;
	win.webContents.on("did-finish-load", () => {
		if (!notifyAfterReload || win.isDestroyed()) return;
		notifyAfterReload = false;
		win.webContents.send("renderer-recovered");
	});
	win.webContents.on("render-process-gone", (_event, details) => {
		if (details.reason === "clean-exit" || recovering || win.isDestroyed()) return;
		appLog("error", "editor-crash", "Editor renderer exited.", details);
		flushAppLogSync();
		recovering = true;
		void (async () => {
			if (!(await onRendererCrash()) || win.isDestroyed()) return;
			const now = Date.now();
			if (shouldReload(details.reason, reloads, now)) {
				reloads = [...recentReloads(reloads, now), now];
				notifyAfterReload = true;
				// Release the latch before the load. A renderer may crash again during startup.
				recovering = false;
				win.webContents.reload();
				return;
			}
			const choice = await dialog.showMessageBox(win, {
				type: "error",
				title: uiText("editorRepeatedCrashTitle"),
				message: uiText("editorRepeatedCrashMessage"),
				buttons: [uiText("openApplicationLogs"), uiText("close")],
				defaultId: 0,
				cancelId: 1,
			});
			if (choice.response === 0) await shell.openPath(APP_LOG_DIRECTORY);
			if (!win.isDestroyed()) win.close();
		})().catch(error => appLog("error", "editor-crash", "Editor recovery failed.", error))
			.finally(() => { recovering = false; });
	});

	win.on("show", () => {
		console.log("[editor-window] show");
	});

	win.on("focus", () => {
		console.log("[editor-window] focus");
	});

	win.on("enter-full-screen", () => {
		if (!win.isDestroyed()) win.webContents.send("window-fullscreen-changed", true);
	});

	win.on("leave-full-screen", () => {
		if (!win.isDestroyed()) win.webContents.send("window-fullscreen-changed", false);
	});

	if (VITE_DEV_SERVER_URL) {
		const query = new URLSearchParams(getEditorWindowQuery());
		win.loadURL(`${VITE_DEV_SERVER_URL}?${query.toString()}`);
	} else {
		loadPackagedEditorWindow(win);
	}

	return win;
}

export function createSourceSelectorWindow(): BrowserWindow {
	const { x, y, width, height } = getHudOverlayDisplay().workArea;

	const win = new BrowserWindow({
		width: 620,
		height: 420,
		minHeight: 350,
		maxHeight: 500,
		x: Math.round(x + Math.max(0, (width - 620) / 2)),
		y: Math.round(y + Math.max(0, (height - 420) / 2)),
		frame: false,
		resizable: false,
		alwaysOnTop: true,
		transparent: true,
		show: false,
		...(process.platform !== "darwin" && {
			icon: WINDOW_ICON_PATH,
		}),
		backgroundColor: "#00000000",
		webPreferences: {
			preload: path.join(electronWindowsDir, "preload.cjs"),
			nodeIntegration: false,
			contextIsolation: true,
		},
	});

	win.webContents.on("did-finish-load", () => {
		setTimeout(() => {
			if (!win.isDestroyed()) {
				win.show();
			}
		}, 100);
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=source-selector");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "source-selector" },
		});
	}

	return win;
}

function createLiveAnnotationWindow(kind: LiveAnnotationWindowKind, bounds: Electron.Rectangle) {
	const win = new BrowserWindow({
		...bounds, show: false, frame: false, transparent: true, backgroundColor: "#00000000",
		alwaysOnTop: true, focusable: kind === "toolbar", skipTaskbar: true, resizable: true, thickFrame: false,
		movable: false, minimizable: false, maximizable: false, fullscreenable: false, hasShadow: false,
		webPreferences: {
			preload: path.join(electronWindowsDir, "preload.cjs"), nodeIntegration: false, contextIsolation: true,
			backgroundThrottling: false,
		},
	});
	win.setBounds(bounds);
	win.setResizable(false);
	win.setAlwaysOnTop(true, "screen-saver");
	win.setContentProtection(protectsLiveAnnotationWindow(kind));
	if (kind === "canvas") win.setIgnoreMouseEvents(true);
	const query = { windowType: `live-annotation-${kind}` };
	const base = VITE_DEV_SERVER_URL ?? getPackagedRendererBaseUrl();
	if (base) void win.loadURL(`${base.replace(/\/$/, "")}/?${new URLSearchParams(query)}`);
	else void win.loadFile(path.join(RENDERER_DIST, "index.html"), { query });
	return win;
}

export function createLiveAnnotationCanvasWindow(bounds: Electron.Rectangle) {
	return createLiveAnnotationWindow("canvas", bounds);
}

export function createLiveAnnotationToolbarWindow(bounds: Electron.Rectangle) {
	const width = Math.min(580, bounds.width - 12);
	return createLiveAnnotationWindow("toolbar", {
		x: bounds.x + bounds.width - width - 12, y: bounds.y + 16,
		width, height: 99,
	});
}

export function createCountdownWindow(prepareOnly = false, targetWorkArea?: HudOverlayWorkArea): BrowserWindow {
	const position = getCountdownWindowPosition(targetWorkArea ?? getHudOverlayDisplay().workArea);
	const showWhenReady = (win: BrowserWindow) => {
		const show = () => {
			if (win.isDestroyed()) return;
			if (process.platform === "win32") {
				win.showInactive();
				win.moveTop();
			} else win.show();
		};
		if (win.webContents.isLoadingMainFrame()) win.webContents.once("did-finish-load", show);
		else show();
	};
	if (countdownWindow && !countdownWindow.isDestroyed()) {
		if (!prepareOnly) {
			countdownWindow.setPosition(position.x, position.y, false);
			showWhenReady(countdownWindow);
		}
		return countdownWindow;
	}

	const win = new BrowserWindow({
		width: COUNTDOWN_WINDOW_SIZE,
		height: COUNTDOWN_WINDOW_SIZE,
		...position,
		frame: false,
		transparent: true,
		resizable: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		hasShadow: false,
		focusable: true,
		show: false,
		webPreferences: {
			preload: path.join(electronWindowsDir, "preload.cjs"),
			nodeIntegration: false,
			contextIsolation: true,
		},
	});

	countdownWindow = win;
	if (process.platform === "win32") {
		// Native capture now warms up while the countdown is visible.
		win.setContentProtection(true);
	}

	win.setVisibleOnAllWorkspaces(true, {
		visibleOnFullScreen: true,
	// Keep LeadCut a foreground application so macOS does not temporarily
		// remove its Dock icon while showing the countdown.
		skipTransformProcessType: process.platform === "darwin",
	});

	win.on("closed", () => {
		if (countdownWindow === win) {
			countdownWindow = null;
		}
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=countdown");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "countdown" },
		});
	}
	if (!prepareOnly) showWhenReady(win);

	return win;
}

export function getCountdownWindow(): BrowserWindow | null {
	return countdownWindow;
}

export function closeCountdownWindow(): void {
	if (countdownWindow && !countdownWindow.isDestroyed()) {
		countdownWindow.close();
		countdownWindow = null;
	}
}
