import { handleTrustedIpc, onTrustedIpc } from "./trustedIpc";
import { type BrowserWindow, type WebContents } from "electron";
import {
	DEFAULT_LIVE_ANNOTATION_OPTIONS, normalizeLiveAnnotationOptions,
	type LiveAnnotationCommand, type LiveAnnotationOptions,
} from "../src/components/live-annotation/liveAnnotationModel";
import { suspendMouseClickTelemetry } from "./ipc/cursor/interaction";
import { getDisplayBoundsForSource } from "./ipc/recording/ffmpeg";
import type { SelectedSource } from "./ipc/types";
import { supportsLiveAnnotation } from "./liveAnnotationPolicy";
import { appLog } from "./logger";
import {
	createLiveAnnotationCanvasWindow, createLiveAnnotationToolbarWindow, getHudOverlayWindow,
	reassertHudOverlayMousePassthrough,
} from "./windows";

let canvas: BrowserWindow | null = null;
let toolbar: BrowserWindow | null = null;
let sourceBounds: Electron.Rectangle | null = null;
let options: LiveAnnotationOptions = DEFAULT_LIVE_ANNOTATION_OPTIONS;
let active = false;
let canvasReady = false;

export function getLiveAnnotationState() {
	return { supported: !!canvas && !canvas.isDestroyed(), active };
}

function send(window: BrowserWindow | null, channel: string, data: unknown) {
	if (window && !window.isDestroyed()) window.webContents.send(channel, data);
}

function publishState() {
	const state = getLiveAnnotationState();
	send(getHudOverlayWindow(), "live-annotation-state-changed", state);
	if (canvasReady) send(canvas, "live-annotation-state-changed", state);
	return state;
}

function setAnnotationActive(next: boolean) {
	if (!canvas || canvas.isDestroyed() || !sourceBounds) return publishState();
	if (next && !canvasReady) return publishState();
	if (next && (!toolbar || toolbar.isDestroyed())) {
		try {
			const current = createLiveAnnotationToolbarWindow(sourceBounds);
			toolbar = current;
			current.webContents.once("did-finish-load", () => {
				if (toolbar !== current || current.isDestroyed()) return;
				send(current, "live-annotation-options", options);
				if (active) current.showInactive();
			});
			current.once("closed", () => {
				if (toolbar !== current) return;
				toolbar = null;
				setAnnotationActive(false);
			});
		} catch (error) {
			appLog("warn", "live-annotation", "Could not open the annotation toolbar.", error);
			return publishState();
		}
	}
	active = next;
	suspendMouseClickTelemetry(next);
	canvas.setIgnoreMouseEvents(!next);
	if (next) {
		if (toolbar && !toolbar.webContents.isLoadingMainFrame()) toolbar.showInactive();
		canvas.showInactive();
		if (toolbar?.isVisible()) toolbar.moveTop();
	} else {
		canvas.setFocusable(false);
		canvas.blur();
		toolbar?.hide();
	}
	getHudOverlayWindow()?.moveTop();
	reassertHudOverlayMousePassthrough();
	return publishState();
}

export function toggleLiveAnnotation() {
	return setAnnotationActive(!active);
}

export function configureLiveAnnotationRecording(recording: boolean, source?: SelectedSource | null) {
	const previousToolbar = toolbar;
	const previousCanvas = canvas;
	active = false;
	canvasReady = false;
	sourceBounds = null;
	canvas = null;
	toolbar = null;
	suspendMouseClickTelemetry(false);
	if (previousToolbar && !previousToolbar.isDestroyed()) previousToolbar.destroy();
	if (previousCanvas && !previousCanvas.isDestroyed()) previousCanvas.destroy();
	if (recording && source && supportsLiveAnnotation(process.platform, source.id)) {
		try {
			options = DEFAULT_LIVE_ANNOTATION_OPTIONS;
			sourceBounds = getDisplayBoundsForSource(source);
			const current = createLiveAnnotationCanvasWindow(sourceBounds);
			canvas = current;
			current.once("closed", () => {
				if (canvas === current) configureLiveAnnotationRecording(false);
			});
			current.once("ready-to-show", () => {
				if (canvas !== current || current.isDestroyed()) return;
				current.showInactive();
				getHudOverlayWindow()?.moveTop();
				reassertHudOverlayMousePassthrough();
			});
		} catch (error) {
			appLog("warn", "live-annotation", "Could not open the annotation canvas.", error);
		}
	}
	publishState();
}

function isSender(window: BrowserWindow | null, contents: WebContents) {
	return window && !window.isDestroyed() && contents === window.webContents;
}

export function registerLiveAnnotationIpc() {
	handleTrustedIpc("get-live-annotation-state", getLiveAnnotationState);
	handleTrustedIpc("toggle-live-annotation", ({ sender }) => {
		if (!isSender(getHudOverlayWindow(), sender) && !isSender(toolbar, sender)) return getLiveAnnotationState();
		return toggleLiveAnnotation();
	});
	handleTrustedIpc("live-annotation-set-tool", ({ sender }, supplied: unknown) => {
		if (!active || !isSender(toolbar, sender)) return false;
		const next = normalizeLiveAnnotationOptions(supplied);
		if (!next) return false;
		options = next;
		if (canvasReady) send(canvas, "live-annotation-options", options);
		return true;
	});
	handleTrustedIpc("live-annotation-command", ({ sender }, command: LiveAnnotationCommand) => {
		if (!active || !isSender(toolbar, sender) || !["undo", "redo", "clear"].includes(command)) return false;
		send(canvas, "live-annotation-command", command);
		return true;
	});
	handleTrustedIpc("live-annotation-text-focus", ({ sender }, focused: unknown) => {
		if (!canvas || !active || !isSender(canvas, sender) || typeof focused !== "boolean") return false;
		canvas.setFocusable(focused);
		if (focused) canvas.focus();
		else canvas.blur();
		return true;
	});
	onTrustedIpc("live-annotation-canvas-ready", ({ sender }) => {
		if (!isSender(canvas, sender)) return;
		canvasReady = true;
		send(canvas, "live-annotation-options", options);
		publishState();
	});
}
