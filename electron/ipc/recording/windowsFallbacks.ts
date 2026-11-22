import { readAppEnv } from "../../envCompat";
const WINDOWS_MIC_CAPTURE_UNAVAILABLE_MARKERS = [
	"MICROPHONE_CAPTURE_UNAVAILABLE",
	"WARNING: Failed to initialize WASAPI mic capture",
];
const WINDOWS_MIC_CAPTURE_SUFFIX = "WINDOWS_MIC_CAPTURE";
export const WINDOWS_MIC_CAPTURE_MODE_ENV = `LEADCUT_${WINDOWS_MIC_CAPTURE_SUFFIX}`;

export function shouldStartWindowsBrowserMicrophoneFallback(
	options?: { capturesMicrophone?: boolean },
	env: NodeJS.ProcessEnv = process.env,
) {
	if (!options?.capturesMicrophone) {
		return false;
	}

	const mode = readAppEnv(WINDOWS_MIC_CAPTURE_SUFFIX, env)?.trim().toLowerCase();
	// Native WASAPI is the normal Windows path. Keep the renderer path as an
	// explicit escape hatch and as an automatic fallback when WASAPI cannot start.
	return mode === "browser" || mode === "fallback" || mode === "renderer";
}

export function shouldUseWindowsBrowserMicrophoneFallback(
	captureOutput: string,
	options?: { capturesMicrophone?: boolean },
	env: NodeJS.ProcessEnv = process.env,
) {
	return (
		Boolean(options?.capturesMicrophone) &&
		(shouldStartWindowsBrowserMicrophoneFallback(options, env) ||
			WINDOWS_MIC_CAPTURE_UNAVAILABLE_MARKERS.some((marker) =>
				captureOutput.includes(marker),
			))
	);
}
