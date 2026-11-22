import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	getProjectFileExtension,
	getProjectsDir,
	hasProjectFileExtension,
	LEGACY_PROJECT_FILE_EXTENSIONS,
	stripProjectExtension,
} from "./paths.js";

/**
 * We deliberately do NOT model every field of LeadCut's real `ProjectEditorState`
 * (src/components/video-editor/projectPersistence.ts has ~60 of them, covering things
 * like motion-blur tuning this server never touches). Instead `editor` is read and
 * written as a generic bag of fields: each tool only reads/replaces the handful of keys
 * it's responsible for and passes everything else through untouched, so a project this
 * server edits still opens correctly in the LeadCut desktop app with all of its other
 * settings intact.
 */
export interface LeadcutProject {
	version: number;
	projectId?: string;
	videoPath: string;
	editor: Record<string, unknown>;
	[key: string]: unknown;
}

function isPlainProject(candidate: unknown): candidate is LeadcutProject {
	if (!candidate || typeof candidate !== "object") return false;
	const project = candidate as Partial<LeadcutProject>;
	return (
		typeof project.version === "number" &&
		typeof project.videoPath === "string" &&
		project.videoPath.trim().length > 0 &&
		typeof project.editor === "object" &&
		project.editor !== null
	);
}

/** Ported from electron/ipc/project/atomicSave.ts, which has no Electron dependency of its own. */
async function writeProjectFileAtomically(projectPath: string, contents: string): Promise<void> {
	const targetPath = path.resolve(projectPath);
	const parentDir = path.dirname(targetPath);
	const temporaryPath = path.join(parentDir, `.leadcut-mcp-${process.pid}-${randomUUID()}.tmp`);

	await fs.mkdir(parentDir, { recursive: true });
	await fs.writeFile(temporaryPath, contents, "utf-8");
	await fs.rename(temporaryPath, targetPath);
}

export async function resolveProjectPath(nameOrPath: string): Promise<string> {
	if (path.isAbsolute(nameOrPath)) {
		return nameOrPath;
	}
	const projectsDir = await getProjectsDir();
	if (hasProjectFileExtension(nameOrPath)) return path.join(projectsDir, nameOrPath);
	const preferred = path.join(projectsDir, `${nameOrPath}.${getProjectFileExtension()}`);
	for (const candidate of [preferred, ...LEGACY_PROJECT_FILE_EXTENSIONS.map(extension =>
		path.join(projectsDir, `${nameOrPath}.${extension}`),
	)]) {
		try {
			if ((await fs.stat(candidate)).isFile()) return candidate;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	return preferred;
}

export interface ProjectListEntry {
	path: string;
	name: string;
	videoPath: string;
	updatedAt: number;
}

export async function listProjects(): Promise<ProjectListEntry[]> {
	const projectsDir = await getProjectsDir();
	const entries = await fs.readdir(projectsDir, { withFileTypes: true }).catch(() => []);

	const results: ProjectListEntry[] = [];
	for (const entry of entries) {
		if (!entry.isFile() || !hasProjectFileExtension(entry.name)) continue;
		const fullPath = path.join(projectsDir, entry.name);
		try {
			const [stats, project] = await Promise.all([fs.stat(fullPath), openProject(fullPath)]);
			results.push({
				path: fullPath,
				name: stripProjectExtension(entry.name),
				videoPath: project.videoPath,
				updatedAt: stats.mtimeMs,
			});
		} catch {
			// Skip files that aren't readable/valid project data.
		}
	}

	return results.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function openProject(projectPath: string): Promise<LeadcutProject> {
	const raw = await fs.readFile(projectPath, "utf-8");
	const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/, ""));
	if (!isPlainProject(parsed)) {
		throw new Error(`${projectPath} is not a valid LeadCut project file`);
	}
	return parsed;
}

export function resolveProjectMediaPath(projectPath: string, mediaPath: string): string {
	if (/^file:/i.test(mediaPath)) return fileURLToPath(mediaPath);
	if (path.isAbsolute(mediaPath)) return mediaPath;
	if (/^[a-z][a-z\d+.-]*:/iu.test(mediaPath)) throw new Error("The project media must be a local file.");
	return path.resolve(path.dirname(projectPath), mediaPath);
}

export async function saveProject(projectPath: string, project: LeadcutProject): Promise<void> {
	await writeProjectFileAtomically(projectPath, JSON.stringify(project, null, 2));
}
