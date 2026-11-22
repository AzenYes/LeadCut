type Level = "info" | "warn" | "error";

function log(level: Level, scope: string, message: string, detail?: unknown) {
	try {
		window.electronAPI?.writeAppLog?.(level, scope, message,
			detail instanceof Error ? detail.stack ?? detail.message :
				detail === undefined ? undefined : String(detail));
	} catch { /* A failed log message must never disrupt the renderer. */ }
}

export const logInfo = (scope: string, message: string, detail?: unknown) => log("info", scope, message, detail);
export const logWarn = (scope: string, message: string, detail?: unknown) => log("warn", scope, message, detail);
export function logError(scope: string, error: unknown, detail?: unknown) {
	const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
	log("error", scope, message, detail ?? (error instanceof Error ? error : undefined));
}
