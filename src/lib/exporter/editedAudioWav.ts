export const MAX_INLINE_EDITED_WAV_BYTES = 16 * 1024 * 1024;
export const MAX_EXPORT_SOURCE_PCM_WINDOW_BYTES = 16 * 1024 * 1024;
export const EDITED_WAV_MIME_TYPE = "audio/wav";

export function getEditedWavByteLength(header: ArrayBuffer): number | undefined {
	if (header.byteLength < 44) return;
	const view = new DataView(header);
	if (
		view.getUint32(0) !== 0x52494646 || // RIFF
		view.getUint32(8) !== 0x57415645 || // WAVE
		view.getUint32(36) !== 0x64617461 // data
	) return;
	const byteLength = view.getUint32(4, true) + 8;
	if (byteLength === view.getUint32(40, true) + 44) return byteLength;
}
