type RecordingResult = { success: boolean; path?: string; message?: string; error?: string; partialPath?: string };
type RecordingBridge = {
	writeRecordingChunk: (name: string, data: ArrayBuffer, first: boolean) => Promise<void>;
	finishRecordingChunks: (name: string, discard: boolean) => Promise<RecordingResult | null>;
};

const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_QUEUED_BYTES = 32 * 1024 * 1024;

export function createBrowserRecordingWriter(
	bridge: RecordingBridge,
	getName: (data: Blob) => string,
	onFailure: (error: unknown) => void,
) {
	let queue = Promise.resolve();
	let name: string | undefined;
	let queuedBytes = 0;
	let first = true;
	let failed = false;
	let writeFailed = false;
	let discarded = false;
	let finished = false;
	const fail = (error: unknown) => {
		if (failed || discarded) return;
		failed = true;
		onFailure(error);
	};
	return {
		append(data: Blob) {
			if (!data.size || discarded || failed || finished) return;
			if (queuedBytes + data.size > MAX_QUEUED_BYTES) {
				fail(new Error("Browser recording write queue is full."));
				return;
			}
			name ??= getName(data);
			const outputName = name;
			queuedBytes += data.size;
			queue = queue.then(async () => {
				for (let offset = 0; offset < data.size && !discarded && !writeFailed; offset += CHUNK_BYTES) {
					const bytes = await data.slice(offset, offset + CHUNK_BYTES).arrayBuffer();
					if (discarded) return;
					await bridge.writeRecordingChunk(outputName, bytes, first);
					first = false;
				}
			}).catch(error => { writeFailed = true; fail(error); }).finally(() => { queuedBytes -= data.size; });
		},
		discard() { discarded = true; },
		async finish() {
			finished = true;
			await queue;
			if (!name || first) return { result: null, discarded, failed };
			return { result: await bridge.finishRecordingChunks(name, discarded), discarded, failed };
		},
	};
}
