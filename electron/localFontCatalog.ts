import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BrowserWindow, session } from "electron";
import { getPrebundledNativeHelperPath } from "./ipc/paths/binaries";

const MAX_CACHE_AGE_MS = 60_000;
const READ_TIMEOUT_MS = 8_000;
let cached: { families: string[]; expiresAt: number } | undefined;
let pending: Promise<string[]> | undefined;

const execFileAsync = promisify(execFile);

async function readSystemFontFamilies(documentPath: string): Promise<string[]> {
	if (process.platform === "win32") {
		try {
			const { stdout } = await execFileAsync(
				getPrebundledNativeHelperPath("leadcut-local-font-catalog.exe"),
				{
					encoding: "utf8",
					windowsHide: true,
					timeout: 2500,
					maxBuffer: 2 * 1024 * 1024,
				},
			);
			const families = stdout.split(/\r?\n/).filter(Boolean);
			if (families.length) return families;
		} catch {
			// Source checkouts without the native helper still support system fonts.
		}
	}
	return readChromiumFontFamilies(documentPath);
}

async function readChromiumFontFamilies(documentPath: string): Promise<string[]> {
	// The editor's media window does not expose Local Font Access. Use a dedicated
	// sandboxed document with web security enabled and no application preload.
	const fontSession = session.fromPartition("leadcut-local-font-catalog");
	const window = new BrowserWindow({
		show: false,
		webPreferences: { session: fontSession, sandbox: true, contextIsolation: true },
	});
	const contents = window.webContents;
	const canQuery = (
		sender: Electron.WebContents | null,
		permission: string,
		isMainFrame: boolean,
	) => sender === contents && permission === "local-fonts" && isMainFrame;
	fontSession.setPermissionCheckHandler((sender, permission, _origin, details) =>
		canQuery(sender, permission, details.isMainFrame),
	);
	fontSession.setPermissionRequestHandler((sender, permission, respond, details) =>
		respond(canQuery(sender, permission, details.isMainFrame)),
	);
	contents.on("will-navigate", (event) => event.preventDefault());
	contents.setWindowOpenHandler(() => ({ action: "deny" }));
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const read = async (): Promise<string[]> => {
			await window.loadFile(documentPath);
			return contents.executeJavaScript(
				`(async () => {
				if (typeof window.queryLocalFonts !== 'function') throw new Error('Local font access is unavailable');
				const fonts = await window.queryLocalFonts();
				return [...new Set(fonts.map(font => font.family.trim()).filter(Boolean))];
			})()`,
				true,
			);
		};
		const timeout = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(
				() => reject(new Error("Local font enumeration timed out")),
				READ_TIMEOUT_MS,
			);
		});
		return await Promise.race([read(), timeout]);
	} finally {
		clearTimeout(timer);
		fontSession.setPermissionCheckHandler(null);
		fontSession.setPermissionRequestHandler(null);
		if (!window.isDestroyed()) window.destroy();
	}
}

export function getSystemFontFamilies(documentPath: string, refresh = false): Promise<string[]> {
	if (pending) return pending;
	if (!refresh && cached && Date.now() < cached.expiresAt)
		return Promise.resolve(cached.families);
	pending = readSystemFontFamilies(documentPath)
		.then((families) => {
			cached = { families, expiresAt: Date.now() + MAX_CACHE_AGE_MS };
			return families;
		})
		.finally(() => {
			pending = undefined;
		});
	return pending;
}
