import type { ExportBackendPreference } from "./types";

export type LightningRuntimePlatform = "darwin" | "win32" | "linux" | "unknown";
export type ExportEncodeRoute = "native-static-layout" | "breeze-stream" | "webcodecs";
export type NativeStaticExportRoute = "nvidia-cuda-compositor" | "windows-d3d11-compositor" | "ffmpeg-static-layout";

export interface ExportRoutePlan<Route extends string> {
	primary: Route | null;
	fallbacks: Route[];
	reasons: Partial<Record<Route, string[]>>;
}

export interface EncoderRoutePlan extends ExportRoutePlan<ExportEncodeRoute> {
	waitForMetadata: boolean;
	preferBreezeToSoftware: boolean;
}

interface EncoderRouteOptions {
	scope: "encoder";
	backendPreference: ExportBackendPreference;
	platform: LightningRuntimePlatform;
	nvidiaCudaEnabled?: boolean;
	mixedAudioTransport?: boolean;
	requiresFfmpegAudio?: boolean;
	staticLayoutAttempted?: boolean;
	retryWithWebCodecs?: "native-encoder" | "audio-mux";
}

interface StaticLayoutRouteOptions {
	scope: "static-layout";
	cudaSkipReason: string | null;
	d3d11SkipReason: string | null;
	gpuOnlyFeatures: string[];
}

export function normalizeLightningRuntimePlatform(
	platformHint: string | null | undefined,
): LightningRuntimePlatform {
	if (!platformHint) return "unknown";
	if (/win/i.test(platformHint)) return "win32";
	if (/linux/i.test(platformHint)) return "linux";
	if (/mac|iphone|ipad|ipod/i.test(platformHint)) return "darwin";
	return "unknown";
}

function selectRoutes<Route extends string>(
	ordered: readonly { route: Route; reason: string; rejected?: boolean }[],
): ExportRoutePlan<Route> {
	const eligible: Route[] = [];
	const reasons: ExportRoutePlan<Route>["reasons"] = {};
	for (const { route, reason, rejected } of ordered) {
		reasons[route] = [reason];
		if (!rejected) eligible.push(route);
	}
	const [primary = null, ...fallbacks] = eligible;
	return { primary, fallbacks, reasons };
}

export function planExportRoute(options: EncoderRouteOptions): EncoderRoutePlan;
export function planExportRoute(options: StaticLayoutRouteOptions): ExportRoutePlan<NativeStaticExportRoute>;
export function planExportRoute(options: EncoderRouteOptions | StaticLayoutRouteOptions) {
	if (options.scope === "static-layout") {
		const { cudaSkipReason, d3d11SkipReason, gpuOnlyFeatures } = options;
		return selectRoutes<NativeStaticExportRoute>([
			{
				route: "nvidia-cuda-compositor",
				reason: cudaSkipReason ?? "cuda-compositor-available",
				rejected: cudaSkipReason !== null,
			},
			{
				route: "windows-d3d11-compositor",
				reason: d3d11SkipReason ?? "d3d11-compositor-available",
				rejected: d3d11SkipReason !== null,
			},
			{
				route: "ffmpeg-static-layout",
				reason: gpuOnlyFeatures.length > 0
					? `unsupported-layout:${gpuOnlyFeatures.join(", ")}`
					: "ffmpeg-static-layout-available",
				rejected: gpuOnlyFeatures.length > 0,
			},
		]);
	}

	const { backendPreference, platform, nvidiaCudaEnabled, mixedAudioTransport,
		requiresFfmpegAudio, staticLayoutAttempted, retryWithWebCodecs } = options;
	const webCodecs = { route: "webcodecs", reason: "default-webcodecs-first" } as const;
	const breeze = { route: "breeze-stream", reason: "platform-prefers-native-streaming" } as const;
	const webCodecsOnly = backendPreference === "webcodecs" || retryWithWebCodecs !== undefined;
	if (webCodecsOnly) {
		return {
			...selectRoutes<ExportEncodeRoute>([
				{ ...webCodecs, reason: retryWithWebCodecs ? `retry-after:${retryWithWebCodecs}` : "explicit-webcodecs" },
			]),
			waitForMetadata: false,
			preferBreezeToSoftware: false,
		};
	}

	const tryStaticLayout = backendPreference === "breeze" || nvidiaCudaEnabled === true;
	const tryBreezeFirst = tryStaticLayout || platform === "win32" || platform === "darwin" ||
		(platform === "linux" && mixedAudioTransport && requiresFfmpegAudio === true);
	const waitForMetadata = (tryStaticLayout && !staticLayoutAttempted) ||
		(mixedAudioTransport === true && requiresFfmpegAudio === undefined);
	const preferBreezeToSoftware = !tryBreezeFirst && !mixedAudioTransport;
	const streamChoices = tryBreezeFirst
		? [
			{ ...breeze, reason: tryStaticLayout ? "fallback-from-static-layout" :
				platform === "linux" ? "audio-requires-ffmpeg" : breeze.reason },
			{ ...webCodecs, reason: "fallback-from-breeze" },
		]
		: [webCodecs, { ...breeze, reason: preferBreezeToSoftware
			? "fallback-from-webcodecs" : "native-audio-mux-not-needed", rejected: !preferBreezeToSoftware }];
	return {
		...selectRoutes<ExportEncodeRoute>([
			{
				route: "native-static-layout",
				reason: staticLayoutAttempted ? "static-layout-already-attempted" :
					nvidiaCudaEnabled ? "cuda-opt-in" : tryStaticLayout ? "explicit-breeze" : "static-layout-not-requested",
				rejected: !tryStaticLayout || staticLayoutAttempted,
			},
			...streamChoices,
		]),
		waitForMetadata,
		preferBreezeToSoftware,
	};
}
