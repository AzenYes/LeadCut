import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { listenForBrowserOnLoopback } from "./loopbackHttp";

const MIME_TYPES: Record<string, string> = {
	".css": "text/css; charset=utf-8",
	".gif": "image/gif",
	".html": "text/html; charset=utf-8",
	".ico": "image/x-icon",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".mjs": "text/javascript; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".txt": "text/plain; charset=utf-8",
	".wasm": "application/wasm",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".mp4": "video/mp4",
	".webm": "video/webm",
};

let packagedRendererBaseUrl: string | null = null;
let packagedRendererServerStartPromise: Promise<string> | null = null;

function getContentType(filePath: string): string {
	return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function getCacheControl(filePath: string): string {
	// Vite fingerprints production assets, so they can be reused across the HUD,
	// picker, toast, and editor windows without revalidation. Keep index.html
	// uncached because it points at the current fingerprinted files.
	return /-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(path.basename(filePath))
		? "public, max-age=31536000, immutable"
		: "no-cache";
}

function resolveRequestedFilePath(rootDir: string, requestPathname: string): string | null {
	const trimmedPathname = requestPathname === "/" ? "/index.html" : requestPathname;

	// path.normalize() on Windows converts / to \, making the leading-slash
	// regex fail and causing path.resolve to escape to the drive root.
	const normalizedPosix = path.posix.normalize(decodeURIComponent(trimmedPathname));
	const relativePath = normalizedPosix.replace(/^\/+/, "");

	if (!relativePath) {
		return null;
	}

	const resolvedRootDir = path.resolve(rootDir);
	const resolvedFilePath = path.resolve(resolvedRootDir, relativePath);

	if (
		resolvedFilePath !== resolvedRootDir &&
		!resolvedFilePath.startsWith(`${resolvedRootDir}${path.sep}`)
	) {
		return null;
	}

	return resolvedFilePath;
}

async function servePackagedRendererRequest(
	rootDir: string,
	assetDirectory: string | undefined,
	request: IncomingMessage,
	response: ServerResponse,
): Promise<void> {
	try {
		const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
		const isExtraAsset = requestUrl.pathname.startsWith("/bundled-assets/");
		const resolvedFilePath = isExtraAsset
			? assetDirectory && resolveRequestedFilePath(assetDirectory, requestUrl.pathname.slice("/bundled-assets".length))
			: resolveRequestedFilePath(rootDir, requestUrl.pathname);

		if (!resolvedFilePath) {
			response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Forbidden");
			return;
		}

		const filePath = resolvedFilePath;
		const fileContents = await fs.readFile(filePath);
		const scriptHashes = path.extname(filePath) === ".html"
			? [...fileContents.toString("utf8").matchAll(/<script\s*>([\s\S]*?)<\/script>/gi)].map(([, script]) =>
				`'sha256-${createHash("sha256").update(script.replace(/\r\n?/g, "\n")).digest("base64")}'`)
			: [];
		const contentSecurityPolicy = [
			"default-src 'self'",
			// The bundled export renderer generates shader bindings at runtime.
			`script-src 'self' 'unsafe-eval' ${scriptHashes.join(" ")}`,
			"style-src 'self' 'unsafe-inline'",
			"img-src 'self' data: blob: http://127.0.0.1:* https:",
			"media-src 'self' data: blob: http://127.0.0.1:* https:",
			"connect-src 'self' blob: data: http://127.0.0.1:* https:",
			"font-src 'self' data: blob:",
			"worker-src 'self' blob:",
			"object-src 'none'",
			requestUrl.pathname === "/export-frame.html" ? "frame-ancestors 'self'" : "frame-ancestors 'none'",
			"base-uri 'none'",
		].join("; ");

		response.writeHead(200, {
			"Cache-Control": getCacheControl(filePath),
			"Content-Type": getContentType(filePath),
			"Content-Security-Policy": contentSecurityPolicy,
		});

		if (request.method === "HEAD") {
			response.end();
			return;
		}

		response.end(fileContents);
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
			response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Not Found");
			return;
		}

		response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
		response.end("Internal Server Error");
	}
}

export function getPackagedRendererBaseUrl(): string | null {
	return packagedRendererBaseUrl;
}

export async function ensurePackagedRendererServer(rootDir: string, assetDirectory?: string): Promise<string> {
	if (packagedRendererBaseUrl) {
		return packagedRendererBaseUrl;
	}

	if (packagedRendererServerStartPromise) {
		return packagedRendererServerStartPromise;
	}

	const server = createServer((request, response) => {
		void servePackagedRendererRequest(rootDir, assetDirectory, request, response);
	});
	packagedRendererServerStartPromise = listenForBrowserOnLoopback(server).then(origin => {
		packagedRendererBaseUrl = origin;
		return origin;
	});

	try {
		return await packagedRendererServerStartPromise;
	} finally {
		packagedRendererServerStartPromise = null;
	}
}
