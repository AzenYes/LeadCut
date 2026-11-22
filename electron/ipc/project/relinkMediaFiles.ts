import fs from "node:fs/promises";
import path from "node:path";
import {
	getProjectMediaReferences,
	type ProjectMediaReference,
} from "../../../src/components/video-editor/projectRelink";
import { normalizeVideoSourcePath } from "../utils";

export async function collectMissingProjectMedia(project: unknown): Promise<ProjectMediaReference[]> {
	const references = getProjectMediaReferences(project);
	const checks = new Map<string, Promise<boolean>>();
	const exists = (reference: ProjectMediaReference) => {
		const file = normalizeVideoSourcePath(reference.path);
		if (!file) return Promise.resolve(false);
		let check = checks.get(file);
		if (!check) {
			check = fs.stat(file).then((stat) => stat.isFile(), () => false);
			checks.set(file, check);
		}
		return check;
	};
	const present = await Promise.all(references.map(exists));
	return references.filter((_, index) => !present[index]);
}

export async function matchRelinkMediaInFolder(folder: string, basenames: string[]) {
	const keyFor = (name: string) => process.platform === "win32" ? name.toLowerCase() : name;
	const names = [...new Set(basenames.filter(name =>
		typeof name === "string" && name !== "." && name !== ".." && name.length > 0 && !/[\\/]/.test(name),
	))];
	const candidates = new Map(names.map(name => [keyFor(name), [] as string[]]));

	async function visit(directory: string, depth: number) {
		const entries = await fs.readdir(directory, { withFileTypes: true }).catch(error => {
			if (depth === 0) throw error;
			return [];
		});
		for (const entry of entries) {
			const file = path.join(directory, entry.name);
			if (entry.isDirectory() && depth < 3) await visit(file, depth + 1);
			else if (entry.isFile()) candidates.get(keyFor(entry.name))?.push(file);
		}
	}

	if (candidates.size > 0) await visit(folder, 0);
	const matches = Object.fromEntries(names.flatMap(name => {
		const files = candidates.get(keyFor(name)) ?? [];
		return files.length === 1 ? [[name, files[0]]] : [];
	}));
	const ambiguous = names.filter(name => (candidates.get(keyFor(name))?.length ?? 0) > 1);
	return { matches, ambiguous };
}
