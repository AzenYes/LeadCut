export function getExportStorageErrorKey(error: unknown): "exportStorageFull" | "exportDestinationInUse" | undefined {
	const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
	const message = error instanceof Error ? error.message : String(error ?? "");
	if (code === "ENOSPC" || /\bENOSPC\b|no space left on device|not enough space on the disk|\b0x80070070\b/i.test(message)) {
		return "exportStorageFull";
	}
	if (code === "EBUSY" || /\bEBUSY\b|being used by another process|\b0x80070020\b/i.test(message)) {
		return "exportDestinationInUse";
	}
}

export function isExportStorageFull(error: unknown): boolean {
	return getExportStorageErrorKey(error) === "exportStorageFull";
}
