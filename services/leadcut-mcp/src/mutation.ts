import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import { getAgentBackupDirectory, listAgentBackupFiles, writeAgentRevisionLink } from "./agentRevisionLink.js";
import {parseProject,resolveProjectPath,saveProject,type LeadcutProject} from './projectStore.js';
import {assertProjectNotOpen} from './editorLock.js';
import { assertProjectFormatWritable } from "./projectFormat.js";
import { pruneHistoryFiles } from "./projectHistoryRetention.js";
export const hash=(raw:string)=>createHash('sha256').update(raw).digest('hex');
export const reply=(data:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(data,null,2)}]});
const queues = new Map<string, Promise<unknown>>();

// Serialize this server's writes and verify revisions against edits from other processes.
async function locked<T>(file: string, action: () => Promise<T>): Promise<T> {
	const key = process.platform === "win32" ? file.toLowerCase() : file;
	const previous = queues.get(key) ?? Promise.resolve();
	const current = previous.catch(() => undefined).then(action);
	queues.set(key, current);
	try {
		return await current;
	} finally {
		if (queues.get(key) === current) queues.delete(key);
	}
}

export async function readProjectSnapshot(name: string) {
	const file = path.resolve(await resolveProjectPath(name));
	const raw = await fs.readFile(file, "utf8");
	const project = parseProject(raw, file);
	return { file, project, revision: hash(raw) };
}

type MutationResult = { project: LeadcutProject; [key: string]: unknown };

export async function listProjectBackups(projectPath: string) {
	try {
		return await listAgentBackupFiles(await getAgentBackupDirectory(projectPath), path.basename(projectPath));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

function revisionConflict(currentRevision: string) {
	return {
		...reply({
			code: "revision_conflict",
			message: "Project changed; reopen before editing.",
			nextAction: "Read the latest project revision and repeat the dry run.",
			currentRevision,
		}),
		isError: true as const,
	};
}

export async function mutate(
	project: string,
	dryRun: boolean,
	expectedRevision: string | undefined,
	edit: (project: LeadcutProject, file: string) => MutationResult | Promise<MutationResult>,
) {
	const file = path.resolve(await resolveProjectPath(project));
	return locked(file, async () => {
		const openInEditor = await assertProjectNotOpen(file, dryRun);
		const raw = await fs.readFile(file, "utf8");
		const revision = hash(raw);
		if (!dryRun && !expectedRevision) throw new Error("expectedRevision is required for writes.");
		if (expectedRevision !== undefined && expectedRevision !== revision) return revisionConflict(revision);
		const original = parseProject(raw, file);
		assertProjectFormatWritable(original);
		const { project: next, ...details } = await edit(original, file);
		const changed = JSON.stringify(original) !== JSON.stringify(next);
		let backupPath: string | null = null;
		let afterRevision = revision;
		if (!dryRun && changed) {
			let diskRevision = revision;
			const verify = async () => {
				await assertProjectNotOpen(file, false);
				diskRevision = hash(await fs.readFile(file, "utf8"));
				if (diskRevision !== revision) throw new Error("Project changed before save.");
			};
			await verify();
			const directory = await getAgentBackupDirectory(file, true);
			const projectName = path.basename(file);
			const backupFile = path.join(directory, `${projectName}.${Date.now()}-${randomUUID()}.leadcut`);
			backupPath = backupFile;
			const { thumbnailPng: _thumbnailPng, ...backup } = original;
			const backupContents = _thumbnailPng === undefined ? raw : JSON.stringify(backup, null, 2);
			await fs.writeFile(backupFile, backupContents, { encoding: "utf8", flag: "wx" });
			let linkPath: string | undefined;
			try {
				await saveProject(file, next, verify, async contents => {
					afterRevision = hash(contents);
					linkPath = await writeAgentRevisionLink(backupFile, revision, afterRevision, backupContents);
				});
			} catch (error) {
				await fs.rm(backupFile, { force: true });
				if (linkPath) await fs.rm(linkPath, { force: true });
				if (diskRevision !== revision) return revisionConflict(diskRevision);
				throw error;
			}
			try {
				await pruneHistoryFiles(await listAgentBackupFiles(directory, projectName));
			} catch (error) {
				console.warn("Could not prune project backups:", error);
			}
		}
		return reply({
			...details,
			project: file,
			dryRun,
			changed,
			revision: afterRevision,
			backupPath,
			reloadRequired: changed && !dryRun,
			...(openInEditor ? { openInEditor } : {}),
		});
	});
}
