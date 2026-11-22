import { uiText } from "../../uiI18n";
import path from "node:path";

const RECORDED_VIDEO_FILE_NAME = /^recording-[0-9]+(?:-webcam)?\.(?:webm|mp4)$/;

export function resolveRecordedVideoStoragePath(recordingsDir: string, fileName: unknown): string {
	if (typeof fileName !== "string" || RECORDED_VIDEO_FILE_NAME.exec(fileName)?.[0] !== fileName) {
		throw new Error(uiText("invalidRecordingFileName"));
	}

	const resolvedRecordingsDir = path.resolve(recordingsDir);
	const candidatePath = path.resolve(resolvedRecordingsDir, fileName);
	const relativePath = path.relative(resolvedRecordingsDir, candidatePath);

	if (
		relativePath.length === 0 ||
		relativePath === ".." ||
		relativePath.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relativePath)
	) {
		throw new Error(uiText("invalidRecordingFileName"));
	}

	return candidatePath;
}
