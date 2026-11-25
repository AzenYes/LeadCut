import { stripProjectUserPreferences, type EditorProjectData } from "./projectPersistence";

function isComparableObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function areDeepEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) {
		return true;
	}

	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
			return false;
		}

		for (let index = 0; index < left.length; index += 1) {
			if (!areDeepEqual(left[index], right[index])) {
				return false;
			}
		}

		return true;
	}

	if (!isComparableObject(left) || !isComparableObject(right)) {
		return false;
	}

	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	if (leftKeys.length !== rightKeys.length) {
		return false;
	}

	for (const key of leftKeys) {
		if (!(key in right) || !areDeepEqual(left[key], right[key])) {
			return false;
		}
	}

	return true;
}

const comparableProjectCache = new WeakMap<EditorProjectData, EditorProjectData>();

function comparableProjectState(project: EditorProjectData | null) {
	if (!project?.editor || typeof project.editor !== "object") {
		return project;
	}
	const cached = comparableProjectCache.get(project);
	if (cached) return cached;

	const editor = stripProjectUserPreferences(project.editor) as Record<string, unknown>;
	// Playback bootstraps these internally. Current saves only persist the clips.
	delete editor.autoFullTrackClipId;
	delete editor.autoFullTrackClipEndMs;
	const defaults = editor.defaultSourceAudioTrackSettings;
	if (isComparableObject(defaults)) {
		// Discovering a source audio lane inserts its implicit defaults after media loads.
		const explicit = Object.entries(defaults).filter(([, value]) =>
			!areDeepEqual(value, { volume: 1, normalize: false }) &&
			!areDeepEqual(value, { volume: 1, normalize: false, deletedRanges: [] }),
		);
		if (explicit.length) editor.defaultSourceAudioTrackSettings = Object.fromEntries(explicit);
		else delete editor.defaultSourceAudioTrackSettings;
	}
	if (isComparableObject(editor.webcam)) {
		const {
			enabled: _enabled,
			sourcePath: _sourcePath,
			timeOffsetMs: _timeOffsetMs,
			...persistentWebcamFields
		} = editor.webcam;
		editor.webcam = persistentWebcamFields;
	}
	const normalized = { ...project, editor };
	comparableProjectCache.set(project, normalized);
	return normalized;
}

export function hasUnsavedProjectChanges(
	currentProjectSnapshot: EditorProjectData | null,
	lastSavedSnapshot: EditorProjectData | null,
): boolean {
	const comparableCurrentSnapshot = comparableProjectState(currentProjectSnapshot);
	const comparableLastSavedSnapshot = comparableProjectState(lastSavedSnapshot);

	return Boolean(
		comparableCurrentSnapshot &&
			(!comparableLastSavedSnapshot ||
				!areDeepEqual(comparableCurrentSnapshot, comparableLastSavedSnapshot)),
	);
}
