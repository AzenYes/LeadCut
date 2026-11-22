import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { readProjectRevision } from "./guardedSave";

type ExternalProjectChange = { path: string; diskRevision: string | null };
let active: { check: () => Promise<void>; stop: () => void } | null = null;

export function stopProjectWatcher() {
	active?.stop();
	active = null;
}

export function checkProjectWatcherNow(): Promise<void> {
	return active?.check() ?? Promise.resolve();
}

export function startProjectWatcher(
	projectPath: string,
	getLoadedRevision: () => string | null,
	onChange: (change: ExternalProjectChange) => void,
) {
	stopProjectWatcher();
	const file = path.resolve(projectPath);
	const normalize = (name: string) => process.platform === "win32" ? name.toLowerCase() : name;
	const basename = normalize(path.basename(file));
	let stopped = false;
	let readSequence = 0;
	let pending: NodeJS.Timeout | undefined;
	let lastReported: string | null | undefined;
	const check = async () => {
		clearTimeout(pending);
		pending = undefined;
		if (stopped) return;
		const sequence = ++readSequence;
		let diskRevision: string | null;
		try {
			diskRevision = await readProjectRevision(file);
		} catch (error) {
			if (!stopped) console.warn("Could not check the project file revision", error);
			return;
		}
		if (stopped || sequence !== readSequence) return;
		const loadedRevision = getLoadedRevision();
		if (!loadedRevision || diskRevision === loadedRevision) {
			lastReported = undefined;
			return;
		}
		if (diskRevision === lastReported) return;
		lastReported = diskRevision;
		onChange({ path: file, diskRevision });
	};
	const scheduleCheck = () => {
		clearTimeout(pending);
		pending = setTimeout(() => void check(), 300);
	};
	let watcher: FSWatcher | undefined;
	try {
		// Watch the containing directory so atomic replacement keeps emitting events.
		watcher = watch(path.dirname(file), { persistent: false }, (_event, filename) => {
			if (filename && normalize(filename) !== basename) return;
			scheduleCheck();
		});
		watcher.on("error", error => {
			watcher?.close();
			console.warn("Could not watch the project directory", error);
		});
	} catch (error) {
		console.warn("Could not start the project directory watcher", error);
	}
	active = {
		check: () => pending === undefined ? check() : Promise.resolve(),
		stop: () => {
			stopped = true;
			clearTimeout(pending);
			watcher?.close();
		},
	};
	scheduleCheck();
}
