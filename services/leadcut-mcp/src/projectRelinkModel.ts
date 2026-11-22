export type ProjectMediaKind = "video" | "webcam" | "audio" | "broll";

export interface ProjectMediaReference {
	kind: ProjectMediaKind;
	path: string;
	refId?: string;
}

export type MediaRelinkMapping = Record<string, string | null>;

type ProjectObject = Record<string, unknown>;

function asObject(value: unknown): ProjectObject | null {
	return value && typeof value === "object" && !Array.isArray(value) ? value as ProjectObject : null;
}

const regionPaths = [
	{ kind: "audio", regions: "audioRegions", property: "audioPath" },
	{ kind: "broll", regions: "videoRegions", property: "sourcePath" },
] as const;

export function getProjectMediaReferences(project: unknown): ProjectMediaReference[] {
	const root = asObject(project);
	const editor = asObject(root?.editor);
	const references: ProjectMediaReference[] = [];
	const add = (kind: ProjectMediaKind, path: unknown, refId?: unknown) => {
		if (typeof path !== "string" || !path.trim()) return;
		references.push({ kind, path, ...(typeof refId === "string" ? { refId } : {}) });
	};
	add("video", root?.videoPath);
	add("webcam", asObject(editor?.webcam)?.sourcePath);
	for (const { kind, regions, property } of regionPaths) {
		const entries = editor?.[regions];
		if (!Array.isArray(entries)) continue;
		for (const entry of entries) {
			const region = asObject(entry);
			add(kind, region?.[property], region?.id);
		}
	}
	return references;
}

export function relinkProjectMedia<T>(project: T, mapping: MediaRelinkMapping): T {
	const root = asObject(project);
	if (!root) return project;
	const replacements = new Map(Object.entries(mapping));
	const replacementFor = (path: unknown) => typeof path === "string" ? replacements.get(path) : undefined;
	const video = replacementFor(root.videoPath);
	const originalEditor = asObject(root.editor);
	const relinked = { ...root, ...(video ? { videoPath: video } : {}) };
	if (!originalEditor) return relinked as T;
	const editor = { ...originalEditor };
	const webcam = asObject(editor.webcam);
	const camera = replacementFor(webcam?.sourcePath);
	if (camera !== undefined) {
		editor.webcam = { ...webcam, sourcePath: camera, ...(camera === null ? { enabled: false } : {}) };
	}
	for (const { regions, property } of regionPaths) {
		const entries = editor[regions];
		if (!Array.isArray(entries)) continue;
		editor[regions] = entries.flatMap((entry) => {
			const region = asObject(entry);
			const replacement = replacementFor(region?.[property]);
			if (replacement === null) return [];
			return [replacement === undefined ? entry : { ...region, [property]: replacement }];
		});
	}
	return { ...relinked, editor } as T;
}
