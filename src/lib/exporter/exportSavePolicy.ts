import { uiText } from "@/i18n/uiText";

export const MAX_IN_MEMORY_EXPORT_BYTES = 0x7fffffff;

export function normalizeExportExtension(extension: string): string {
	return extension.trim().toLowerCase();
}

export function isExportTooLargeForInMemorySave(byteLength: number): boolean {
	return byteLength > MAX_IN_MEMORY_EXPORT_BYTES;
}

export function canUseInMemoryExportSaveFallback({
	blobSize,
	extension,
	hasExportStreamApi,
}: {
	blobSize: number;
	extension: string;
	hasExportStreamApi: boolean;
}): boolean {
	if (isExportTooLargeForInMemorySave(blobSize)) {
		return false;
	}

	// In Electron, MP4 exports should stay on the temp-file path. If that path
	// failed, silently falling back to ArrayBuffer reintroduces the >2 GiB crash.
	if (hasExportStreamApi && normalizeExportExtension(extension) === "mp4") {
		return false;
	}

	return true;
}

export function describeBlockedInMemoryExportSave({
	blobSize,
	extension,
}: {
	blobSize: number;
	extension: string;
}): string {
	const normalizedExtension = normalizeExportExtension(extension) || "export";
	if (isExportTooLargeForInMemorySave(blobSize)) {
		return uiText("inMemoryExportSaveTooLarge", { value0: normalizedExtension.toUpperCase() });
	}

	return uiText("inMemoryExportSaveUnavailable", { value0: normalizedExtension.toUpperCase() });
}
