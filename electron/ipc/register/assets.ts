import { handleTrustedIpc } from "../../trustedIpc";
import { uiText } from "../../uiI18n";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app } from "electron";
import { USER_DATA_PATH } from "../../appPaths";
import { getPackagedRendererBaseUrl } from "../../rendererServer";
import { getAssetRootPath, isAllowedLocalReadPath, isPathInsideDirectory } from "../project/manager";
import { normalizePath } from "../utils";

export function registerAssetHandlers() {
	async function resolveReadableLocalFilePath(filePath: string) {
		const normalizedPath = normalizePath(filePath);
		if (!isAllowedLocalReadPath(normalizedPath)) throw new Error(uiText("pathIsNotAReadableFile"));
		const resolvedPath = await fs.realpath(normalizedPath);
		const stats = await fs.stat(resolvedPath);
		if (!stats.isFile()) {
			throw new Error(uiText("pathIsNotAReadableFile"));
		}
		return normalizePath(resolvedPath);
	}

	// Generate a tiny thumbnail for a wallpaper image and cache it in userData.
	// Returns the cached thumbnail as raw JPEG bytes for fast grid rendering.
	// Serialized to prevent concurrent nativeImage operations from eating memory.
	const THUMB_SIZE = 96;
	const thumbCacheDir = path.join(USER_DATA_PATH, "wallpaper-thumbs");
	let thumbGenerationQueue: Promise<void> = Promise.resolve();

	handleTrustedIpc("generate-wallpaper-thumbnail", async (_, filePath: string) => {
		try {
			const bundled = filePath.startsWith("/wallpapers/");
			const wallpaperRoot = path.resolve(getAssetRootPath(), "wallpapers");
			const candidate = bundled
				? path.resolve(
						wallpaperRoot,
						decodeURIComponent(filePath.slice("/wallpapers/".length)),
					)
				: filePath;
			if (
				bundled &&
				(path.relative(wallpaperRoot, candidate).startsWith("..") ||
					path.isAbsolute(path.relative(wallpaperRoot, candidate)))
			) {
				throw new Error(uiText("wallpaperPathIsOutsideTheBundledWallpapers"));
			}
			const resolved = await resolveReadableLocalFilePath(candidate);

			// Deterministic cache key from file path + mtime
			const stat = await fs.stat(resolved);
			const cacheKey = createHash("sha256")
				.update(`${resolved}:${stat.mtimeMs}`)
				.digest("hex");
			const thumbPath = path.join(thumbCacheDir, `${cacheKey}.jpg`);

			// Return cached thumbnail if it exists (no queue needed)
			if (existsSync(thumbPath)) {
				const data = await fs.readFile(thumbPath);
				return { success: true, data };
			}

			// Serialize nativeImage operations to avoid OOM from concurrent full-res decodes
			let jpegData: Buffer;
			const generation = thumbGenerationQueue.then(async () => {
				const { nativeImage } = await import("electron");
				const img = nativeImage.createFromPath(resolved);
				if (img.isEmpty()) {
					throw new Error(uiText("failedToLoadImage"));
				}
				const { width, height } = img.getSize();
				const scale = THUMB_SIZE / Math.min(width, height);
				const resized = img.resize({
					width: Math.round(width * scale),
					height: Math.round(height * scale),
					quality: "good",
				});
				jpegData = resized.toJPEG(70);

				// Cache to disk
				await fs.mkdir(thumbCacheDir, { recursive: true });
				await fs.writeFile(thumbPath, jpegData);
			});
			// Keep the queue moving even if one fails
			thumbGenerationQueue = generation.catch(() => undefined);
			await generation;

			return { success: true, data: jpegData! };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});

	// Native exporters need a file path while the renderer uses the asset server URL.
	handleTrustedIpc("resolve-native-bundled-image-path", async (_, asset: unknown) => {
		if (typeof asset !== "string") return null;
		const match = /^\/(wallpapers|app-icons)\/([^/\\]+)$/.exec(asset);
		if (!match) return null;
		try {
			const fileName = decodeURIComponent(match[2]);
			if (/[/\\:\0]/.test(fileName) || !/\.(?:avif|bmp|gif|ico|jpe?g|png|webp)$/i.test(fileName)) {
				return null;
			}
			const directory = path.join(getAssetRootPath(), match[1]);
			const resolved = await resolveReadableLocalFilePath(path.join(directory, fileName));
			return isPathInsideDirectory(resolved, directory) ? resolved : null;
		} catch {
			return null;
		}
	});

	// Return the base URL used by the renderer to load bundled assets.
	handleTrustedIpc("get-asset-base-path", () => {
		if (!app.isPackaged) {
			return null;
		}

		try {
			const rendererBase = getPackagedRendererBaseUrl();
			if (rendererBase) return new URL("/bundled-assets/", rendererBase).href;
			const assetPath = getAssetRootPath();
			return pathToFileURL(`${assetPath}${path.sep}`).toString();
		} catch (err) {
			console.error("Failed to resolve asset base path:", err);
			return null;
		}
	});

	handleTrustedIpc("list-asset-directory", async (_, relativeDir: string) => {
		try {
			const normalizedRelativeDir = String(relativeDir ?? "")
				.replace(/\\/g, "/")
				.replace(/^\/+/, "");

			const assetRootPath = path.resolve(getAssetRootPath());
			const targetDirPath = path.resolve(assetRootPath, normalizedRelativeDir);
			if (
				targetDirPath !== assetRootPath &&
				!targetDirPath.startsWith(`${assetRootPath}${path.sep}`)
			) {
				return { success: false, error: "Invalid asset directory" };
			}

			const entries = await fs.readdir(targetDirPath, { withFileTypes: true });
			const files = entries
				.filter((entry) => entry.isFile())
				.map((entry) => entry.name)
				.sort(new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare);

			return { success: true, files };
		} catch (error) {
			console.error("Failed to list asset directory:", error);
			return { success: false, error: String(error) };
		}
	});

	handleTrustedIpc("read-local-file", async (_, filePath: string) => {
		try {
			const resolved = await resolveReadableLocalFilePath(filePath);

			const data = await fs.readFile(resolved);
			return { success: true, data };
		} catch (error) {
			console.error("Failed to read local file:", error);
			return { success: false, error: String(error) };
		}
	});
}
