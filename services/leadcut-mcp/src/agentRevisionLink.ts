import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { agentBackupLinkPath, PROJECT_HISTORY_RETENTION } from "./projectHistoryRetention.js";
import { parseProject, type LeadcutProject } from "./projectStore.js";

type RevisionLink = {
	previousRevision: string;
	revision: string;
	backupDigest: string;
};

const digest = (content: string) => createHash("sha256").update(content).digest("hex");
const revisionPattern = /^[a-f0-9]{64}$/;
const reviewFields = [
	"clipRegions", "trimRegions", "speedRegions", "zoomRegions",
	"autoCaptions", "autoCaptionSettings", "chapterProgress", "transcript",
] as const;

const filesystemKey = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;

export async function getAgentBackupDirectory(projectPath: string, create = false) {
	const parent = await fs.realpath(path.dirname(projectPath));
	const directory = path.join(parent, ".mcp-backups");
	if (create) await fs.mkdir(directory, { recursive: true });
	if (!(await fs.lstat(directory)).isDirectory() ||
		filesystemKey(await fs.realpath(directory)) !== filesystemKey(directory)) {
		throw new Error("Invalid project backup directory.");
	}
	return directory;
}

export async function listAgentBackupFiles(directory: string, projectName: string) {
	const prefix = `${filesystemKey(projectName)}.`;
	const files = await fs.readdir(directory, { withFileTypes: true });
	return files.flatMap(entry => {
		if (!entry.isFile() || !filesystemKey(entry.name).startsWith(prefix)) return [];
		const match = /^(\d{13})-[\w-]+\.leadcut$/.exec(entry.name.slice(prefix.length));
		return match ? [{ id: entry.name, path: path.join(directory, entry.name), createdAt: Number(match[1]) }] : [];
	}).sort((left, right) => right.createdAt - left.createdAt || left.path.localeCompare(right.path));
}

export async function writeAgentRevisionLink(
	backupPath: string, previousRevision: string, revision: string, backupContents: string,
) {
	const file = agentBackupLinkPath(backupPath);
	if (!file) throw new Error("Invalid Agent backup filename.");
	const link: RevisionLink = { previousRevision, revision, backupDigest: digest(backupContents) };
	const handle = await fs.open(file, "wx");
	try {
		try {
			await handle.writeFile(JSON.stringify(link), "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
	} catch (error) {
		await fs.rm(file, { force: true }).catch(() => undefined);
		throw error;
	}
	return file;
}

async function readLink(backupPath: string): Promise<(RevisionLink & { backupPath: string }) | null> {
	const file = agentBackupLinkPath(backupPath);
	if (!file) return null;
	try {
		const stat = await fs.lstat(file);
		if (!stat.isFile() || stat.size > 1024 || filesystemKey(await fs.realpath(file)) !== filesystemKey(file)) return null;
		const value: unknown = JSON.parse(await fs.readFile(file, "utf8"));
		if (!value || typeof value !== "object") return null;
		const { previousRevision, revision, backupDigest } = value as Partial<RevisionLink>;
		if (typeof previousRevision !== "string" || !revisionPattern.test(previousRevision) ||
			typeof revision !== "string" || !revisionPattern.test(revision) ||
			typeof backupDigest !== "string" || !revisionPattern.test(backupDigest)) return null;
		return { previousRevision, revision, backupDigest, backupPath };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
		return null;
	}
}

export async function readAgentRevisionHistory(
	projectPath: string, currentRevision: string, fromRevision: string,
): Promise<LeadcutProject[]> {
	if (fromRevision === currentRevision) return [];
	const previousProjects: LeadcutProject[] = [];
	const visited = new Set([currentRevision]);
	let bytes = 0;
	let cursor = currentRevision;

	try {
		const backupDirectory = await getAgentBackupDirectory(projectPath);
		const candidates = (await listAgentBackupFiles(backupDirectory, path.basename(projectPath))).slice(0, PROJECT_HISTORY_RETENTION.keepLast);
		const links = new Map<string, Awaited<ReturnType<typeof readLink>>>();
		for (const link of await Promise.all(candidates.map(candidate => readLink(candidate.path)))) {
			if (!link) continue;
			const existing = links.get(link.revision);
			// The same serialized result can be reached by separate edits. Use only unambiguous predecessors.
			if (existing === undefined) links.set(link.revision, link);
			else if (existing && (existing.previousRevision !== link.previousRevision || existing.backupDigest !== link.backupDigest)) {
				links.set(link.revision, null);
			}
		}
		for (let step = 0; step < PROJECT_HISTORY_RETENTION.keepLast; step++) {
			const link = links.get(cursor);
			if (!link || visited.has(link.previousRevision)) return [];
			// The editor already has the exact starting revision.
			if (link.previousRevision === fromRevision) return previousProjects.reverse();

			visited.add(link.previousRevision);
			const file = link.backupPath;
			const stat = await fs.lstat(file);
			bytes += stat.size;
			if (!stat.isFile() || bytes > PROJECT_HISTORY_RETENTION.maxBytes ||
				filesystemKey(await fs.realpath(file)) !== filesystemKey(file)) return [];
			const contents = await fs.readFile(file, "utf8");
			if (digest(contents) !== link.backupDigest) return [];
			const project = parseProject(contents, projectPath);
			previousProjects.push({
				version: project.version,
				videoPath: project.videoPath,
				editor: Object.fromEntries(reviewFields.map(field => [field, project.editor[field]])),
			});
			cursor = link.previousRevision;
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
	}
	return [];
}
