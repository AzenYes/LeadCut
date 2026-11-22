import path from "node:path";
import { hasKnownProjectExtension } from "../src/lib/projectFileExtensions";

/** Shell arguments are already tokenized; never split paths containing spaces. */
export function projectPathsFromCommandLine(argv: string[], cwd: string): string[] {
	return [...new Set(argv.slice(1)
		.filter((arg) => !arg.startsWith("-") && hasKnownProjectExtension(arg))
		.map((arg) => path.resolve(cwd, arg)))];
}

export type ProjectOpenRequest = { id: number; path: string };

/** Keep shell requests until editor hydration and its listener are ready. */
export function createProjectOpenQueue(deliver: (senderId: number, request: ProjectOpenRequest) => void) {
	const pending: string[] = [];
	let readySender: number | null = null;
	let active: ProjectOpenRequest | null = null;
	let nextId = 0;
	const flush = () => {
		if (readySender === null || active || pending.length === 0) return;
		active = { id: ++nextId, path: pending.shift()! };
		deliver(readySender, active);
	};
	return {
		get hasPending() { return Boolean(active || pending.length); },
		enqueue(paths: string[]) {
			for (const filePath of paths) {
				if (active?.path !== filePath && !pending.includes(filePath)) pending.push(filePath);
			}
			flush();
		},
		ready(senderId: number) {
			readySender = senderId;
			flush();
		},
		complete(senderId: number, requestId: unknown) {
			if (senderId !== readySender || requestId !== active?.id) return;
			active = null;
			flush();
		},
		detach(senderId: number) {
			if (senderId !== readySender) return;
			readySender = null;
			if (active) pending.unshift(active.path);
			active = null;
		},
	};
}
