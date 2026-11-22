import type { BrowserWindow, WebContents } from "electron";

type OpenExternal = (url: string) => Promise<unknown>;
type ReportOpenError = (url: string, error: unknown) => void;
const detachedPreviewWindows = new WeakMap<object, BrowserWindow>();

export function getDetachedPreviewWindow(owner: WebContents): BrowserWindow | null {
	const preview = detachedPreviewWindows.get(owner);
	return preview && !preview.isDestroyed() ? preview : null;
}

export type NavigationEvent = {
	url: string;
	preventDefault: () => void;
};

export function shouldHardenWebContentsType(type: ReturnType<WebContents["getType"]>): boolean {
	return type === "window";
}

export function normalizeExternalHttpUrl(value: string): string | null {
	try {
		const url = new URL(value);
		if (
			(url.protocol !== "http:" && url.protocol !== "https:") ||
			!url.hostname ||
			url.username ||
			url.password
		) {
			return null;
		}

		return url.href;
	} catch {
		return null;
	}
}

export function isInternalRendererTarget(currentValue: string, targetValue: string): boolean {
	try {
		const currentUrl = new URL(currentValue);
		const targetUrl = new URL(targetValue);

		if (targetUrl.username || targetUrl.password) {
			return false;
		}

		if (
			(currentUrl.protocol === "http:" || currentUrl.protocol === "https:") &&
			(targetUrl.protocol === "http:" || targetUrl.protocol === "https:")
		) {
			return currentUrl.origin === targetUrl.origin;
		}

		if (currentUrl.protocol === "file:" && targetUrl.protocol === "file:") {
			return currentUrl.host === targetUrl.host && currentUrl.pathname === targetUrl.pathname;
		}

		return currentUrl.href === targetUrl.href;
	} catch {
		return false;
	}
}

function isExactRendererLocation(currentValue: string, targetValue: string): boolean {
	try {
		const currentUrl = new URL(currentValue);
		const targetUrl = new URL(targetValue);
		return !targetUrl.username && !targetUrl.password && currentUrl.href === targetUrl.href;
	} catch {
		return false;
	}
}

function openExternalIfSafe(
	value: string,
	openExternal: OpenExternal,
	reportOpenError: ReportOpenError,
): void {
	const safeUrl = normalizeExternalHttpUrl(value);
	if (!safeUrl) {
		return;
	}

	try {
		void openExternal(safeUrl).catch((error) => reportOpenError(safeUrl, error));
	} catch (error) {
		reportOpenError(safeUrl, error);
	}
}

const defaultReportOpenError: ReportOpenError = (url, error) => {
	console.error("[navigation-policy] Failed to open external URL", { url, error });
};

export function createWillNavigateHandler(
	getTrustedRendererUrl: () => string,
	openExternal: OpenExternal,
	reportOpenError: ReportOpenError = defaultReportOpenError,
) {
	return (event: NavigationEvent): void => {
		const trustedRendererUrl = getTrustedRendererUrl();
		// Preserve an exact reload, but freeze all renderer-selected destination changes,
		// including same-origin query mutations that can carry privileged local paths.
		if (isExactRendererLocation(trustedRendererUrl, event.url)) {
			return;
		}

		// The internal-target check only prevents app URLs from leaking into the system browser.
		event.preventDefault();
		if (isInternalRendererTarget(trustedRendererUrl, event.url)) {
			return;
		}

		openExternalIfSafe(event.url, openExternal, reportOpenError);
	};
}

export function createWillRedirectHandler() {
	return (event: NavigationEvent): void => {
		event.preventDefault();
	};
}

export function createWindowOpenHandler(
	getCurrentUrl: () => string,
	openExternal: OpenExternal,
	reportOpenError: ReportOpenError = defaultReportOpenError,
) {
	return (details: { url: string; frameName?: string }) => {
		const current = new URL(getCurrentUrl() || "about:blank");
		const isLocalEditor = current.searchParams.get("windowType") === "editor" &&
			(current.protocol === "file:" || ((current.protocol === "http:" || current.protocol === "https:") && ["127.0.0.1", "localhost"].includes(current.hostname)));
		if (isLocalEditor && details.url === "about:blank" && details.frameName === "leadcut-preview") {
			return {
				action: "allow" as const,
				overrideBrowserWindowOptions: {
					title: "LeadCut Preview",
					minWidth: 480,
					minHeight: 320,
					backgroundColor: "#101114",
					webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
				},
			};
		}
		if (!isInternalRendererTarget(getCurrentUrl(), details.url)) {
			openExternalIfSafe(details.url, openExternal, reportOpenError);
		}
		return { action: "deny" as const };
	};
}

export function hardenWebContentsNavigation(
	webContents: Pick<WebContents, "getURL" | "on" | "setWindowOpenHandler" | "send" | "isDestroyed">,
	openExternal: OpenExternal,
	reportOpenError: ReportOpenError = defaultReportOpenError,
): void {
	// Renderer history APIs mutate getURL() without a document navigation. Keep the last
	// main-frame document URL as the reload trust boundary instead of trusting that live value.
	let trustedRendererUrl = webContents.getURL();
	webContents.on("did-navigate", (_event, url) => {
		trustedRendererUrl = url;
	});
	webContents.on(
		"will-navigate",
		createWillNavigateHandler(() => trustedRendererUrl, openExternal, reportOpenError),
	);
	webContents.on("will-redirect", createWillRedirectHandler());
	webContents.setWindowOpenHandler(
		createWindowOpenHandler(() => webContents.getURL(), openExternal, reportOpenError),
	);
	webContents.on("did-create-window", (window, details) => {
		if (details.url !== "about:blank" || details.frameName !== "leadcut-preview") return;
		detachedPreviewWindows.set(webContents, window);
		const publish = (fullscreen: boolean) => {
			if (!webContents.isDestroyed() && detachedPreviewWindows.get(webContents) === window) {
				webContents.send("detached-preview-fullscreen-changed", fullscreen);
			}
		};
		window.on("enter-full-screen", () => publish(true));
		window.on("leave-full-screen", () => publish(false));
		window.once("closed", () => {
			if (detachedPreviewWindows.get(webContents) === window) detachedPreviewWindows.delete(webContents);
		});
	});
}
