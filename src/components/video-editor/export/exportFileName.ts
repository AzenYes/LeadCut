export function suggestedExportFileName(projectDisplayName: string, extension: "gif" | "mp4") {
	const cleanName = projectDisplayName.replace(/[\\/:*?"<>|]/g, "").trim();
	return `${cleanName || "export"}.${extension}`;
}
