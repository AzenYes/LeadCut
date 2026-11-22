import fs from "node:fs/promises";
import { writeProjectFileAtomically } from "./atomicSave";
import { computeProjectRevision } from "./projectRevision";

export async function readProjectRevision(projectPath: string): Promise<string | null> {
	try {
		return computeProjectRevision(await fs.readFile(projectPath, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

export class ProjectRevisionConflict extends Error {
	constructor(readonly diskRevision: string | null) {
		super("The project changed on disk.");
	}
}

export async function verifyProjectRevision(projectPath: string, expectedRevision: string) {
	const diskRevision = await readProjectRevision(projectPath);
	if (diskRevision !== expectedRevision) throw new ProjectRevisionConflict(diskRevision);
}

export async function guardedSaveProject({
	projectPath,
	content,
	expectedRevision,
	beforeCommit,
}: {
	projectPath: string;
	content: string;
	expectedRevision: string | null;
	beforeCommit?: () => Promise<void>;
}): Promise<
	| { success: true; revision: string }
	| { success: false; conflict: true; diskRevision: string | null }
> {
	try {
		const verify = expectedRevision === null
			? undefined
			: () => verifyProjectRevision(projectPath, expectedRevision);
		await writeProjectFileAtomically(projectPath, content, verify, beforeCommit);
		return { success: true, revision: computeProjectRevision(content) };
	} catch (error) {
		if (error instanceof ProjectRevisionConflict) {
			return { success: false, conflict: true, diskRevision: error.diskRevision };
		}
		throw error;
	}
}
