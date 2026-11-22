import fs from "node:fs/promises";
import { moveFileWithOverwrite } from "../utils";

export async function findCaptureFile(filePath: string | undefined) {
	if (!filePath) return undefined;
	try {
		return (await fs.lstat(filePath)).isFile() ? filePath : undefined;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

type CaptureSidecar = { temporary?: string; final: string };

export async function stageWindowsCaptureOutputs({
	temporaryVideo,
	finalVideo,
	audio,
	onVideoStaged,
	protectExisting = false,
}: {
	temporaryVideo: string;
	finalVideo: string;
	audio: CaptureSidecar[];
	onVideoStaged?: () => Promise<void>;
	protectExisting?: boolean;
}) {
	const move = async (temporary: string, final: string) => {
		if (temporary === final) return;
		if (protectExisting && (await findCaptureFile(final))) {
			throw new Error(`The recovery destination already exists: ${final}`);
		}
		await moveFileWithOverwrite(temporary, final);
	};

	await move(temporaryVideo, finalVideo);
	await onVideoStaged?.();

	const finalAudioPaths: string[] = [];
	for (const { temporary, final } of audio) {
		if (!temporary) continue;
		if (await findCaptureFile(temporary)) await move(temporary, final);
		if (!(await findCaptureFile(final))) continue;
		const metadata = await findCaptureFile(`${temporary}.json`);
		if (metadata) await move(metadata, `${final}.json`);
		finalAudioPaths.push(final);
	}
	return finalAudioPaths;
}
