export const PROJECT_FORMAT_VERSION = 2;

export function requiresNewerProjectReader(project: unknown) {
	if (!project || typeof project !== "object") return false;
	const { version, minReaderVersion } = project as { version?: unknown; minReaderVersion?: unknown };
	return (typeof version === "number" && version > PROJECT_FORMAT_VERSION) ||
		(typeof minReaderVersion === "number" && minReaderVersion > PROJECT_FORMAT_VERSION);
}

export function assertProjectFormatWritable(project: unknown) {
	if (requiresNewerProjectReader(project)) {
		throw new Error("This project requires a newer version of LeadCut.");
	}
}
