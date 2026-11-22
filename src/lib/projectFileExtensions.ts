export const PROJECT_FILE_EXTENSION = "leadcut";
export const UPSTREAM_PROJECT_FILE_EXTENSION = "recordly";
export const LEGACY_PROJECT_FILE_EXTENSIONS = [UPSTREAM_PROJECT_FILE_EXTENSION, "openscreen"];

const knownExtensions = [PROJECT_FILE_EXTENSION, ...LEGACY_PROJECT_FILE_EXTENSIONS];

function projectExtension(fileName: string) {
	const baseName = fileName.split(/[\\/]/).pop() ?? "";
	const dot = baseName.lastIndexOf(".");
	return dot > 0 ? baseName.slice(dot + 1).toLowerCase() : "";
}

export function hasKnownProjectExtension(fileName: string): boolean {
	return knownExtensions.includes(projectExtension(fileName));
}

export function hasLegacyProjectExtension(fileName: string): boolean {
	return LEGACY_PROJECT_FILE_EXTENSIONS.includes(projectExtension(fileName));
}

export function stripProjectExtension(name: string): string {
	return hasKnownProjectExtension(name) ? name.slice(0, name.lastIndexOf(".")) : name;
}
